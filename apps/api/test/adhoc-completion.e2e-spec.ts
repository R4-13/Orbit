import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PlanProposal } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

type Node = PlanProposal['nodes'][number];
const node = (id: string, type: Node['type'], extra: Partial<Node> = {}): Node => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });

/**
 * FA-09 (Konzept Flexible Autonomie §5a, Addendum ADD-2.3): ein frei geplanter Ablauf („Zusammenfassung → Abschluss“) schließt den Vorgang NICHT ab, solange kein
 * Wirkungsnachweis vorliegt; die Kriterien liegen im Code und lassen sich durch den Plan weder ändern noch umgehen. Eigener Mandant, kein Versand.
 */
describe('Abschlussnachweis frei geplanter Abläufe (FA-09, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: OrchestratorService;
  const tenants: string[] = [];

  async function newCase(): Promise<{ tenantId: string; caseId: string }> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `AC ${suffix.slice(0, 8)}`, slug: `e2e-ac-${suffix}`, adminEmail: `admin-${suffix}@e2e-ac.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'C' });
    tenants.push(tenant.id);
    const c = await prisma.forTenantId(tenant.id).case.create({ data: { tenantId: tenant.id, type: 'SALES', title: 'Freier Plan ohne Nachweis' } });
    return { tenantId: tenant.id, caseId: c.id };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    orchestrator = app.get(OrchestratorService);
  });

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants } } }));
    await app.close();
  });

  it('„Zusammenfassung → Abschluss“ ohne Wirkungsnachweis endet in der Prüfung, nicht als erledigt – mit verständlichem Grund und Ereignis', async () => {
    const { tenantId, caseId } = await newCase();
    const summaryOnly: PlanProposal = {
      goalKeys: ['inquiry.answered'],
      nodes: [node('summary', 'INTERPRET', { title: 'Anliegen zusammenfassen' }), node('done', 'COMPLETE', { title: 'Erledigt' })],
      edges: [{ id: 'e_summary_done', source: 'summary', target: 'done' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Nur zusammenfassen und abschließen.',
    };

    const started = await orchestrator.startProcedure(tenantId, caseId, summaryOnly, { intentSummary: 'Test' });
    expect(started.outcome).toBe('RUNNING');
    await orchestrator.advance(tenantId, caseId);

    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    expect(row.outcome).toBeNull();
    expect(row.attentionReasons.join(' ')).toMatch(/Nachweis|beantwortet/);

    const evaluated = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: 'completion.evaluated' } });
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0]!.payload).toMatchObject({ met: false, reason: 'GOAL_NOT_ACHIEVED', goals: [{ goal: 'Anfrage beantwortet', status: 'NOT_ACHIEVED' }] });
  });

  it('ein internes Ziel („Zuständige Person informieren“) schließt OHNE jede E-Mail ab, sobald die bestätigte Meldung vorliegt – eine E-Mail ist weder nötig noch allgemein ausreichend', async () => {
    const { tenantId, caseId } = await newCase();
    const internal: PlanProposal = {
      goalKeys: ['staff.informed'],
      nodes: [node('notify', 'ACTION', { title: 'Person informieren', capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte morgen Herrn Meier an die Wartung erinnern.' } } }), node('done', 'COMPLETE', { title: 'Erledigt' })],
      edges: [{ id: 'e_notify_done', source: 'notify', target: 'done' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Interner Auftrag: Person informieren.',
    };
    await orchestrator.startProcedure(tenantId, caseId, internal, { intentSummary: 'Interner Auftrag' });
    await orchestrator.advance(tenantId, caseId);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(row.outcome).toMatchObject({ code: 'ADHOC_GOALS_PROVEN' });
    expect(await prisma.forTenantId(tenantId).emailMessage.count({ where: { caseId, direction: 'OUTBOUND' } })).toBe(0);
  });

  it('eine versendete Antwort allein schließt ein internes Ziel nicht ab (falscher Nachweis für das Ziel)', async () => {
    const { tenantId, caseId } = await newCase();
    const wrong: PlanProposal = {
      goalKeys: ['staff.informed'],
      nodes: [node('summary', 'INTERPRET', { title: 'Zusammenfassen' }), node('done', 'COMPLETE', { title: 'Erledigt' })],
      edges: [{ id: 'e_summary_done', source: 'summary', target: 'done' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Nur zusammenfassen.',
    };
    await orchestrator.startProcedure(tenantId, caseId, wrong, { intentSummary: 'Test' });
    await orchestrator.advance(tenantId, caseId);
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus).toBe('MANUAL_REVIEW');
  });

  it('eine interne Aufgabe oder Meldung ist ebenfalls kein Abschlussnachweis für ein Ziel „Person prüft“ (Übergabe ≠ erledigt)', async () => {
    const { tenantId, caseId } = await newCase();
    const handover: PlanProposal = {
      goalKeys: ['human.review'],
      nodes: [node('task', 'MANUAL_TASK', { title: 'Eine Person prüft' })],
      edges: [],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Übergabe an eine Person.',
    };
    await orchestrator.startProcedure(tenantId, caseId, handover, { intentSummary: 'Test' });
    await orchestrator.advance(tenantId, caseId);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(1);
  });
});
