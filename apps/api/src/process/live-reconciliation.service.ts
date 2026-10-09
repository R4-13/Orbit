import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import type { CaseOrchestrationStatus, ProcessPlanNode } from '@orbit/domain';
import type { PlanNode } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLedgerService } from './action-ledger.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { PlanStoreService, type PlanGraph } from './plan-store.service';
import { UPGRADABLE_CAPABILITIES, earliestFirst, evaluateUpgrade, isReservedTestAddress, isUpgradableSimulation, type UpgradeNode } from './live-upgrade';

const TERMINAL: ReadonlySet<CaseOrchestrationStatus> = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']);
/** Fehler, die nur vorübergehend an einer fehlenden Verbindung oder einem fehlenden KI-Dienst liegen und von selbst wieder aufgenommen werden. */
const AI_ERRORS: ReadonlySet<string> = new Set(['AI_NOT_CONNECTED', 'AI_UNAVAILABLE']);
const MAIL_ERRORS: ReadonlySet<string> = new Set(['MAIL_NOT_CONNECTED']);
/** Höchstens so oft wird ein Fall von demselben Startschritt aus live wiederholt – schützt vor einer Endlosschleife, falls ein Schritt trotz „live verfügbar“ wieder simuliert endet. */
const MAX_REDOS_PER_START = 3;
const MAX_REVIVALS = 10;
const BATCH = 25;

const RESET_PATCH = { state: 'PLANNED' as const, output: null, errorCode: null, errorMessage: null, executionMode: null, agentRunId: null, startedAt: null, completedAt: null, retryAt: null, attempts: 0 };
const RESETTABLE = ['SUCCEEDED', 'WAITING', 'AWAITING_APPROVAL', 'SKIPPED', 'BLOCKED', 'FAILED'] as const;

export interface ReconcileResult {
  /** Blockierte oder an einer Verbindung gescheiterte Schritte, die wieder aufgenommen wurden. */
  resumed: string[];
  /** Simulierte Schritte (und was dahinter lag), die neu und live ausgeführt werden. */
  redone: string[];
  /** Warum ein simulierter Schritt vorerst simuliert bleibt. */
  skipped?: string;
}

/**
 * Live-Abgleich (Rückmeldung: „ORBIT soll automatisch prüfen, bis der Schritt erledigt ist und auf Live steht“). Ein Schritt, der nur simuliert lief oder an einer
 * fehlenden Verbindung hängt, wird von selbst wieder aufgenommen, sobald der echte Weg verfügbar ist:
 *
 *  - **Wiederaufnahme:** ein wegen fehlender Verbindung blockierter Schritt (oder einer, der am KI-Dienst/Postfach gescheitert ist) läuft wieder an. Früher
 *    blieb er blockiert, bis jemand ihn von Hand wiederholte.
 *  - **Aufwertung:** ein als „simuliert“ abgeschlossener Schritt mit echtem Weg (KI-Analyse, Versand) wird mit allem, was von ihm abhing, zurückgesetzt und
 *    live ausgeführt. Nie, wenn dahinter schon etwas Unumkehrbares geschah (echter Versand, Angebot, Arbeit einer Person), nie bei reservierten Testadressen,
 *    nie bei alten Vorgängen und höchstens dreimal je Startschritt.
 */
@Injectable()
export class LiveReconciliationService {
  private readonly logger = new Logger(LiveReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PlanStoreService,
    private readonly ledger: ActionLedgerService,
    private readonly events: CaseEventsService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly facts: CaseFactsService,
    private readonly aiProviders: AiProviderResolverService,
    private readonly audit: AuditService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  get enabled(): boolean {
    return this.env.LIVE_UPGRADE_ENABLED !== 'false';
  }

  /** Läuft für diesen Mandanten eine echte KI? (Ein Provider ohne „mock“ im Namen.) */
  async aiIsLive(tenantId: string): Promise<boolean> {
    try {
      const llm = await this.aiProviders.resolveForTenant(tenantId, 'DOCUMENT_EXTRACTION');
      return !llm.providerName.toLowerCase().includes('mock');
    } catch {
      return false;
    }
  }

  /** Fälle mit einem Schritt, der auf eine Verbindung wartet oder simuliert lief – grobe Vorauswahl; ob etwas geschieht, entscheidet `reconcile`. */
  async candidates(now: Date = new Date(), tenantId?: string): Promise<Array<{ tenantId: string; caseId: string }>> {
    if (!this.enabled) return [];
    const cutoff = new Date(now.getTime() - this.maxAgeMs());
    const capabilityIs = (key: string) => ({ definition: { path: ['capability', 'key'], equals: key } });
    const nodes = await this.prisma.withRlsBypass((tx) =>
      tx.processPlanNode.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          plan: { status: 'ACTIVE', case: { orchestrationStatus: { notIn: [...TERMINAL, 'PAUSED'] }, updatedAt: { gte: cutoff } } },
          OR: [
            { state: 'BLOCKED', errorCode: 'CAPABILITY_NOT_EXECUTABLE' },
            { state: 'FAILED', errorCode: { in: [...AI_ERRORS, ...MAIL_ERRORS] }, attempts: { lt: MAX_REVIVALS } },
            { state: 'SUCCEEDED', executionMode: 'SIMULATED', OR: Object.keys(UPGRADABLE_CAPABILITIES).map(capabilityIs) },
          ],
        },
        select: { tenantId: true, plan: { select: { caseId: true } } },
        take: BATCH,
      }),
    );
    const unique = new Map<string, { tenantId: string; caseId: string }>();
    for (const n of nodes) unique.set(`${n.tenantId}:${n.plan.caseId}`, { tenantId: n.tenantId, caseId: n.plan.caseId });
    return [...unique.values()];
  }

  private maxAgeMs(): number {
    return Math.max(1, Number(this.env.LIVE_UPGRADE_MAX_AGE_DAYS ?? 7)) * 24 * 3_600_000;
  }

  private async liveAvailability(tenantId: string): Promise<{ ai: boolean; mail: boolean; executable: (capabilityKey: string) => boolean }> {
    const executability = await this.capabilities.executabilityFor(tenantId);
    const executable = (capabilityKey: string) => executability.get(capabilityKey)?.executable === true;
    return { ai: await this.aiIsLive(tenantId), mail: this.env.OUTBOUND_MAIL_MODE === 'gmail' && executable('email.send'), executable };
  }

  /**
   * Prüft einen Fall und nimmt Schritte wieder auf bzw. wiederholt simulierte live. `runningCompleteKey` ist der Abschlussschritt, der gerade läuft,
   * wenn die Prüfung aus dem Abschluss heraus geschieht: ein Fall wird nicht mit einem simulierten Schritt abgeschlossen, solange der echte Weg offen ist.
   */
  async reconcile(tenantId: string, caseId: string, options: { runningCompleteKey?: string } = {}): Promise<ReconcileResult> {
    const result: ReconcileResult = { resumed: [], redone: [] };
    if (!this.enabled) return result;
    const caseRow = await this.prisma.forTenantId(tenantId).case.findUnique({ where: { id: caseId } });
    if (!caseRow || TERMINAL.has(caseRow.orchestrationStatus) || caseRow.orchestrationStatus === 'PAUSED') return result;
    if (Date.now() - caseRow.updatedAt.getTime() > this.maxAgeMs()) return result;
    // Ein Fall, den gerade jemand bearbeitet (gültige Sperre), wird nicht von außen verändert – außer aus dem Abschluss heraus, der selbst unter der Sperre läuft.
    if (!options.runningCompleteKey && caseRow.leaseExpiresAt && caseRow.leaseExpiresAt.getTime() > Date.now()) return result;
    const graph = await this.store.getActive(tenantId, caseId);
    if (!graph) return result;
    const live = await this.liveAvailability(tenantId);

    // ── 1. Wiederaufnahme ────────────────────────────────────────────────────────────────────────────────────────
    for (const node of graph.nodes) {
      const capabilityKey = (node.definition as unknown as PlanNode).capability?.key;
      const code = node.errorCode ?? '';
      const resume =
        (node.state === 'BLOCKED' && code === 'CAPABILITY_NOT_EXECUTABLE' && capabilityKey !== undefined && live.executable(capabilityKey)) ||
        (node.state === 'FAILED' && node.attempts < MAX_REVIVALS && ((AI_ERRORS.has(code) && live.ai) || (MAIL_ERRORS.has(code) && live.mail)));
      if (resume && (await this.resumeNode(tenantId, caseId, graph, node))) result.resumed.push(node.nodeKey);
    }
    if (result.resumed.length > 0) {
      await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' });
      await this.record(tenantId, caseId, 'RESUMED', result.resumed, 'Die benötigte Verbindung bzw. der KI-Dienst ist wieder verfügbar.');
      return result;
    }

    // ── 2. Aufwertung simulierter Schritte ───────────────────────────────────────────────────────────────────────
    const nodes = this.upgradeNodes(graph, options.runningCompleteKey);
    const edges = graph.edges.map((e) => ({ source: e.sourceKey, target: e.targetKey }));
    const upgradable = nodes.filter((n) => isUpgradableSimulation(n) && (UPGRADABLE_CAPABILITIES[n.capabilityKey as string] === 'AI' ? live.ai : live.mail));
    if (upgradable.length === 0) return result;

    for (const startKey of earliestFirst(upgradable.map((n) => n.key), edges, nodes.map((n) => n.key))) {
      const verdict = evaluateUpgrade(nodes, edges, startKey);
      if (!verdict.ok) {
        result.skipped = verdict.reason;
        continue;
      }
      if (await this.redoCount(tenantId, caseId, startKey) >= MAX_REDOS_PER_START) {
        result.skipped = 'Der Schritt wurde bereits mehrfach live wiederholt und endet weiterhin simuliert.';
        continue;
      }
      // Ein echter Versand geht nie an eine reservierte Testadresse (example.*, .test, .invalid …): dort wohnt keine Person.
      const sends = verdict.resetKeys.some((key) => nodes.find((n) => n.key === key)?.capabilityKey === 'email.send');
      if (sends) {
        const target = (await this.facts.getCurrent(tenantId, caseId)).find((f) => f.key === 'contact.email' && f.status === 'CONFIRMED')?.value;
        if (typeof target === 'string' && isReservedTestAddress(target)) {
          result.skipped = 'Der Empfänger ist eine reservierte Testadresse; dorthin wird nie echt gesendet.';
          continue;
        }
      }
      await this.redo(tenantId, caseId, graph, verdict.resetKeys, startKey, options.runningCompleteKey);
      result.redone = verdict.resetKeys;
      result.skipped = undefined;
      break;
    }
    return result;
  }

  /** Warum ein Schritt (noch) simuliert ist und ob ORBIT ihn automatisch live wiederholt – als Hinweis für die Vorgangsansicht. */
  async hintFor(tenantId: string, caseId: string, nodeKey: string): Promise<string | undefined> {
    const graph = await this.store.getActive(tenantId, caseId);
    const node = graph?.nodes.find((n) => n.nodeKey === nodeKey);
    if (!graph || !node) return undefined;
    const capabilityKey = (node.definition as unknown as PlanNode).capability?.key;
    if (node.state === 'BLOCKED' && node.errorCode === 'CAPABILITY_NOT_EXECUTABLE') {
      return this.enabled ? 'ORBIT nimmt diesen Schritt automatisch wieder auf, sobald die Verbindung besteht.' : undefined;
    }
    if (node.state !== 'SUCCEEDED' || node.executionMode !== 'SIMULATED') return undefined;
    if (capabilityKey === 'pricing.resolve') return 'Der Preis stammt aus der Test-Preisquelle; ein echtes Preissystem ist nicht angebunden. Dieser Schritt kann nicht live laufen.';
    if (!capabilityKey || !(capabilityKey in UPGRADABLE_CAPABILITIES)) return undefined;
    const waysLive = UPGRADABLE_CAPABILITIES[capabilityKey] === 'AI' ? 'ein echter KI-Dienst' : 'ein echter Versand über Ihr Postfach';
    if (!this.enabled) return `Dieser Schritt lief simuliert. Die automatische Live-Wiederholung ist ausgeschaltet.`;
    const live = await this.liveAvailability(tenantId);
    const available = UPGRADABLE_CAPABILITIES[capabilityKey] === 'AI' ? live.ai : live.mail;
    if (!available) return `Dieser Schritt lief simuliert. ORBIT wiederholt ihn automatisch live, sobald ${waysLive} verfügbar ist.`;
    const nodes = this.upgradeNodes(graph);
    const verdict = evaluateUpgrade(nodes, graph.edges.map((e) => ({ source: e.sourceKey, target: e.targetKey })), node.nodeKey);
    if (!verdict.ok) return `Dieser Schritt lief simuliert und bleibt es: ${verdict.reason} Eine automatische Wiederholung würde etwas doppelt tun.`;
    return 'Dieser Schritt lief simuliert. ORBIT wiederholt ihn in Kürze automatisch live.';
  }

  // ── Umsetzung ───────────────────────────────────────────────────────────────────────────────────────────────────

  private upgradeNodes(graph: PlanGraph, runningCompleteKey?: string): UpgradeNode[] {
    return graph.nodes.map((n) => {
      const def = n.definition as unknown as PlanNode;
      return { key: n.nodeKey, type: n.type, state: n.nodeKey === runningCompleteKey ? 'PLANNED' : n.state, executionMode: n.executionMode, capabilityKey: def.capability?.key };
    });
  }

  private async resumeNode(tenantId: string, caseId: string, graph: PlanGraph, node: ProcessPlanNode): Promise<boolean> {
    const scoped = this.prisma.forTenantId(tenantId);
    const intent = await scoped.actionIntent.findFirst({ where: { caseId, nodeKey: node.nodeKey, planId: graph.plan.id }, orderBy: { createdAt: 'desc' } });
    if (intent && ['OUTCOME_UNKNOWN', 'DISPATCHING'].includes(intent.status)) return false;
    if (intent?.status === 'FAILED') await scoped.actionIntent.updateMany({ where: { id: intent.id, status: 'FAILED' }, data: { status: 'PREPARED', errorCode: null } });
    return this.store.transitionNode(tenantId, caseId, graph.plan.id, node.nodeKey, ['BLOCKED', 'FAILED'], { state: 'PLANNED', errorCode: null, errorMessage: null, completedAt: null });
  }

  private async redoCount(tenantId: string, caseId: string, startKey: string): Promise<number> {
    const rows = await this.prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: CASE_EVENT_TYPES.LIVE_UPGRADE }, orderBy: { sequence: 'desc' }, take: 50, select: { payload: true } });
    return rows.filter((r) => (r.payload as { kind?: string; startKey?: string } | null)?.kind === 'REDONE' && (r.payload as { startKey?: string }).startKey === startKey).length;
  }

  private async redo(tenantId: string, caseId: string, graph: PlanGraph, resetKeys: string[], startKey: string, runningCompleteKey?: string): Promise<void> {
    const scoped = this.prisma.forTenantId(tenantId);
    for (const key of resetKeys) {
      // Wirkungen dieses Schritts: eine simulierte Bestätigung oder eine noch nicht ausgeführte Absicht verliert ihre Gültigkeit; eine echte bleibt unangetastet.
      const intents = await scoped.actionIntent.findMany({ where: { caseId, planId: graph.plan.id, nodeKey: key } });
      for (const intent of intents) {
        if (intent.status === 'CONFIRMED') {
          const receipt = [...(await this.ledger.receipts(tenantId, intent.id))].reverse().find((r) => r.status === 'CONFIRMED');
          if (receipt?.executionMode === 'SIMULATED') {
            await this.supersede(tenantId, intent.id, intent.idempotencyKey, 'SIMULATION_SUPERSEDED');
            // Die simulierte Sendung hat den Entwurf lokal auf „gesendet“ gesetzt, gesendet wurde aber nichts: er ist wieder ein Entwurf.
            const draftId = ((intent.payload as { input?: { draftId?: unknown } } | null)?.input ?? {}).draftId;
            if (typeof draftId === 'string') await scoped.communicationDraft.updateMany({ where: { id: draftId, status: 'SENT' }, data: { status: 'DRAFT' } });
          }
        } else if (['PREPARED', 'AWAITING_APPROVAL', 'APPROVED'].includes(intent.status)) {
          await this.supersede(tenantId, intent.id, intent.idempotencyKey, 'LIVE_UPGRADE_RESET');
          if (intent.status === 'AWAITING_APPROVAL' && intent.approvalId) {
            await scoped.approval.updateMany({ where: { id: intent.approvalId, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date(), reason: 'Ersetzt: der Schritt wird live wiederholt.' } });
          }
        }
      }
      await scoped.waitSubscription.updateMany({ where: { caseId, planId: graph.plan.id, nodeKey: key, status: 'WAITING' }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
      // Die lokale Aufzeichnung einer simulierten Sendung ist keine gesendete Nachricht.
      const node = graph.nodes.find((n) => n.nodeKey === key);
      if ((node?.definition as unknown as PlanNode | undefined)?.capability?.key === 'email.send') {
        await scoped.emailMessage.updateMany({ where: { caseId, direction: 'OUTBOUND', providerMessageId: { startsWith: 'sim-' } }, data: { sentAt: null, classification: 'SIMULATED_SEND' } });
      }
      await this.store.transitionNode(tenantId, caseId, graph.plan.id, key, [...RESETTABLE], RESET_PATCH);
    }
    if (runningCompleteKey) await this.store.transitionNode(tenantId, caseId, graph.plan.id, runningCompleteKey, ['RUNNING'], RESET_PATCH);
    await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' });
    await this.record(tenantId, caseId, 'REDONE', resetKeys, 'Ein simulierter Schritt wird live wiederholt, weil der echte Weg jetzt verfügbar ist.', startKey);
  }

  private async supersede(tenantId: string, intentId: string, idempotencyKey: string, errorCode: string): Promise<void> {
    // Der Schlüssel wird freigegeben, damit dieselbe Aktion neu vorbereitet werden kann; die Zeile bleibt als Nachweis erhalten.
    await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intentId }, data: { status: 'CANCELLED', errorCode, idempotencyKey: `${idempotencyKey}:superseded:${intentId}` } });
  }

  private async record(tenantId: string, caseId: string, kind: 'RESUMED' | 'REDONE', nodeKeys: string[], reason: string, startKey?: string): Promise<void> {
    await this.events.append(tenantId, caseId, { type: CASE_EVENT_TYPES.LIVE_UPGRADE, payload: { kind, nodeKeys, reason, ...(startKey ? { startKey } : {}) } });
    await this.audit.record({ tenantId, eventType: 'PROCESS_LIVE_UPGRADE', actorType: 'SYSTEM', entityType: 'Case', entityId: caseId, payload: { kind, nodeKeys, reason } }).catch(() => undefined);
    this.logger.log(`live ${kind.toLowerCase()} case ${caseId}: ${nodeKeys.join(', ')}`);
  }
}
