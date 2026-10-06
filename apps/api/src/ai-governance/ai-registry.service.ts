import { Inject, Injectable } from '@nestjs/common';
import type { AIModelDefinition, AIModelProfile, AIProviderDefinition, AIProviderRoute, PlatformAIConnection } from '@orbit/domain';
import type { OrbitEnv } from '@orbit/config';
import { routeInWindow, stableBucket, type HealthState } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';

export type ModelWithProvider = AIModelDefinition & { provider: AIProviderDefinition };

export interface RoutingSnapshot {
  environment: string;
  profile: AIModelProfile | null;
  route: AIProviderRoute | null;
  /** Modelle der Route (primär + Fallbacks) inkl. Anbieter, nach Modell-ID. */
  models: Map<string, ModelWithProvider>;
  /** Plattformverbindung je Anbieter in dieser Umgebung. */
  connections: Map<string, PlatformAIConnection>;
  /** Gesundheit je `<anbieter>|<providerModelId>` (Modell) bzw. `<anbieter>|*` (gesamter Anbieter). */
  health: Map<string, HealthState>;
}

export interface ByokRegistryState {
  providerKnown: boolean;
  providerActive: boolean;
  /** Gibt es im Register überhaupt Modelle dieses Anbieters? Wenn nicht, ist das Register für ihn noch nicht gepflegt (Bootstrap). */
  modelsKnown: boolean;
  modelApproved: boolean;
}

/**
 * Lesender Zugriff auf die AI-Plattformregister (Amendment 03 §8): Anbieter, Modelle, veröffentlichte Profile, aktive Routen, Plattformverbindungen und
 * Gesundheit. Der Laufzeitpfad (`AiProviderResolverService`) liest den gesamten Routing-Zustand für einen Aufruf in EINER Transaktion – so entscheidet er
 * auf einem konsistenten Stand, und die Registerdaten verlassen den Plattform-Zugriffspfad nie in Mandantencode.
 */
@Injectable()
export class AiRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Plattform-Standardregion für die Datenrichtlinie, solange der Mandant keine eigene Region trägt (Annahme in ASSUMPTIONS). */
  tenantRegion(_tenantId: string): string {
    return this.env.ORBIT_DEFAULT_DATA_REGION;
  }

  async routingSnapshot(profileKey: string, tenantId: string, now: Date = new Date()): Promise<RoutingSnapshot> {
    const environment = this.env.ORBIT_ENVIRONMENT;
    return this.prisma.withPlatformScope(async (tx) => {
      const profile = await tx.aIModelProfile.findFirst({ where: { profileKey, lifecycle: 'PUBLISHED' }, orderBy: { version: 'desc' } });
      const candidates = await tx.aIProviderRoute.findMany({
        where: { modelProfileKey: profileKey, environment, active: true, OR: [{ tenantScope: tenantId }, { tenantScope: null }] },
      });
      // Mandanten-Override vor globaler Route; außerhalb des Zeitfensters oder des Traffic-Anteils zählt eine Route nicht.
      const usable = candidates
        .filter((route) => routeInWindow(route, now) && stableBucket(tenantId, route.id) < route.trafficPercent)
        .sort((a, b) => Number(b.tenantScope !== null) - Number(a.tenantScope !== null));
      const route = usable[0] ?? null;

      const models = new Map<string, ModelWithProvider>();
      const connections = new Map<string, PlatformAIConnection>();
      const health = new Map<string, HealthState>();
      if (route) {
        const rows = await tx.aIModelDefinition.findMany({ where: { id: { in: [route.primaryModelId, ...route.fallbackModelIds] } }, include: { provider: true } });
        for (const row of rows) models.set(row.id, row);
        const providerKeys = [...new Set(rows.map((r) => r.providerKey))];
        for (const connection of await tx.platformAIConnection.findMany({ where: { providerKey: { in: providerKeys }, environment } })) connections.set(connection.providerKey, connection);
        for (const row of await tx.aIProviderHealth.findMany({ where: { providerKey: { in: providerKeys }, environment } })) {
          health.set(`${row.providerKey}|${row.modelRef}`, { status: row.status, consecutiveFailures: row.consecutiveFailures, lastSuccessAt: row.lastSuccessAt, lastFailureAt: row.lastFailureAt, lastErrorClass: row.lastErrorClass, avgLatencyMs: row.avgLatencyMs });
        }
      }
      return { environment, profile, route, models, connections, health };
    });
  }

  /** Einen Wert gibt es nur, wenn das Register für den Anbieter gepflegt ist – andernfalls gilt der Bootstrap-Stand (kein Register = keine Einschränkung). */
  async byokState(providerKey: string, providerModelId: string | null): Promise<ByokRegistryState> {
    return this.prisma.withPlatformScope(async (tx) => {
      const provider = await tx.aIProviderDefinition.findUnique({ where: { providerKey } });
      const models = await tx.aIModelDefinition.findMany({ where: { providerKey } });
      return {
        providerKnown: Boolean(provider),
        providerActive: provider?.lifecycle === 'ACTIVE',
        modelsKnown: models.length > 0,
        modelApproved: models.some((m) => m.providerModelId === providerModelId && m.lifecycle === 'APPROVED'),
      };
    });
  }
}
