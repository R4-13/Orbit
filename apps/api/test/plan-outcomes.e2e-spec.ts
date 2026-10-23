import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PlanProposal } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { PlannerService } from '../src/process/planner.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

type Node = PlanProposal['nodes'][number];
const node = (id: string, type: Node['type'], extra: Partial<Node> = {}): Node => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });

/**
 * Funktionsnachweis 23.10.: Zielabdeckung. Das Ziel „Monteur informieren“ wird nicht durch „Büro informieren“ ersetzt. Ohne dokumentierte Weitergabe (Zuständigkeit DISPATCH) ist es eine Übergabe mit
 * offenem Restziel; mit ihr geht die Meldung an die dafür zuständige Person. Die Prüfung der Anliegenliste selbst (Validator) ist in `plan-outcomes.spec.ts` bewiesen. Eigener Mandant, kein Versand.
 */
describe('Zielabdeckung und Weitergabe an Monteure (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: OrchestratorService;
  const tenants: string[] = [];

  async function newCase(withDispatch: boolean): Promise<{ tenantId: string; caseId: string }> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `PO ${suffix.slice(0, 8)}`, slug: `e2e-po-${suffix}`, adminEmail: `admin-${suffix}@e2e-po.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'P', adminLastName: 'O' });
    tenants.push(tenant.id);
    const scoped = prisma.forTenantId(tenant.id);
    await scoped.staffMember.create({ data: { tenantId: tenant.id, firstName: 'Frank', lastName: 'Chef', roleKind: 'OWNER', email: 'chef@e2e-po.example', responsibilities: ['GENERAL'], preferredChannel: 'EMAIL' } as never });
    if (withDispatch) await scoped.staffMember.create({ data: { tenantId: tenant.id, firstName: 'Vera', lastName: 'Büro', roleKind: 'OFFICE', email: 'vera@e2e-po.example', responsibilities: ['DISPATCH'], preferredChannel: 'EMAIL' } as never });
    const c = await scoped.case.create({ data: { tenantId: tenant.id, type: 'GENERAL', title: 'Schlüsselbund beim Monteur' } });
    return { tenantId: tenant.id, caseId: c.id };
  }

  const relayPlan: PlanProposal = {
    goalKeys: ['staff.informed'],
    requestedOutcomes: [{ text: 'Der Monteur soll Bescheid wissen und den Schlüsselbund abholen', goalKey: 'staff.informed', handover: false, intermediary: true }],
    nodes: [
      node('notify', 'ACTION', { title: 'Monteur über die Einsatzplanung informieren', capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Ein Schlüsselbund des Monteurs liegt beim Kunden und kann abgeholt werden.' }, relayTo: { literal: 'DISPATCH' } } }),
      node('done', 'COMPLETE', { title: 'Erledigt' }),
    ],
    edges: [{ id: 'e_notify_done', source: 'notify', target: 'done' }],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Monteur über die Einsatzplanung informieren.',
  };

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    orchestrator = app.get(OrchestratorService);
  });

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants } } }));
    await app.close();
  });

  it('der Planer erfährt aus dem Mitarbeiterverzeichnis, ob die Weitergabe an Monteure dokumentiert ist', async () => {
    const without = await newCase(false);
    const withDispatch = await newCase(true);
    const planner = app.get(PlannerService);
    expect((await planner.buildContext(without.tenantId, without.caseId)).dispatchAvailable).toBe(false);
    expect((await planner.buildContext(withDispatch.tenantId, withDispatch.caseId)).dispatchAvailable).toBe(true);
  });

  it('mit dokumentierter Weitergabe geht die Meldung an die dafür zuständige Person; das Ziel gilt als erreicht, der Vorgang schließt mit Nachweis ab', async () => {
    const { tenantId, caseId } = await newCase(true);
    await orchestrator.startProcedure(tenantId, caseId, relayPlan, { intentSummary: 'Schlüsselbund' });
    await orchestrator.advance(tenantId, caseId);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('COMPLETED');
    const items = await prisma.forTenantId(tenantId).attentionItem.findMany({ where: { caseId } });
    expect(items.map((i) => i.responsibility)).toEqual(['DISPATCH']);
    expect(await app.get(PlanStoreService).latestOutcomes(tenantId, caseId)).toEqual([expect.objectContaining({ goalKey: 'staff.informed', intermediary: true })]);
  });

  it('ohne dokumentierte Weitergabe wird nicht stillschweigend an die Leitung gemeldet: der Schritt scheitert sichtbar, der Vorgang geht an eine Person', async () => {
    const { tenantId, caseId } = await newCase(false);
    await orchestrator.startProcedure(tenantId, caseId, relayPlan, { intentSummary: 'Schlüsselbund' });
    await orchestrator.advance(tenantId, caseId);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId, kind: 'NOTIFY_REQUEST' } })).toBe(0);
  });

  it('Übergabe mit Restziel: Aufgabe mit Beschreibung des Restziels, Vorgang bleibt in der Prüfung (nicht erledigt), Anliegen sind am Plan festgehalten', async () => {
    const { tenantId, caseId } = await newCase(false);
    const handover: PlanProposal = {
      goalKeys: ['human.review'],
      requestedOutcomes: [{ text: 'Der Monteur soll Bescheid wissen und den Schlüsselbund abholen', handover: true, intermediary: true }],
      nodes: [node('task', 'MANUAL_TASK', { title: 'Monteur informieren', purpose: 'Restziel: Den Monteur informieren, dass sein Schlüsselbund beim Kunden liegt und abgeholt werden kann.' })],
      edges: [],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Übergabe: der Monteur ist nicht direkt erreichbar.',
    };
    await orchestrator.startProcedure(tenantId, caseId, handover, { intentSummary: 'Schlüsselbund' });
    await orchestrator.advance(tenantId, caseId);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toContain('Restziel');
    expect(await app.get(PlanStoreService).latestOutcomes(tenantId, caseId)).toEqual([expect.objectContaining({ handover: true })]);
  });
});
