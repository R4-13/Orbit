import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CasesService } from '../src/cases/cases.service';
import { AiMeterService } from '../src/ai-governance/ai-meter.service';
import { currentCaseId, runInCaseContext } from '../src/common/case-context';
import { buildEmergencyProcedure } from '../src/process/emergency-procedure';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** Grenzen je Betrieb (BPF-04) und KI-Kostengrenze je Vorgang (BPF-01) gegen echte Postgres. */
describe('Grenzen und KI-Kosten je Vorgang (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let userId: string;
  let token: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  /** Ein Ablauf ohne Eingangsnachricht: erst die Benachrichtigung (Schritt „notify_staff“), dann der Mensch. */
  const procedure = () => {
    const full = buildEmergencyProcedure({ message: 'Test: bitte prüfen', acknowledgeSender: false });
    return { ...full, nodes: full.nodes.filter((n) => n.id !== 'sender_check'), edges: full.edges.filter((e) => e.source !== 'sender_check') };
  };

  async function newCase(title: string): Promise<string> {
    const created = await app.get(CasesService).create(tenantId, userId, { type: 'GENERAL', title });
    return created.id;
  }
  const nodeState = async (caseId: string, key: string) => (await app.get(PlanStoreService).getActive(tenantId, caseId))?.nodes.find((n) => n.nodeKey === key)?.state;
  const status = (caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const spend = (caseId: string | null, cost: string) =>
    prisma.forTenantId(tenantId).aIUsageRecord.create({ data: { tenantId, profileKey: 'test', providerKey: 'test', environment: 'test', source: 'ORBIT_MANAGED', status: 'OK', estimatedCost: cost, costCurrency: 'EUR', caseId } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Lim ${suffix.slice(0, 8)}`, slug: `e2e-limits-${suffix}`, adminEmail: `a-${suffix}@e2e-limits.example`, adminPassword: PASSWORD, adminFirstName: 'A', adminLastName: 'B' });
    tenantId = tenant.id;
    userId = adminUser.id;
    token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
    await prisma.forTenantId(tenantId).policyConfig.upsert({ where: { tenantId_action: { tenantId, action: 'staff.notify' } }, create: { tenantId, action: 'staff.notify', mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  it('der Vorgangskontext ordnet Aufrufe dem Vorgang zu und endet mit dem Aufruf', async () => {
    expect(currentCaseId()).toBeUndefined();
    await runInCaseContext('case-1', async () => {
      await Promise.resolve();
      expect(currentCaseId()).toBe('case-1');
    });
    expect(currentCaseId()).toBeUndefined();
  });

  it('der Zähler schreibt den Vorgang an die Nutzung – ohne Kontext bleibt sie ohne Vorgang', async () => {
    const meter = app.get(AiMeterService);
    const c = await newCase('Zähler');
    const context = { tenantId, profileKey: 'meter-test', providerKey: 'test', source: 'ORBIT_MANAGED' as const, trackHealth: false, cost: { inputPerMtok: 1000, outputPerMtok: 1000, currency: 'EUR' } };
    await runInCaseContext(c, () => meter.record(context, { ok: true, latencyMs: 5, usage: { inputTokens: 1000, outputTokens: 1000 } }));
    await meter.record({ ...context, profileKey: 'meter-test-ohne' }, { ok: true, latencyMs: 5, usage: { inputTokens: 1, outputTokens: 1 } });
    const rows = await prisma.forTenantId(tenantId).aIUsageRecord.findMany({ where: { profileKey: { in: ['meter-test', 'meter-test-ohne'] } } });
    expect(rows.find((r) => r.profileKey === 'meter-test')).toMatchObject({ caseId: c });
    expect(Number(rows.find((r) => r.profileKey === 'meter-test')?.estimatedCost)).toBeCloseTo(2, 5);
    expect(rows.find((r) => r.profileKey === 'meter-test-ohne')?.caseId).toBeNull();
  });

  it('eigene Grenzen speichern, einzeln zurücksetzen und ungültige abweisen', async () => {
    await api().put('/api/v1/tenant/profile').set(auth()).send({ processLimits: { maxAiCostPerCase: 1.5, maxActionsPerCase: 4 } }).expect(200);
    expect((await prisma.forTenantId(tenantId).tenantProfile.findUniqueOrThrow({ where: { tenantId } })).processLimits).toEqual({ maxAiCostPerCase: 1.5, maxActionsPerCase: 4 });
    const state = (await api().get('/api/v1/tenant/profile').set(auth()).expect(200)).body as { profile: { processLimits: Record<string, number> } };
    expect(state.profile.processLimits).toEqual({ maxAiCostPerCase: 1.5, maxActionsPerCase: 4 });
    await api().put('/api/v1/tenant/profile').set(auth()).send({ processLimits: { maxActionsPerCase: null } }).expect(200);
    expect((await prisma.forTenantId(tenantId).tenantProfile.findUniqueOrThrow({ where: { tenantId } })).processLimits).toEqual({ maxAiCostPerCase: 1.5 });
    await api().put('/api/v1/tenant/profile').set(auth()).send({ processLimits: { maxActionsPerCase: 0 } }).expect(400);
    await api().put('/api/v1/tenant/profile').set(auth()).send({ processLimits: { maxSteps: 3 } }).expect(400); // nicht vom Betrieb setzbar
  });

  it('unter der Kostengrenze läuft der Vorgang; ab der Grenze legt ORBIT ihn zur Prüfung vor, ohne den nächsten Schritt zu starten', async () => {
    const orchestrator = app.get(OrchestratorService);

    const cheap = await newCase('Günstig');
    await orchestrator.startProcedure(tenantId, cheap, procedure());
    await spend(cheap, '0.40');
    await orchestrator.advance(tenantId, cheap);
    expect(await nodeState(cheap, 'notify_staff')).toBe('SUCCEEDED');

    const costly = await newCase('Teuer');
    await orchestrator.startProcedure(tenantId, costly, procedure());
    await spend(costly, '1.20');
    await spend(costly, '0.40'); // Summe 1,60 ≥ Grenze 1,50
    await orchestrator.advance(tenantId, costly);
    const row = await status(costly);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.attentionReasons.join(' ')).toContain('KI-Kosten');
    expect(await nodeState(costly, 'notify_staff')).not.toBe('SUCCEEDED');
  });

  it('Kosten anderer Vorgänge und Aufrufe ohne Vorgang zählen nicht', async () => {
    const orchestrator = app.get(OrchestratorService);
    const other = await newCase('Anderer Vorgang');
    await spend(other, '9.00');
    await spend(null, '9.00');
    const mine = await newCase('Mein Vorgang');
    await orchestrator.startProcedure(tenantId, mine, procedure());
    await orchestrator.advance(tenantId, mine);
    expect(await nodeState(mine, 'notify_staff')).toBe('SUCCEEDED');
  });

  it('ohne eigene Grenze gilt der Standard der Plattform (5 Währungseinheiten)', async () => {
    await api().put('/api/v1/tenant/profile').set(auth()).send({ processLimits: { maxAiCostPerCase: null } }).expect(200);
    const orchestrator = app.get(OrchestratorService);
    const c = await newCase('Standardgrenze');
    await orchestrator.startProcedure(tenantId, c, procedure());
    await spend(c, '4.00');
    await orchestrator.advance(tenantId, c);
    expect(await nodeState(c, 'notify_staff')).toBe('SUCCEEDED');
    const d = await newCase('Über Standardgrenze');
    await orchestrator.startProcedure(tenantId, d, procedure());
    await spend(d, '5.50');
    await orchestrator.advance(tenantId, d);
    expect((await status(d)).orchestrationStatus).toBe('MANUAL_REVIEW');
  });
});
