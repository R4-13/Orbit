import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { SHADOW_PLAN_LIMIT_PER_TENANT, SHADOW_QUOTA_MAX_PER_GRANT, type PlanProposal } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ShadowPlanService } from '../src/process/shadow-plan.service';
import { ShadowQuotaService } from '../src/process/shadow-quota.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

type Node = PlanProposal['nodes'][number];
const node = (id: string, type: Node['type'], extra: Partial<Node> = {}): Node => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });

/**
 * Zusätzliches Kontingent an Schattenplanungen (Prüfplan D9) gegen die echte Datenbank: Standard ist „kein Kontingent“; ein Kontingent entsteht INAKTIV, wirkt erst nach Aktivierung und nur an der
 * Grundgrenze; die bisherige Grundzählung bleibt unverändert; Verbrauch, Reservierung und Wiederholungen stehen einzeln im Hauptbuch und überleben das Löschen von Vorgängen.
 * Modell und Versand sind Testdoubles.
 */
describe('Schattenplanung: Zusatzkontingent (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shadow: ShadowPlanService;
  let quota: ShadowQuotaService;
  let llm: MockLLMProvider;
  const tenants: string[] = [];

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `SQ ${suffix.slice(0, 8)}`, slug: `e2e-sq-${suffix}`, adminEmail: `admin-${suffix}@e2e-sq.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'S', adminLastName: 'Q' });
    tenants.push(tenant.id);
    return tenant.id;
  }

  async function setShadow(tenantId: string, on: boolean): Promise<void> {
    await prisma.withPlatformScope(async (tx) => {
      const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'planner.shadow' } });
      const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => o.tenantId !== tenantId);
      if (on) overrides.push({ tenantId, value: true });
      await tx.platformFeatureFlag.update({ where: { key: 'planner.shadow' }, data: { tenantOverrides: overrides } });
    });
    app.get(PlatformControlService).invalidate();
  }

  const goodPlan = () => ({
    goalKeys: ['inquiry.answered'],
    nodes: [node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }), node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte antworten.' } } }), node('human', 'MANUAL_TASK', { title: 'Eine Person antwortet' })],
    edges: [{ id: 'e1', source: 'ctx', target: 'notify' }, { id: 'e2', source: 'notify', target: 'human' }],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Person informieren und übergeben.',
  });
  const seedPlan = () => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_process_plan', input: goodPlan() as unknown as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  };

  /** Ein Mandant, dessen Grundgrenze bereits erreicht ist (wie der Pilotmandant mit 61 von 60). */
  async function exhaustedTenant(used = SHADOW_PLAN_LIMIT_PER_TENANT): Promise<string> {
    const tenantId = await newTenant();
    await setShadow(tenantId, true);
    const holder = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Zähler' } });
    await prisma.forTenantId(tenantId).caseEvent.createMany({
      data: Array.from({ length: used }, (_, i) => ({ tenantId, caseId: holder.id, sequence: 1000 + i, type: 'shadow.plan_proposed', payload: { stage: 'DONE', available: true }, dedupeKey: `test-shadow-${i}` })),
    });
    return tenantId;
  }
  const newCase = (tenantId: string, title: string) => prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title } });
  const ledger = (tenantId: string) => prisma.forTenantId(tenantId).shadowQuotaLedger.findMany({ where: { tenantId }, orderBy: { attempt: 'asc' } });
  const audits = (tenantId: string, eventType: string) => prisma.forTenantId(tenantId).auditLog.count({ where: { tenantId, eventType } });
  const grant = (tenantId: string, amount: number) => quota.create(tenantId, { amount, purpose: 'Prüflauf D9, Gruppen B und C', decidedBy: 'Auftraggeber, 02.11.2026 (Test)' });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    shadow = app.get(ShadowPlanService);
    quota = app.get(ShadowQuotaService);
    llm = app.get(LLM_PROVIDER);
  });

  afterAll(async () => {
    for (const id of tenants) await setShadow(id, false).catch(() => undefined);
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants } } }));
    await app.close();
  });

  it('Entscheidung festhalten: Höchstmenge, Zweck und Beschließender sind Pflicht; das Kontingent entsteht INAKTIV und wirkt nicht', async () => {
    const tenantId = await exhaustedTenant();
    await expect(quota.create(tenantId, { amount: 0, purpose: 'Prüflauf D9, Gruppen B und C', decidedBy: 'Auftraggeber, 02.11.2026' })).rejects.toThrow();
    await expect(quota.create(tenantId, { amount: SHADOW_QUOTA_MAX_PER_GRANT + 1, purpose: 'Prüflauf D9, Gruppen B und C', decidedBy: 'Auftraggeber, 02.11.2026' })).rejects.toThrow();
    await expect(quota.create(tenantId, { amount: 5, purpose: 'kurz', decidedBy: 'Auftraggeber, 02.11.2026' })).rejects.toThrow();
    await expect(quota.create(tenantId, { amount: 5, purpose: 'Prüflauf D9, Gruppen B und C', decidedBy: '' })).rejects.toThrow();

    const created = await grant(tenantId, 3);
    expect(created).toMatchObject({ status: 'INACTIVE', amount: 3, consumed: 0, remaining: 3 });
    expect(await audits(tenantId, 'SHADOW_QUOTA_GRANT_CREATED')).toBe(1);

    // Inaktiv: die Grundgrenze gilt unverändert, es wird nicht geplant und nichts verbraucht.
    const c = await newCase(tenantId, 'Inaktiv');
    expect(await shadow.record(tenantId, c.id)).toBe('LIMIT_REACHED');
    expect(await ledger(tenantId)).toHaveLength(0);
    expect((await quota.status(tenantId)).base).toEqual({ used: SHADOW_PLAN_LIMIT_PER_TENANT, limit: SHADOW_PLAN_LIMIT_PER_TENANT });
  });

  it('nach ausdrücklicher Aktivierung plant der Mandant aus dem Kontingent; die Grundzählung bleibt UNVERÄNDERT; jede Einheit steht im Hauptbuch; ist es aufgebraucht, wird wieder abgelehnt', async () => {
    const tenantId = await exhaustedTenant(61); // wie der Pilotmandant: 61 von 60 (alter Stand)
    const created = await grant(tenantId, 3);
    await expect(quota.activate(tenantId, created.id, '')).rejects.toThrow(); // Wer aktiviert, ist Pflicht
    expect((await quota.activate(tenantId, created.id, 'Auftraggeber, 02.11.2026 (Test)')).status).toBe('ACTIVE');
    expect(await audits(tenantId, 'SHADOW_QUOTA_GRANT_ACTIVATED')).toBe(1);
    await expect(quota.activate(tenantId, created.id, 'Auftraggeber, 02.11.2026 (Test)')).rejects.toThrow(); // schon aktiv

    const before = (await quota.status(tenantId)).base;
    expect(before).toEqual({ used: 61, limit: SHADOW_PLAN_LIMIT_PER_TENANT });
    const results: string[] = [];
    const cases = [];
    for (let i = 1; i <= 4; i += 1) {
      const c = await newCase(tenantId, `Aus Kontingent ${i}`);
      cases.push(c);
      seedPlan();
      results.push(await shadow.record(tenantId, c.id, 'Frage'));
    }
    expect(results).toEqual(['RECORDED', 'RECORDED', 'RECORDED', 'LIMIT_REACHED']);

    const rows = await ledger(tenantId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.kind, r.attempt, r.state])).toEqual([['FIRST', 1, 'DONE'], ['FIRST', 1, 'DONE'], ['FIRST', 1, 'DONE']]);
    expect(rows.every((r) => r.caseEventId)).toBe(true);
    const after = await quota.status(tenantId);
    expect(after.base).toEqual(before); // Grundzähler unverändert
    expect(after.grants[0]).toMatchObject({ consumed: 3, done: 3, reserved: 0, unavailable: 0, repeats: 0, remaining: 0 });
    // Die Planungen aus dem Kontingent erzeugen keinen Eintrag der Grundzählung.
    expect(await audits(tenantId, 'SHADOW_PLAN_CONSUMED')).toBe(0);
    expect(await audits(tenantId, 'SHADOW_QUOTA_UNIT_RESERVED')).toBe(3);
    // Die Planung nennt ihr Kontingent; der abgelehnte vierte Versuch verbraucht nichts und nennt den Grund.
    const event = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: cases[0]!.id, type: 'shadow.plan_proposed' } });
    expect(event.payload).toMatchObject({ stage: 'DONE', available: true, quota: { grantId: created.id, kind: 'FIRST', attempt: 1 } });
    const refused = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: cases[3]!.id, type: 'shadow.plan_refused' } });
    expect((refused.payload as { reason: string }).reason).toContain('aufgebraucht');
  });

  it('gleichzeitige Aufrufe können das Kontingent nicht überschreiten: bei 2 verbleibenden Einheiten planen genau 2 von 5', async () => {
    const tenantId = await exhaustedTenant();
    const created = await grant(tenantId, 2);
    await quota.activate(tenantId, created.id, 'Auftraggeber, 02.11.2026 (Test)');
    const cases = await Promise.all([1, 2, 3, 4, 5].map((n) => newCase(tenantId, `Parallel ${n}`)));
    const results = await Promise.all(cases.map((c) => shadow.record(tenantId, c.id)));
    expect(results.filter((r) => r !== 'LIMIT_REACHED')).toHaveLength(2);
    expect(results.filter((r) => r === 'LIMIT_REACHED')).toHaveLength(3);
    expect(await ledger(tenantId)).toHaveLength(2);
    expect((await quota.status(tenantId)).grants[0]).toMatchObject({ consumed: 2, remaining: 0 });
  });

  it('eine nicht mögliche Planung verbraucht die Einheit trotzdem (der Versuch fand statt) und steht so im Hauptbuch', async () => {
    const tenantId = await exhaustedTenant();
    const created = await grant(tenantId, 2);
    await quota.activate(tenantId, created.id, 'Auftraggeber, 02.11.2026 (Test)');
    const c = await newCase(tenantId, 'Kein Plan hinterlegt'); // kein seedPlan: das Modell liefert keinen Plan
    const outcome = await shadow.record(tenantId, c.id);
    expect(['UNAVAILABLE', 'RECORDED']).toContain(outcome);
    const [row] = await ledger(tenantId);
    expect(row!.state).toBe(outcome === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DONE');
    expect((await quota.status(tenantId)).grants[0]!.consumed).toBe(1);
  });

  it('Wiederholungen: nur mit aktivem Kontingent und nur für einen bereits geplanten Vorgang; dieselbe Anfrage (doppelt zugestellt) zählt einmal, eine neue Anfrage ist ein neuer einzeln gezählter Versuch; die Grundzählung bleibt unberührt', async () => {
    const tenantId = await exhaustedTenant(5); // Grundgrenze noch nicht erreicht: die erste Planung kommt aus der Grundzählung
    const c = await newCase(tenantId, 'Wiederholung');
    const never = await newCase(tenantId, 'Nie geplant');
    expect(await shadow.recordRepeat(tenantId, c.id, 'req-0')).toBe('NO_PREVIOUS_PLAN'); // keine erste Planung: keine Wiederholung
    seedPlan();
    expect(await shadow.record(tenantId, c.id)).toBe('RECORDED'); // Grundzählung: 6
    expect(await shadow.recordRepeat(tenantId, c.id, 'req-1')).toBe('LIMIT_REACHED'); // ohne aktives Kontingent nie
    const created = await grant(tenantId, 3);
    await quota.activate(tenantId, created.id, 'Auftraggeber, 02.11.2026 (Test)');
    expect(await shadow.recordRepeat(tenantId, never.id, 'req-1')).toBe('NO_PREVIOUS_PLAN');

    seedPlan();
    expect(await shadow.recordRepeat(tenantId, c.id, 'req-1')).toBe('RECORDED');
    expect(await shadow.recordRepeat(tenantId, c.id, 'req-1')).toBe('ALREADY_DONE'); // doppelte Zustellung derselben Anfrage: nicht noch einmal geplant, nicht noch einmal gezählt
    seedPlan();
    expect(await shadow.recordRepeat(tenantId, c.id, 'req-2')).toBe('RECORDED'); // tatsächlich neuer Versuch
    const rows = await ledger(tenantId);
    expect(rows.map((r) => [r.kind, r.attempt, r.requestKey])).toEqual([['REPEAT', 2, 'req-1'], ['REPEAT', 3, 'req-2']]);
    const keys = (await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId: c.id, type: 'shadow.plan_proposed' }, select: { dedupeKey: true }, orderBy: { sequence: 'asc' } })).map((e) => e.dedupeKey);
    expect(keys).toEqual([`shadow:${c.id}`, `shadow:${c.id}:r:req-1`, `shadow:${c.id}:r:req-2`]);
    expect((await quota.status(tenantId)).grants[0]).toMatchObject({ consumed: 2, repeats: 2, remaining: 1 });
    expect((await quota.status(tenantId)).base.used).toBe(6); // 5 + die eine Planung der Grundzählung; Wiederholungen berühren sie nicht
  });

  it('Beenden: weitere Planungen werden abgelehnt, der bisherige Verbrauch bleibt; es ist höchstens ein Kontingent gleichzeitig aktiv', async () => {
    const tenantId = await exhaustedTenant();
    const first = await grant(tenantId, 5);
    const second = await grant(tenantId, 5);
    await quota.activate(tenantId, first.id, 'Auftraggeber, 02.11.2026 (Test)');
    await expect(quota.activate(tenantId, second.id, 'Auftraggeber, 02.11.2026 (Test)')).rejects.toThrow();
    const c = await newCase(tenantId, 'Vor dem Beenden');
    seedPlan();
    expect(await shadow.record(tenantId, c.id)).toBe('RECORDED');
    await expect(quota.revoke(tenantId, first.id, '')).rejects.toThrow();
    expect((await quota.revoke(tenantId, first.id, 'Prüflauf abgebrochen (Test)')).status).toBe('REVOKED');
    const d = await newCase(tenantId, 'Nach dem Beenden');
    seedPlan();
    expect(await shadow.record(tenantId, d.id)).toBe('LIMIT_REACHED');
    expect((await quota.status(tenantId)).grants.find((g) => g.id === first.id)).toMatchObject({ consumed: 1, status: 'REVOKED' });
    await expect(quota.revoke(tenantId, first.id, 'noch einmal')).rejects.toThrow();
    expect(await audits(tenantId, 'SHADOW_QUOTA_GRANT_REVOKED')).toBe(1);
  });

  it('der Verbrauch überlebt das Löschen von Vorgängen, und ein anderer Mandant sieht fremde Kontingente nie', async () => {
    const tenantId = await exhaustedTenant();
    const other = await newTenant();
    const created = await grant(tenantId, 2);
    await quota.activate(tenantId, created.id, 'Auftraggeber, 02.11.2026 (Test)');
    const c = await newCase(tenantId, 'Wird gelöscht');
    seedPlan();
    expect(await shadow.record(tenantId, c.id)).toBe('RECORDED');
    await prisma.withRlsBypass((tx) => tx.case.delete({ where: { id: c.id } }));
    expect((await quota.status(tenantId)).grants[0]).toMatchObject({ consumed: 1, remaining: 1 });
    expect((await quota.status(other)).grants).toEqual([]);
    expect(await prisma.forTenantId(other).shadowQuotaLedger.count()).toBe(0);
  });
});
