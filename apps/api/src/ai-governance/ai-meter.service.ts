import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { applyHealthOutcome, classifyLlmError, estimateCost, type HealthState, type LlmErrorClass } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';

export interface MeterContext {
  tenantId: string;
  profileKey: string;
  providerKey: string;
  modelId?: string;
  routeId?: string;
  source: 'ORBIT_MANAGED' | 'BYOK' | 'ENV_BOOTSTRAP';
  /** Kostenprofil je 1 Mio. Token (nur wenn im Modellregister gepflegt). */
  cost?: { inputPerMtok: number | null; outputPerMtok: number | null; currency: string } | null;
  /** Gesundheit nur für Plattformverbindungen führen – BYOK-Schlüssel gehören dem Mandanten und sagen nichts über die Plattform aus. */
  trackHealth: boolean;
}

export interface MeterOutcome {
  ok: boolean;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: unknown;
}

/**
 * Misst jeden echten Modellaufruf (Amendment 03 §12): Nutzung je Mandant/Profil/Anbieter/Modell (ohne Prompt- oder Antwortinhalt) und
 * Anbietergesundheit. Fehler beim Messen dürfen den fachlichen Aufruf nie verändern – sie werden protokolliert und verschluckt.
 */
@Injectable()
export class AiMeterService {
  private readonly logger = new Logger('AiMeter');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  async record(context: MeterContext, outcome: MeterOutcome): Promise<void> {
    const errorClass: LlmErrorClass | undefined = outcome.ok ? undefined : classifyLlmError(outcome.error);
    try {
      const cost = context.cost ? estimateCost(outcome.usage ?? {}, { inputPerMtok: context.cost.inputPerMtok, outputPerMtok: context.cost.outputPerMtok }) : null;
      await this.prisma.forTenantId(context.tenantId).aIUsageRecord.create({
        data: {
          tenantId: context.tenantId,
          profileKey: context.profileKey,
          providerKey: context.providerKey,
          modelId: context.modelId,
          routeId: context.routeId,
          environment: this.env.ORBIT_ENVIRONMENT,
          source: context.source,
          status: outcome.ok ? 'OK' : 'ERROR',
          errorClass,
          inputTokens: outcome.usage?.inputTokens,
          outputTokens: outcome.usage?.outputTokens,
          latencyMs: outcome.latencyMs,
          estimatedCost: cost,
          costCurrency: cost === null ? undefined : context.cost?.currency,
        },
      });
    } catch (error) {
      this.logger.warn(`usage record failed: ${error instanceof Error ? error.name : 'error'}`);
    }
    if (context.trackHealth) await this.recordHealth(context.providerKey, context.modelId ?? '*', { ok: outcome.ok, latencyMs: outcome.latencyMs, errorClass });
  }

  /** Gesundheit je Anbieter (`*`) und je Modell; ein Anbieter ist so gesund wie sein Gesamtzustand, ein Modell kann einzeln auffallen. */
  async recordHealth(providerKey: string, modelRef: string, outcome: { ok: boolean; latencyMs?: number; errorClass?: LlmErrorClass }): Promise<void> {
    try {
      const environment = this.env.ORBIT_ENVIRONMENT;
      const now = new Date();
      await this.prisma.withPlatformScope(async (tx) => {
        for (const ref of new Set(['*', modelRef])) {
          const row = await tx.aIProviderHealth.findUnique({ where: { providerKey_modelRef_environment: { providerKey, modelRef: ref, environment } } });
          const previous: HealthState | null = row ? { status: row.status, consecutiveFailures: row.consecutiveFailures, lastSuccessAt: row.lastSuccessAt, lastFailureAt: row.lastFailureAt, lastErrorClass: row.lastErrorClass, avgLatencyMs: row.avgLatencyMs } : null;
          if (row?.status === 'DISABLED') continue; // ein ausdrücklich deaktivierter Anbieter wird nicht durch Messwerte „wiederbelebt“
          const next = applyHealthOutcome(previous, outcome, now);
          const data = { status: next.status, consecutiveFailures: next.consecutiveFailures, lastSuccessAt: next.lastSuccessAt ?? null, lastFailureAt: next.lastFailureAt ?? null, lastErrorClass: next.lastErrorClass ?? null, avgLatencyMs: next.avgLatencyMs ?? null };
          await tx.aIProviderHealth.upsert({ where: { providerKey_modelRef_environment: { providerKey, modelRef: ref, environment } }, create: { providerKey, modelRef: ref, environment, ...data }, update: data });
        }
      });
    } catch (error) {
      this.logger.warn(`health record failed: ${error instanceof Error ? error.name : 'error'}`);
    }
  }
}
