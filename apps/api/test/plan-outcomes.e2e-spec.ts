import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PlanProposal } from '@orbit/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { FactCorrectionService } from '../src/process/fact-correction.service';
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

  it('Übergabe ohne geplante Aufgabe: der Abschluss legt die Aufgabe mit dem Restziel im Wortlaut der Kundschaft an; der Vorgang bleibt in der Prüfung', async () => {
    const { tenantId, caseId } = await newCase(false);
    const handover: PlanProposal = {
      goalKeys: ['human.review'],
      requestedOutcomes: [{ text: 'Der Monteur soll Bescheid wissen und den Schlüsselbund abholen', handover: true, intermediary: true }],
      nodes: [node('summary', 'INTERPRET', { title: 'Anliegen zusammenfassen' }), node('done', 'COMPLETE', { title: 'Abschluss' })],
      edges: [{ id: 'e_summary_done', source: 'summary', target: 'done' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Übergabe: der Monteur ist nicht direkt erreichbar.',
    };
    await orchestrator.startProcedure(tenantId, caseId, handover, { intentSummary: 'Schlüsselbund' });
    await orchestrator.advance(tenantId, caseId);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    expect(row.attentionReasons.join(' ')).toContain('Übergabe mit offenem Restziel');
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toMatch(/^Restziel/);
    expect(tasks[0]!.description).toContain('Der Monteur soll Bescheid wissen und den Schlüsselbund abholen');
    await orchestrator.advance(tenantId, caseId); // erneutes Weiterschalten legt keine zweite Aufgabe an
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(1);
  });

  it('der Planer zieht ein falsch benanntes Personenziel gerade: Anliegen mit Ziel human.review wird zur Übergabe, human.review kommt unter die Ziele', () => {
    const planner = app.get(PlannerService) as unknown as { normalizeProposal(o: unknown): { requestedOutcomes: Array<Record<string, unknown>>; goalKeys: string[] } };
    const out = planner.normalizeProposal({
      goalKeys: ['receipt.acknowledged'],
      requestedOutcomes: [{ text: 'Eingang bestätigen', goalKey: 'receipt.acknowledged' }, { text: 'Monteur informieren', goalKey: 'human.review' }],
      nodes: [],
    });
    expect(out.requestedOutcomes[1]).toMatchObject({ text: 'Monteur informieren', handover: true });
    expect(out.requestedOutcomes[1]!.goalKey).toBeUndefined();
    expect(out.requestedOutcomes[0]!.goalKey).toBe('receipt.acknowledged');
    expect(out.goalKeys).toContain('human.review');
    // Ohne Übergabe ist ein zusätzliches „Prüfung durch eine Person“ unbegründet und entfällt
    const answered = planner.normalizeProposal({ goalKeys: ['inquiry.answered', 'human.review'], requestedOutcomes: [{ text: 'Frage beantworten', goalKey: 'inquiry.answered' }], nodes: [] });
    expect(answered.goalKeys).toEqual(['inquiry.answered']);
  });

  it('eine Korrektur nach der Übergabe bleibt nicht unbemerkt: Aufgabe mit altem und neuem Wert, je Nachricht nur eine', async () => {
    const { tenantId, caseId } = await newCase(false);
    await prisma.forTenantId(tenantId).case.update({ where: { id: caseId }, data: { orchestrationStatus: 'COMPLETED' } });
    const service = app.get(FactCorrectionService) as unknown as { flagCorrectionAfterHandover(t: string, c: string, m: string, corrected: Array<{ key: string; previous: unknown; current: unknown }>): Promise<void> };
    await service.flagCorrectionAfterHandover(tenantId, caseId, 'abcdef12-aaaa', [{ key: 'ai.existing_heating', previous: 'Gasheizung von 1985', current: 'Gasheizung von 1995' }]);
    await service.flagCorrectionAfterHandover(tenantId, caseId, 'abcdef12-aaaa', [{ key: 'ai.existing_heating', previous: 'Gasheizung von 1985', current: 'Gasheizung von 1995' }]);
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toContain('Gasheizung von 1985');
    expect(tasks[0]!.description).toContain('Gasheizung von 1995');
    const open = await newCase(false); // ein noch laufender Vorgang ohne Übergabe bekommt keine Aufgabe
    await service.flagCorrectionAfterHandover(open.tenantId, open.caseId, 'abcdef12-bbbb', [{ key: 'x', previous: 1, current: 2 }]);
    expect(await prisma.forTenantId(open.tenantId).task.count({ where: { caseId: open.caseId } })).toBe(0);
  });

  it('eine Nachricht der Kundschaft nach dem Abschluss bleibt nicht unbemerkt: Aufgabe mit Auszug, je Nachricht nur eine, der Vorgang bleibt abgeschlossen', async () => {
    const { tenantId, caseId } = await newCase(true);
    await orchestrator.startProcedure(tenantId, caseId, relayPlan, { intentSummary: 'Schlüsselbund' });
    await orchestrator.advance(tenantId, caseId);
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus).toBe('COMPLETED');
    const message = await prisma.forTenantId(tenantId).emailMessage.create({ data: { tenantId, caseId, direction: 'INBOUND', fromAddress: 'kunde@e2e.example', toAddresses: ['betrieb@e2e.example'], subject: 'Re: Schlüsselbund', bodyText: 'Noch eine Information: Der Schlüssel liegt im Heizungskeller, nicht im Flur.', receivedAt: new Date() } });
    for (let i = 0; i < 2; i += 1) {
      await orchestrator.receiveInbound(tenantId, caseId, { type: 'communication.received', payload: { emailMessageId: message.id, from: 'kunde@e2e.example' }, dedupeKey: i === 0 ? `inbound:${message.id}` : `inbound:${message.id}:again` });
      await orchestrator.advance(tenantId, caseId);
    }
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId, title: { startsWith: 'Neue Nachricht nach Abschluss' } } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toContain('Heizungskeller');
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus).toBe('COMPLETED');
  });

  it('scheitert die Planung endgültig, steht das Anliegen im Wortlaut der Kundschaft als Aufgabe da – eine je Vorgang', async () => {
    const { tenantId, caseId } = await newCase(false);
    await prisma.forTenantId(tenantId).emailMessage.create({ data: { tenantId, caseId, direction: 'INBOUND', fromAddress: 'kunde@e2e.example', toAddresses: ['betrieb@e2e.example'], subject: 'Rechnung', bodyText: 'Ich brauche eine Kopie meiner letzten Rechnung für die Steuer.', receivedAt: new Date() } });
    const failing = orchestrator as unknown as { openPlanFailureTask(t: string, c: string, reason: string, trigger?: 'INITIAL' | 'REPLAN'): Promise<void> };
    const fresh = await newCase(false); // neuer Eingang ohne Teilvorgang: die Prüfaufgabe kommt vom Eingang selbst, nicht doppelt
    await failing.openPlanFailureTask(fresh.tenantId, fresh.caseId, 'x', 'INITIAL');
    expect(await prisma.forTenantId(fresh.tenantId).task.count({ where: { caseId: fresh.caseId } })).toBe(0);
    await failing.openPlanFailureTask(tenantId, caseId, 'Der Plan blieb auch nach einem Reparaturversuch unzulässig');
    await failing.openPlanFailureTask(tenantId, caseId, 'noch einmal');
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toContain('Kopie meiner letzten Rechnung');
    expect(tasks[0]!.description).toContain('unzulässig');
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
