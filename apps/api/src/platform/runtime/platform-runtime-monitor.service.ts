import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { OrbitEnv } from '@orbit/config';
import { COST_STATE_LABELS, costStateChanges, runtimeTransitions, type CostLimitState, type RuntimeStatus, type RuntimeTransition } from '@orbit/shared';
import { AiCostGuardrailService } from '../../ai-governance/ai-cost-guardrail.service';
import { ORBIT_ENV } from '../../config/env.token';
import { WORKFLOW_RUNS_QUEUE } from '../../queue/queue.tokens';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformRuntimeService } from './platform-runtime.service';

const LEADER_KEY = 'orbit:platform:runtime-monitor:leader';
const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Aktive Überwachung der Hintergrundverarbeitung (Amendment 03 §22): damit niemand die Übersicht offen halten muss, wird der Zustand regelmäßig gemessen und
 * **jeder Wechsel** (Ausfall, Stau, Erholung) als unveränderliches Plattform-Audit-Ereignis festgehalten und optional an einen Webhook gesendet. Bei mehreren
 * API-Instanzen alarmiert nur die Instanz, die die Redis-Sperre hält (sonst gäbe es jeden Alarm mehrfach). Grenze: ist die API selbst nicht erreichbar,
 * alarmiert niemand – das muss ein externer Check (z. B. `/health/ready`) abdecken.
 */
@Injectable()
export class PlatformRuntimeMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformRuntimeMonitorService.name);
  private readonly instanceId = randomUUID();
  private previous: Map<string, RuntimeStatus> | undefined;
  private previousCost: Map<string, CostLimitState> | undefined;
  /** Je Mandant und Tag höchstens eine Meldung über ungewöhnliche Nutzung (Schlüssel `mandant:Tag`). */
  private readonly alertedAnomalies = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly runtime: PlatformRuntimeService,
    private readonly audit: PlatformAuditService,
    private readonly cost: AiCostGuardrailService,
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly queue: Queue,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  onModuleInit(): void {
    const seconds = this.env.PLATFORM_RUNTIME_MONITOR_SECONDS;
    if (seconds <= 0) return;
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => this.logger.warn(`Überwachung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`));
    }, seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Nur eine Instanz alarmiert: Sperre mit kurzer Lebensdauer, die der Halter bei jedem Takt erneuert. */
  private async isLeader(): Promise<boolean> {
    const client = (await this.queue.client) as unknown as Redis; // die Typen von BullMQ nennen nur einen Ausschnitt des echten ioredis-Clients
    const ttl = Math.max(90, this.env.PLATFORM_RUNTIME_MONITOR_SECONDS * 3);
    const acquired = await client.set(LEADER_KEY, this.instanceId, 'EX', ttl, 'NX');
    if (acquired === 'OK') return true;
    if ((await client.get(LEADER_KEY)) === this.instanceId) {
      await client.expire(LEADER_KEY, ttl);
      return true;
    }
    return false;
  }

  /** Eine Messung mit Auswertung; öffentlich, damit Tests den Takt nicht abwarten müssen. Liefert die ausgelösten Wechsel. */
  async tick(): Promise<RuntimeTransition[]> {
    if (this.running) return [];
    this.running = true;
    try {
      if (!(await this.isLeader())) return [];
      const health = await this.runtime.health();
      const transitions = runtimeTransitions(this.previous, health);
      this.previous = new Map(health.queues.map((q) => [q.name, q.status]));
      for (const transition of transitions) {
        const webhook = await this.send({ type: 'orbit.runtime.state_changed', queue: transition.queue, from: transition.from, to: transition.to, note: transition.note, at: health.checkedAt });
        const queue = health.queues.find((q) => q.name === transition.queue);
        await this.audit.record({
          eventType: 'PLATFORM_RUNTIME_STATE_CHANGED',
          targetType: 'Queue',
          targetId: transition.queue,
          reason: transition.note || undefined,
          extra: { from: transition.from, to: transition.to, workers: queue?.workers, waiting: queue?.waiting, oldestWaitingAgeSec: queue?.oldestWaitingAgeSec ?? null, webhook },
        });
      }
      // Kosten-Leitplanken im selben Takt; ein Fehler dort darf die Laufzeitmeldungen nie verhindern.
      await this.costTick().catch((error: unknown) => this.logger.warn(`Kostenüberwachung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`));
      return transitions;
    } finally {
      this.running = false;
    }
  }

  /**
   * Kosten-Leitplanken (Amendment 03 §12.3): jeder Wechsel eines Limits (Warnung, Soft-, Hard-Limit, Rückkehr in den Rahmen) und jede ungewöhnliche Nutzung wird
   * als Audit-Ereignis `PLATFORM_COST_ALERT` festgehalten und optional an den Webhook gesendet. Öffentlich, damit Tests den Takt nicht abwarten müssen.
   */
  async costTick(): Promise<{ limitChanges: number; anomalies: number }> {
    const evaluations = await this.cost.list();
    const changes = costStateChanges(this.previousCost, evaluations.map((e) => ({ limitId: e.id, state: e.state })));
    this.previousCost = new Map(evaluations.map((e) => [e.id, e.state]));
    const at = new Date().toISOString();
    for (const change of changes) {
      const e = evaluations.find((x) => x.id === change.limitId);
      if (!e) continue;
      const webhook = await this.send({ type: 'orbit.cost.limit_state_changed', scope: e.scope, targetTenantId: e.targetTenantId, profileKey: e.profileKey, from: change.from, to: change.to, spent: e.spent, currency: e.currency, hardEnforced: e.hardEnforced, at });
      await this.audit.record({
        eventType: 'PLATFORM_COST_ALERT',
        targetType: 'AICostLimit',
        targetId: e.id,
        targetTenantId: e.targetTenantId ?? undefined,
        reason: `${COST_STATE_LABELS[change.to]} (${e.spent} ${e.currency})`,
        extra: { kind: 'LIMIT_STATE', scope: e.scope, profileKey: e.profileKey, from: change.from, to: change.to, spent: e.spent, currency: e.currency, warnAmount: e.warnAmount, softAmount: e.softAmount, hardAmount: e.hardAmount, hardEnforced: e.hardEnforced, unmeasuredRequests: e.unmeasuredRequests, webhook },
      });
    }

    const today = at.slice(0, 10);
    for (const key of this.alertedAnomalies) if (!key.endsWith(`:${today}`)) this.alertedAnomalies.delete(key);
    let anomalies = 0;
    for (const anomaly of await this.cost.anomalies()) {
      const key = `${anomaly.tenantId}:${today}`;
      if (this.alertedAnomalies.has(key)) continue;
      this.alertedAnomalies.add(key);
      anomalies += 1;
      const webhook = await this.send({ type: 'orbit.cost.anomaly', targetTenantId: anomaly.tenantId, requestsLast24h: anomaly.requestsLast24h, baselineDailyRequests: anomaly.baselineDailyRequests, factor: anomaly.factor, at });
      await this.audit.record({
        eventType: 'PLATFORM_COST_ALERT',
        targetType: 'Tenant',
        targetId: anomaly.tenantId,
        targetTenantId: anomaly.tenantId,
        reason: `Ungewöhnliche KI-Nutzung: ${anomaly.requestsLast24h} Aufrufe in 24 Stunden, das ${anomaly.factor}-Fache des üblichen Tageswerts`,
        extra: { kind: 'ANOMALY', requestsLast24h: anomaly.requestsLast24h, costLast24h: anomaly.costLast24h, baselineDailyRequests: anomaly.baselineDailyRequests, factor: anomaly.factor, webhook },
      });
    }
    return { limitChanges: changes.length, anomalies };
  }

  /** Webhook (optional): nur Zahlen und Namen. Ein Fehler wird festgehalten, verhindert aber nie das Audit-Ereignis. */
  private async send(payload: Record<string, unknown>): Promise<'NOT_CONFIGURED' | 'DELIVERED' | string> {
    const url = this.env.PLATFORM_ALERT_WEBHOOK_URL;
    if (!url) return 'NOT_CONFIGURED';
    if (!/^https?:\/\//i.test(url)) return 'FAILED:UNSUPPORTED_SCHEME';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, environment: this.env.ORBIT_ENVIRONMENT }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      return response.ok ? 'DELIVERED' : `FAILED:HTTP_${response.status}`;
    } catch (error) {
      this.logger.warn(`Webhook nicht zugestellt: ${error instanceof Error ? error.name : 'Fehler'}`);
      return 'FAILED:UNREACHABLE';
    }
  }
}
