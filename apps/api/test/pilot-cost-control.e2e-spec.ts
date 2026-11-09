import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { LLMCompletionRequest, LLMCompletionResult, LLMProvider } from '@orbit/agent-core';
import type { OrbitEnv } from '@orbit/config';
import { AiProviderUnavailableError, type AiProfileKey } from '@orbit/shared';
import { AiAdapterRegistry } from '../src/ai-governance/ai-adapter-registry.service';
import { AiCostGuardrailService } from '../src/ai-governance/ai-cost-guardrail.service';
import { PlatformAuditService } from '../src/platform/audit/platform-audit.service';
import { AiMeterService } from '../src/ai-governance/ai-meter.service';
import { AiRegistryService } from '../src/ai-governance/ai-registry.service';
import { PlatformSecretVaultService } from '../src/ai-governance/platform-secret-vault.service';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { ORBIT_ENV } from '../src/config/env.token';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CredentialEncryptionService } from '../src/security/credential-encryption.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Kostenkontrolle im verwendeten Umgebungsweg (ENV_BOOTSTRAP) gegen die echte Datenbank: Der Preis stammt aus dem Preiskatalog (Quelle und Prüfdatum), jeder Aufruf wird mit Kosten gemessen,
 * und ein durchgesetztes Kostenlimit rechnet Verbrauch PLUS laufende Aufrufe PLUS den schlimmsten Fall des neuen Aufrufs, BEVOR dieser beginnt. Der Anbieter ist ein Zähler-Double: es entsteht
 * kein bezahlter Aufruf; gezählt wird, wie viele Aufrufe den (hier nur simulierten) Anbieter erreichen.
 */
describe('Pilot cost control in the ENV_BOOTSTRAP path (e2e)', () => {
  const PROFILE = 'E2E_PILOT_COST' as AiProfileKey;
  const tenants: string[] = [];
  const limitIds: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let guard: AiCostGuardrailService;

  /** Ein Anbieter, der nur zählt. `usage` ist der gemeldete Verbrauch, `delayMs` hält den Aufruf offen (Gleichzeitigkeit), `fail` löst einen Anbieterfehler aus. */
  function fakeProvider(model: string, behaviour: { usage?: { inputTokens: number; outputTokens: number } | null; delayMs?: number; fail?: string } = {}) {
    const state = { started: 0 };
    const provider: LLMProvider = {
      providerName: 'openai',
      modelName: model,
      async complete(_request: LLMCompletionRequest): Promise<LLMCompletionResult> {
        state.started += 1;
        if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));
        if (behaviour.fail) throw new Error(behaviour.fail);
        const usage = behaviour.usage === undefined ? { inputTokens: 10_000, outputTokens: 1_000 } : behaviour.usage;
        return { text: 'ok', toolCalls: [], stopReason: 'end_turn', ...(usage ? { usage } : {}) };
      },
    };
    return { provider, state };
  }

  const REQUEST: LLMCompletionRequest = { messages: [{ role: 'user', content: 'Prüfen Sie diese Anfrage.' }], tools: [] };

  /** Löst wie der Betrieb auf (Umgebungsweg), nur mit dem Zähler-Double als Standardanbieter. */
  function resolverFor(platformDefault: LLMProvider, db: PrismaService = prisma, costGuard: AiCostGuardrailService = guard): AiProviderResolverService {
    return new AiProviderResolverService(
      db,
      app.get(CredentialEncryptionService),
      app.get(AiRegistryService),
      app.get(AiAdapterRegistry),
      app.get(PlatformSecretVaultService),
      new AiMeterService(db, app.get<OrbitEnv>(ORBIT_ENV)),
      costGuard,
      app.get(PlatformControlService),
      platformDefault,
      app.get<OrbitEnv>(ORBIT_ENV),
    );
  }

  async function newTenant(label: string): Promise<string> {
    const id = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `PC ${label} ${id.slice(0, 6)}`, slug: `e2e-pc-${label}-${id}`, adminEmail: `admin-${id}@e2e-pc.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'P', adminLastName: 'C' });
    tenants.push(tenant.id);
    return tenant.id;
  }

  async function enforce(tenantId: string, hardAmount: number, currency = 'USD'): Promise<void> {
    const created = await prisma.withPlatformScope((tx) =>
      tx.aICostLimit.create({ data: { scope: 'TENANT', scopeKey: `TENANT:${tenantId}`, targetTenantId: tenantId, currency, hardAmount, hardEnforced: true, note: 'E2E Pilot-Kostenkontrolle' } }),
    );
    limitIds.push(created.id);
  }

  const run = async (resolver: AiProviderResolverService, tenantId: string) => (await resolver.resolveProfile(tenantId, PROFILE)).provider.complete(REQUEST);
  const reservations = (tenantId: string) => prisma.withPlatformScope((tx) => tx.aICostReservation.findMany({ where: { targetTenantId: tenantId }, orderBy: { createdAt: 'asc' } }));
  const records = (tenantId: string) => prisma.forTenantId(tenantId).aIUsageRecord.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  const reasonOf = (error: unknown) => (error as AiProviderUnavailableError).details?.reasons;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    guard = app.get(AiCostGuardrailService);
  });

  afterAll(async () => {
    await prisma.withPlatformScope(async (tx) => {
      await tx.aICostLimit.deleteMany({ where: { id: { in: limitIds } } });
      await tx.aICostReservation.deleteMany({ where: { targetTenantId: { in: tenants } } });
    });
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  it('ohne durchgesetztes Limit läuft der Aufruf wie bisher, wird aber jetzt MIT Kosten gemessen (Preis aus dem Katalog) und braucht keine Reservierung', async () => {
    const tenant = await newTenant('frei');
    const { provider, state } = fakeProvider('gpt-6-luna');
    await run(resolverFor(provider), tenant);
    expect(state.started).toBe(1);
    const [record] = await records(tenant);
    expect(record).toMatchObject({ source: 'ENV_BOOTSTRAP', providerKey: 'openai', modelId: 'gpt-6-luna', inputTokens: 10_000, outputTokens: 1_000, costCurrency: 'USD' });
    expect(Number(record!.estimatedCost)).toBeCloseTo(0.0015, 9); // 10.000 × 0,10 + 1.000 × 0,50 je Mio.
    expect(await reservations(tenant)).toHaveLength(0);
  });

  it('bei ausgeschöpftem Budget beginnt KEIN weiterer bezahlter Aufruf: der Anbieter wird nicht erreicht, der Vorgang bekommt den ehrlichen Zustand „KI nicht verfügbar“', async () => {
    const tenant = await newTenant('seq');
    await enforce(tenant, 0.01);
    const { provider, state } = fakeProvider('gpt-6-luna');
    const resolver = resolverFor(provider);
    let accepted = 0;
    let rejection: unknown;
    for (let i = 0; i < 12; i += 1) {
      try {
        await run(resolver, tenant);
        accepted += 1;
      } catch (error) {
        rejection = error;
        break;
      }
    }
    expect(rejection).toBeInstanceOf(AiProviderUnavailableError);
    expect(reasonOf(rejection)).toEqual(['COST_LIMIT_HARD']);
    // Jeder Aufruf kostet 0,0015; ein neuer Aufruf beginnt nur, wenn Verbrauch + schlimmster Fall (≈ 0,002) das Limit nicht überschreiten.
    expect(accepted).toBe(6);
    expect(state.started).toBe(6);
    const before = state.started;
    for (let i = 0; i < 3; i += 1) await expect(run(resolver, tenant)).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(state.started).toBe(before); // weitere Aufrufe erreichen den Anbieter nie
    const spent = (await records(tenant)).reduce((sum, r) => sum + Number(r.estimatedCost), 0);
    expect(spent).toBeLessThanOrEqual(0.01);
    expect((await reservations(tenant)).every((r) => r.status === 'SETTLED')).toBe(true); // jeder Aufruf wurde zusammen mit seinem Verbrauch abgerechnet
  });

  it('laufende Aufrufe zählen mit: gleichzeitig gestartete Aufrufe können das Budget nicht gemeinsam überschreiten (nur so viele beginnen, wie ihr schlimmster Fall zusammen hineinpasst)', async () => {
    const tenant = await newTenant('par');
    await enforce(tenant, 0.01);
    const { provider, state } = fakeProvider('gpt-6-luna', { delayMs: 400 });
    const resolver = resolverFor(provider);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => run(resolver, tenant)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => r.reason instanceof AiProviderUnavailableError && reasonOf(r.reason)?.[0] === 'COST_LIMIT_HARD')).toBe(true);
    // Schlimmster Fall je Aufruf ≈ 0,00205 → vier passen in 0,01, der fünfte nicht. Ohne Reservierung hätten alle zehn begonnen.
    expect(ok).toBe(4);
    expect(state.started).toBe(4);
    expect((await reservations(tenant)).every((r) => r.status === 'SETTLED')).toBe(true); // jeder Aufruf wurde zusammen mit seinem Verbrauch abgerechnet
  });

  it('API und Worker sind getrennte Prozesse: zwei unabhängige Verbindungen (eigener Pool, eigene Dienste) halten das Budget gemeinsam ein – die Sperre liegt in der Datenbank, nicht im Prozess', async () => {
    const tenant = await newTenant('zweiprozesse');
    await enforce(tenant, 0.01);
    // „Worker“: eigene Datenbankverbindung und eigene Dienstinstanzen, nichts geteilt außer der Datenbank.
    const workerDb = new PrismaService(app.get<OrbitEnv>(ORBIT_ENV));
    try {
      const workerGuard = new AiCostGuardrailService(workerDb, app.get(PlatformAuditService));
      const apiSide = fakeProvider('gpt-6-luna', { delayMs: 3_000 }); // lang genug, dass alle zwölf Aufrufe überlappen (die zweite Verbindung braucht kalt einige hundert Millisekunden)
      const workerSide = fakeProvider('gpt-6-luna', { delayMs: 3_000 });
      const apiResolver = resolverFor(apiSide.provider);
      const workerResolver = resolverFor(workerSide.provider, workerDb, workerGuard);
      const calls = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? run(apiResolver, tenant) : run(workerResolver, tenant)));
      const results = await Promise.allSettled(calls);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
      expect(apiSide.state.started + workerSide.state.started).toBe(4);
      expect(results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').every((r) => reasonOf(r.reason)?.[0] === 'COST_LIMIT_HARD')).toBe(true);
      expect((await reservations(tenant)).every((r) => r.status === 'SETTLED')).toBe(true);
    } finally {
      await workerDb.$disconnect();
    }
  });

  it('ein vom Anbieter vor jeder Verarbeitung abgewiesener Aufruf (Rate-Limit) gibt die Reservierung ohne Verbrauch frei', async () => {
    const tenant = await newTenant('abgewiesen');
    await enforce(tenant, 0.01);
    const { provider } = fakeProvider('gpt-6-luna', { fail: '429 Too Many Requests' });
    await expect(run(resolverFor(provider), tenant)).rejects.toThrow('429');
    const rows = await reservations(tenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('RELEASED');
    expect(await records(tenant)).toMatchObject([{ status: 'ERROR', estimatedCost: null }]);
    const view = (await guard.list()).find((l) => l.targetTenantId === tenant)!;
    expect(view).toMatchObject({ spent: 0, reserved: 0, unsettled: 0 });
  });

  it('Zeitüberschreitung oder Serverfehler: die Ausgabe kann bereits entstanden sein – der reservierte schlimmste Fall wird als Verbrauch gebucht, die Reservierung nicht vorschnell freigegeben', async () => {
    const tenant = await newTenant('ungewiss');
    await enforce(tenant, 0.01);
    for (const message of ['Request timed out', '503 overloaded']) {
      const { provider } = fakeProvider('gpt-6-luna', { fail: message });
      await expect(run(resolverFor(provider), tenant)).rejects.toThrow();
    }
    const rows = await reservations(tenant);
    expect(rows.map((r) => r.status)).toEqual(['SETTLED', 'SETTLED']);
    const recs = await records(tenant);
    expect(recs.every((r) => r.status === 'ERROR' && Number(r.estimatedCost) > 0.002 && r.costCurrency === 'USD')).toBe(true);
    const view = (await guard.list()).find((l) => l.targetTenantId === tenant)!;
    expect(view.spent).toBeGreaterThan(0.004); // beide Versuche stehen als möglicher Verbrauch da
    expect(view.reserved).toBe(0);
  });

  it('ein abgeschlossener Aufruf zählt nie zugleich als Verbrauch und als offene Reservierung: während des Laufs nur reserviert, danach nur gemessen', async () => {
    const tenant = await newTenant('einmal');
    await enforce(tenant, 0.01);
    const { provider } = fakeProvider('gpt-6-luna', { delayMs: 1_500 });
    const running = run(resolverFor(provider), tenant);
    await new Promise((r) => setTimeout(r, 600));
    const during = (await guard.list()).find((l) => l.targetTenantId === tenant)!;
    expect(during.spent).toBe(0);
    expect(during.reserved).toBeGreaterThan(0.002);
    await running;
    const after = (await guard.list()).find((l) => l.targetTenantId === tenant)!;
    expect(after.spent).toBeCloseTo(0.0015, 9);
    expect(after.reserved).toBe(0);
    expect(after.unsettled).toBe(0);
    // Verbrauchszeile und Abrechnung der Reservierung sind eine Einheit: es gibt genau eine Zeile je Aufruf und genau eine abgerechnete Reservierung.
    expect(await records(tenant)).toHaveLength(1);
    expect((await reservations(tenant)).map((r) => r.status)).toEqual(['SETTLED']);
  });

  it('meldet der Anbieter keinen Verbrauch, gilt der reservierte schlimmste Fall als Obergrenze – nie 0', async () => {
    const tenant = await newTenant('ohne-usage');
    await enforce(tenant, 0.01);
    const { provider } = fakeProvider('gpt-6-luna', { usage: null });
    await run(resolverFor(provider), tenant);
    const [record] = await records(tenant);
    expect(Number(record!.estimatedCost)).toBeGreaterThan(0.002);
    expect(record!.costCurrency).toBe('USD');
  });

  it('unbekannter Preis oder abweichende Währung bei durchgesetztem Limit: der Aufruf beginnt nicht (kein Raten); ohne Limit läuft er', async () => {
    const tenant = await newTenant('preis');
    const unknown = fakeProvider('gpt-ohne-preis');
    await run(resolverFor(unknown.provider), tenant); // ohne Limit: läuft, Kosten bleiben leer
    expect((await records(tenant))[0]!.estimatedCost).toBeNull();
    expect(unknown.state.started).toBe(1);

    await enforce(tenant, 0.5);
    await expect(run(resolverFor(unknown.provider), tenant).catch((e: unknown) => Promise.reject(reasonOf(e)))).rejects.toEqual(['COST_PRICE_UNKNOWN']);
    expect(unknown.state.started).toBe(1);

    const other = await newTenant('waehrung');
    await enforce(other, 0.5, 'EUR');
    const known = fakeProvider('gpt-6-luna');
    await expect(run(resolverFor(known.provider), other).catch((e: unknown) => Promise.reject(reasonOf(e)))).rejects.toEqual(['COST_CURRENCY_MISMATCH']);
    expect(known.state.started).toBe(0);
  });

  it('ein Limit gilt nur für seinen Mandanten; eine nie abgerechnete Reservierung (Prozessabbruch) verschwindet NICHT still: nach Ablauf ihrer Frist zählt sie als möglicher Verbrauch weiter', async () => {
    const limited = await newTenant('begrenzt');
    const free = await newTenant('unbegrenzt');
    await enforce(limited, 0.01);
    const { provider, state } = fakeProvider('gpt-6-luna');
    const resolver = resolverFor(provider);
    // Ein abgestürzter Aufruf hinterlässt eine Reservierung, die den ganzen Rahmen belegt.
    await prisma.withPlatformScope((tx) => tx.aICostReservation.create({ data: { targetTenantId: limited, profileKey: PROFILE, currency: 'USD', amount: 0.0099, expiresAt: new Date(Date.now() + 60_000) } }));
    await expect(run(resolver, limited)).rejects.toBeInstanceOf(AiProviderUnavailableError); // offene Reservierung zählt
    await prisma.withPlatformScope((tx) => tx.aICostReservation.updateMany({ where: { targetTenantId: limited, status: 'RESERVED' }, data: { expiresAt: new Date(Date.now() - 1_000) } }));
    await expect(run(resolver, limited)).rejects.toBeInstanceOf(AiProviderUnavailableError); // Frist abgelaufen, nie abgerechnet: gilt weiter als möglicher Verbrauch
    const view = (await guard.list()).find((l) => l.targetTenantId === limited)!;
    expect(view).toMatchObject({ reserved: 0, unsettled: 0.0099 }); // Rest 0,0001 < schlimmster Fall eines Aufrufs: kein weiterer Aufruf beginnt
    await expect(run(resolver, free)).resolves.toBeDefined(); // anderer Mandant unberührt
    expect(state.started).toBe(1);
  });

  it('die Bewertung des Limits weist die laufenden Reservierungen aus', async () => {
    const tenant = await newTenant('anzeige');
    await enforce(tenant, 0.01);
    await prisma.withPlatformScope((tx) => tx.aICostReservation.create({ data: { targetTenantId: tenant, profileKey: PROFILE, currency: 'USD', amount: 0.003, expiresAt: new Date(Date.now() + 60_000) } }));
    const view = (await guard.list()).find((l) => l.targetTenantId === tenant)!;
    expect(view).toMatchObject({ spent: 0, reserved: 0.003, hardEnforced: true });
  });
});
