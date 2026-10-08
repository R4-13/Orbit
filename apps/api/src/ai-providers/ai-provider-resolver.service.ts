import { Inject, Injectable } from '@nestjs/common';
import { MockLLMProvider, type LLMProvider } from '@orbit/agent-core';
import type { OrbitEnv } from '@orbit/config';
import {
  AiProviderUnavailableError,
  KILL_SWITCHES,
  effectiveHealth,
  evaluateCandidate,
  planFallbackChain,
  type AiProfileKey,
  type HealthState,
} from '@orbit/shared';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { AiAdapterRegistry } from '../ai-governance/ai-adapter-registry.service';
import { AiCostGuardrailService } from '../ai-governance/ai-cost-guardrail.service';
import { AiMeterService, type MeterContext } from '../ai-governance/ai-meter.service';
import { AiRegistryService, type ModelWithProvider } from '../ai-governance/ai-registry.service';
import { FailoverLLMProvider, MeteredLLMProvider } from '../ai-governance/metered-llm-provider';
import { PlatformSecretVaultService } from '../ai-governance/platform-secret-vault.service';
import { LLM_PROVIDER } from '../agent/agent.tokens';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';
import { buildProviderAdapter } from './ai-provider-adapter-factory';

export type AiResolutionSource = 'BYOK' | 'ORBIT_MANAGED' | 'ENV_BOOTSTRAP';

export interface ResolvedLlm {
  provider: LLMProvider;
  source: AiResolutionSource;
  providerKey: string;
  modelId?: string;
  routeId?: string;
  /** Der primär vorgesehene Pfad ist eingeschränkt (gedrosselt/degradiert) oder ein Fallback bedient den Aufruf. */
  degraded: boolean;
}

const DEFAULT_PROFILE: AiProfileKey = 'AGENT_TOOL_USE';

/**
 * Laufzeit-Auflösung „welches Modell bedient diesen Aufruf?“ (Amendment 03 §8–§12, §22). Geschäftscode nennt nur ein logisches Profil
 * (`FAST_CLASSIFICATION`, `COMPLEX_REASONING`, …) – nie einen Anbieter oder ein Modell (OPS-07).
 *
 *  1. BYOK (der Mandant hat erfolgreich einen eigenen Schlüssel verbunden): ausschließlich dieser Weg. Fällt er aus, gibt es einen ehrlichen Fehler –
 *     NIE ein stilles Zurückfallen auf die Plattform oder einen anderen Anbieter (OAI-07/08, OPS-10).
 *  2. ORBIT Managed: aktive Route des Profils (Mandanten-Override vor globaler Route) → Kette gemäß Fallback-Modus → erster Kandidat, der Freigabe,
 *     Verbindung, Fähigkeiten, Region/Datenrichtlinie und Gesundheit erfüllt. Gibt es eine Route, aber keinen zulässigen Kandidaten: Fehler (OAI-05).
 *  3. Nur wenn für das Profil KEINE Route konfiguriert ist: der per Umgebung konfigurierte Standard (Bootstrap, wie bisher) – sichtbar als `ENV_BOOTSTRAP`.
 *
 * Adapter werden nicht zwischengespeichert: ein Adapter hält nur Schlüssel + Modellname, Neubau ist günstig, und so wirkt eine Rotation sofort.
 */
@Injectable()
export class AiProviderResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly registry: AiRegistryService,
    private readonly adapters: AiAdapterRegistry,
    private readonly vault: PlatformSecretVaultService,
    private readonly meter: AiMeterService,
    private readonly costGuard: AiCostGuardrailService,
    private readonly platformControl: PlatformControlService,
    @Inject(LLM_PROVIDER) private readonly platformDefault: LLMProvider,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /** Bequemer Zugriff für Aufrufer, die nur den Provider brauchen. */
  async resolveForTenant(tenantId: string, profileKey: AiProfileKey = DEFAULT_PROFILE): Promise<LLMProvider> {
    return (await this.resolveProfile(tenantId, profileKey)).provider;
  }

  async resolveProfile(tenantId: string, profileKey: AiProfileKey = DEFAULT_PROFILE): Promise<ResolvedLlm> {
    // Plattform-Kill-Switch (Amendment 03 §15): sofort wirksam für NEUE Aufrufe, ohne Historie zu berühren; laufende Vorgänge erhalten einen ehrlichen Blockzustand.
    if (await this.platformControl.killSwitchEngaged(KILL_SWITCHES.AI_EXECUTIONS)) {
      throw new AiProviderUnavailableError('KI-Ausführungen sind plattformweit vorübergehend gestoppt.', { mode: 'PLATFORM', profileKey, reasons: [`KILL_SWITCH:${KILL_SWITCHES.AI_EXECUTIONS}`] });
    }
    const byok = await this.resolveByok(tenantId, profileKey);
    if (byok) return byok;
    return this.resolveManaged(tenantId, profileKey);
  }

  // ── BYOK ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async resolveByok(tenantId: string, profileKey: AiProfileKey): Promise<ResolvedLlm | null> {
    const connection = await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } });
    if (!connection?.byokActiveSince) return null; // nie erfolgreich BYOK genutzt (oder ausdrücklich getrennt) → ORBIT Managed

    const providerKey = connection.providerKey.toLowerCase();
    const unavailable = (reasons: string[]) =>
      new AiProviderUnavailableError('Die KI-Verbindung des Unternehmens (eigener Schlüssel) ist nicht verfügbar. Es wird bewusst nicht auf einen anderen Anbieter ausgewichen.', { mode: 'BYOK', providerKey, profileKey, reasons });

    if (connection.status !== 'CONNECTED' || !connection.encryptedCredentials || !connection.model) throw unavailable(['BYOK_CONNECTION_UNAVAILABLE']);

    const state = await this.registry.byokState(providerKey, connection.model);
    if (state.providerKnown && !state.providerActive) throw unavailable(['PROVIDER_NOT_ACTIVE']);
    if (state.modelsKnown && !state.modelApproved) throw unavailable(['MODEL_NOT_APPROVED']);

    const apiKey = this.encryption.decrypt(Buffer.from(connection.encryptedCredentials));
    const adapter = buildProviderAdapter(connection.providerKey, apiKey, connection.model);
    const context: MeterContext = { tenantId, profileKey, providerKey, modelId: connection.model, source: 'BYOK', trackHealth: false };
    return { provider: new MeteredLLMProvider(adapter, this.meter, context), source: 'BYOK', providerKey, modelId: connection.model, degraded: false };
  }

  // ── ORBIT Managed ──────────────────────────────────────────────────────────────────────────────────────────────────

  private async resolveManaged(tenantId: string, profileKey: AiProfileKey): Promise<ResolvedLlm> {
    const snapshot = await this.registry.routingSnapshot(profileKey, tenantId);
    if (!snapshot.route) return this.bootstrap(tenantId, profileKey);
    if (!snapshot.profile) {
      throw new AiProviderUnavailableError('Für dieses KI-Profil ist keine veröffentlichte Version vorhanden.', { mode: 'ORBIT_MANAGED', profileKey, reasons: ['PROFILE_NOT_PUBLISHED'] });
    }

    const { route, profile } = snapshot;
    const providerOf = (modelId: string) => snapshot.models.get(modelId)?.providerKey;
    const chain = planFallbackChain({ primaryModelId: route.primaryModelId, fallbackModelIds: route.fallbackModelIds, fallbackMode: route.fallbackMode }, providerOf);
    const now = new Date();
    const tenantRegion = this.registry.tenantRegion(tenantId);
    const allReasons: string[] = [];

    const usable: Array<{ model: ModelWithProvider; degraded: boolean; adapter: LLMProvider }> = [];
    for (const modelId of chain) {
      const model = snapshot.models.get(modelId);
      if (!model) {
        allReasons.push(`${modelId}:MODEL_NOT_FOUND`);
        continue;
      }
      const connection = snapshot.connections.get(model.providerKey) ?? null;
      const health = this.healthFor(snapshot.health, model);
      const verdict = evaluateCandidate({
        profile: { key: profile.profileKey, requiredCapabilities: profile.requiredCapabilities, requiredDataPolicyRefs: profile.requiredDataPolicyRefs },
        provider: model.provider,
        model,
        connection: connection ? { lifecycle: connection.lifecycle, allowedProfileKeys: connection.allowedProfileKeys } : null,
        health: { status: effectiveHealth(health, now) },
        tenantRegion,
      });
      if (!verdict.usable || !connection) {
        allReasons.push(...verdict.reasons.map((reason) => `${model.providerKey}/${model.providerModelId}:${reason}`));
        continue;
      }
      try {
        const secret = await this.vault.read(connection.secretRef);
        const adapter = this.adapters.build(model.provider.adapterKey, { apiKey: String(secret.apiKey ?? ''), providerModelId: model.providerModelId });
        const context: MeterContext = {
          tenantId,
          profileKey,
          providerKey: model.providerKey,
          modelId: model.providerModelId,
          routeId: route.id,
          source: 'ORBIT_MANAGED',
          trackHealth: true,
          cost: model.costInputPerMtok !== null && model.costOutputPerMtok !== null ? { inputPerMtok: Number(model.costInputPerMtok), outputPerMtok: Number(model.costOutputPerMtok), currency: model.costCurrency } : null,
        };
        // Der Mock-Adapter verursacht keine externe Nutzung und bleibt unverpackt (Tests/Simulation erkennen ihn weiterhin).
        const wrapped = adapter instanceof MockLLMProvider ? adapter : new MeteredLLMProvider(adapter, this.meter, context, () => this.costGuard.assertWithinBudget(tenantId, profileKey));
        usable.push({ model, degraded: verdict.degraded || usable.length > 0 || modelId !== route.primaryModelId, adapter: wrapped });
      } catch {
        allReasons.push(`${model.providerKey}/${model.providerModelId}:SECRET_UNAVAILABLE`);
      }
    }

    if (usable.length === 0) {
      throw new AiProviderUnavailableError('Für diesen Aufruf steht derzeit kein freigegebenes KI-Modell zur Verfügung.', { mode: 'ORBIT_MANAGED', profileKey, routeId: route.id, reasons: allReasons });
    }
    const first = usable[0] as (typeof usable)[number];
    const provider = usable.length === 1 ? first.adapter : new FailoverLLMProvider(usable.map((u) => u.adapter));
    return { provider, source: 'ORBIT_MANAGED', providerKey: first.model.providerKey, modelId: first.model.providerModelId, routeId: route.id, degraded: first.degraded };
  }

  private healthFor(health: Map<string, HealthState>, model: ModelWithProvider): HealthState | null {
    const providerWide = health.get(`${model.providerKey}|*`) ?? null;
    const modelSpecific = health.get(`${model.providerKey}|${model.providerModelId}`) ?? null;
    // Die schlechtere Sicht gilt: ein einzelnes Modell kann ausfallen, während der Anbieter sonst antwortet – und umgekehrt.
    const rank = (s: HealthState | null) => (s ? ['UP', 'UNKNOWN', 'DEGRADED', 'RATE_LIMITED', 'DOWN', 'DISABLED'].indexOf(effectiveHealth(s, new Date())) : -1);
    return rank(modelSpecific) >= rank(providerWide) ? modelSpecific : providerWide;
  }

  // ── Bootstrap (keine Route für das Profil) ─────────────────────────────────────────────────────────────────────────

  private bootstrap(tenantId: string, profileKey: AiProfileKey): ResolvedLlm {
    const llm: LLMProvider = this.platformDefault;
    const providerKey = llm.providerName.toLowerCase();
    if (llm instanceof MockLLMProvider) return { provider: llm, source: 'ENV_BOOTSTRAP', providerKey, modelId: undefined, degraded: false };
    const context: MeterContext = { tenantId, profileKey, providerKey, modelId: llm.modelName, source: 'ENV_BOOTSTRAP', trackHealth: true };
    return { provider: new MeteredLLMProvider(llm, this.meter, context, () => this.costGuard.assertWithinBudget(tenantId, profileKey)), source: 'ENV_BOOTSTRAP', providerKey, modelId: llm.modelName, degraded: false };
  }
}
