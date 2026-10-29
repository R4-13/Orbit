import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import type { PlanProposal } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseEventsService } from '../src/process/case-events.service';
import { CaseLifecycleService } from '../src/process/case-lifecycle.service';
import { CaseOrchestrationService } from '../src/process/case-orchestration.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ReferenceProcessTools } from '../src/process/reference/reference-process.tools';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const TOM = 'tom@kunde.example';

/**
 * FN-14 (Meilenstein C, Nachbesserung 2): Übergabe, Neuplanung, Freigabewarten und Rückfrage müssen denselben Bearbeitungsstand zeigen. Bewiesen wird hier (ohne Modell, feste Pläne):
 *  - eine Aufgabe gehört zu einer Arbeit, nicht zu einer Planrevision: gleiche Arbeit → übernommen und aktualisiert (Vermerk der Kundschaft bleibt), entfallene Arbeit → geschlossen, andere Aufgaben bleiben,
 *  - solange eine neuere Planrevision auf Freigabe wartet, übergibt der bisherige Plan nichts und legt keine Aufgabe an; der Vorgang zeigt den Freigabebedarf,
 *  - ein offener Freigabebedarf steht auch dann am Vorgang, wenn er sonst „zur Prüfung“ zeigt,
 *  - ein Schritt, der die jüngste Nachricht liest, läuft nach einer neueren Nachricht erneut (die Antwort wird gelesen),
 *  - die Antwort „Gas“ auf die Frage nach der Heizungsart wird zur Angabe der Heizungsart (allgemein über die erfragte Angabe, ohne Sonderregel für ein Wort).
 */
describe('FN-14: ein Bearbeitungsstand in Vorgang, Plan, Aufgaben und Rückmeldung (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: OrchestratorService;
  let store: PlanStoreService;
  let llm: MockLLMProvider;
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `FN14 ${suffix.slice(0, 8)}`, slug: `e2e-fn14-${suffix}`, adminEmail: `admin-${suffix}@e2e-fn14.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    return tenant.id;
  }
  async function newCase(tenantId: string, title: string): Promise<string> {
    const row = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'GENERAL', title, orchestrationStatus: 'RECEIVED' } });
    return row.id;
  }

  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });
  const proposal = (nodes: Array<Record<string, unknown>>, edges: Array<[string, string]>, goalKeys = ['human.review']): PlanProposal =>
    ({ goalKeys, nodes, edges: edges.map(([source, target]) => ({ id: `e_${source}_${target}`, source, target })), unresolvedRequirements: [], assumptions: [], conciseExplanation: 'x' }) as never;
  const manualPlan = (title: string, purpose: string): PlanProposal => proposal([node('manual', 'MANUAL_TASK', { title, purpose }), node('done', 'COMPLETE')], [['manual', 'done']]);
  const waitPlan = (): PlanProposal => proposal([node('wait', 'WAIT_EVENT', { title: 'Antwort abwarten', config: { eventType: 'communication.received' }, timeout: { hours: 72 } })], []);
  const openTasks = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).task.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    orchestrator = app.get(OrchestratorService);
    store = app.get(PlanStoreService);
    llm = app.get(LLM_PROVIDER);
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('eine neue Planrevision übernimmt die offene Aufgabe derselben Arbeit (Titel aktualisiert, Vermerk der Kundschaft bleibt) statt eine zweite anzulegen – nachvollziehbar im Verlauf', async () => {
    const tenantId = await newTenant();
    const caseId = await newCase(tenantId, 'Angebot Heizungsregler');
    await orchestrator.startProcedure(tenantId, caseId, manualPlan('Angebotsanforderungen prüfen', 'Bitte prüfen und ein Angebot veranlassen.'));
    await orchestrator.advance(tenantId, caseId);
    let tasks = await openTasks(tenantId, caseId);
    expect(tasks.map((t) => t.title)).toEqual(['Angebotsanforderungen prüfen']);
    // Die Zuordnung einer Antwort der Kundschaft hat einen Vermerk an der Aufgabe hinterlassen.
    await prisma.forTenantId(tenantId).task.update({ where: { id: tasks[0]!.id }, data: { description: `${tasks[0]!.description}\n\nAntwort der Kundschaft zu diesem Anliegen (29.10.2026): Gas. Vaillant VRC 700.` } });

    // Neuplanung: dieselbe Arbeit, jetzt genauer beschrieben.
    await orchestrator.startProcedure(tenantId, caseId, manualPlan('Fachlich prüfen und Angebot mit Einbau erstellen', 'Restziel: Eignung und Kosten prüfen.'));
    expect((await openTasks(tenantId, caseId)).filter((t) => t.status === 'OPEN')).toHaveLength(1); // schon bei der Aktivierung: nichts Überholtes wird geschlossen, solange die Arbeit weiterbesteht
    await orchestrator.advance(tenantId, caseId);
    tasks = await openTasks(tenantId, caseId);
    expect(tasks).toHaveLength(1); // keine zwei offenen Aufgaben für dieselbe Arbeit
    expect(tasks[0]).toMatchObject({ title: 'Fachlich prüfen und Angebot mit Einbau erstellen', status: 'OPEN' });
    expect(tasks[0]!.description).toContain('Restziel: Eignung und Kosten prüfen.');
    expect(tasks[0]!.description).toContain('Gas. Vaillant VRC 700.');
    const trail = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: { startsWith: 'task.' } }, orderBy: { sequence: 'asc' }, select: { type: true, payload: true } });
    expect(trail.map((e) => e.type)).toEqual(['task.opened_by_plan', 'task.updated_by_plan']);
    expect(trail[1]!.payload).toMatchObject({ taskId: tasks[0]!.id, previousTitle: 'Angebotsanforderungen prüfen' });
  });

  it('eine offene Aufgabe, deren Arbeit der geltende Plan nicht mehr vorsieht, wird geschlossen (mit Ereignis); eine tatsächlich andere Aufgabe bleibt bestehen', async () => {
    const tenantId = await newTenant();
    const caseId = await newCase(tenantId, 'Angebot Heizungsregler');
    await orchestrator.startProcedure(tenantId, caseId, manualPlan('Angebotsanforderungen prüfen', 'Bitte prüfen.'));
    await orchestrator.advance(tenantId, caseId);
    const other = await prisma.forTenantId(tenantId).task.create({ data: { tenantId, caseId, title: 'Kunden zurückrufen', description: 'Von Hand angelegt.', source: 'USER' } });
    // Neuer Plan: statt der Übergabe wird die Kundschaft gefragt und die Antwort abgewartet.
    await orchestrator.startProcedure(tenantId, caseId, waitPlan());
    const tasks = await openTasks(tenantId, caseId);
    expect(tasks.map((t) => [t.title, t.status])).toEqual([['Angebotsanforderungen prüfen', 'CANCELLED'], ['Kunden zurückrufen', 'OPEN']]);
    expect(tasks[1]!.id).toBe(other.id);
    const superseded = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: 'task.superseded' } });
    expect(superseded.payload).toMatchObject({ taskId: tasks[0]!.id, title: 'Angebotsanforderungen prüfen' });
  });

  it('wartet eine neuere Planrevision auf Freigabe, übergibt der bisherige Plan nichts: keine Aufgabe, der Vorgang zeigt „wartet auf Freigabe“; nach der Bestätigung gilt der neue Plan', async () => {
    const tenantId = await newTenant();
    const caseId = await newCase(tenantId, 'Angebot Heizungsregler');
    await orchestrator.startProcedure(tenantId, caseId, manualPlan('Angebotsanforderungen prüfen', 'Bitte prüfen.'));
    // Die Neuplanung ist entstanden und wartet auf die Bestätigung (z. B. weil sie eine Rückfrage an die Kundschaft enthält).
    const successor = await store.createRevision(tenantId, caseId, { proposal: waitPlan(), source: 'LLM_PLANNER', status: 'AWAITING_APPROVAL', basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null }, parentPlanId: (await store.getActive(tenantId, caseId))!.plan.id });
    await orchestrator.advance(tenantId, caseId);
    expect(await openTasks(tenantId, caseId)).toHaveLength(0);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
    expect(row.attentionReasons.join(' ')).toContain('Ein geänderter Plan wartet auf Ihre Bestätigung');
    const nodes = await prisma.forTenantId(tenantId).processPlanNode.findMany({ where: { plan: { caseId, status: 'ACTIVE' } }, select: { nodeKey: true, state: true } });
    expect(nodes.find((n) => n.nodeKey === 'manual')?.state).toBe('PLANNED'); // nicht gestartet
    await orchestrator.approvePlan(tenantId, 'user-confirm', successor.plan.id);
    await orchestrator.advance(tenantId, caseId);
    expect((await store.getActive(tenantId, caseId))!.plan.id).toBe(successor.plan.id);
    expect(await openTasks(tenantId, caseId)).toHaveLength(0); // der neue Plan wartet auf die Antwort, niemand muss etwas tun
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
  });

  it('ein offener Freigabebedarf steht am Vorgang und in der Ansicht, auch wenn der Vorgang sonst „zur Prüfung“ zeigt; nach der Entscheidung verschwindet der Hinweis', async () => {
    const tenantId = await newTenant();
    const caseId = await newCase(tenantId, 'Angebot Heizungsregler');
    await orchestrator.startProcedure(tenantId, caseId, manualPlan('Angebotsanforderungen prüfen', 'Bitte prüfen.'));
    await orchestrator.advance(tenantId, caseId);
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus).toBe('MANUAL_REVIEW');
    const successor = await store.createRevision(tenantId, caseId, { proposal: waitPlan(), source: 'LLM_PLANNER', status: 'AWAITING_APPROVAL', basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null }, parentPlanId: (await store.getActive(tenantId, caseId))!.plan.id });
    // Irgendein Wechsel in „zur Prüfung“ (hier: ein weiterer manueller Schritt) verdeckt den Freigabebedarf nicht.
    await app.get(CaseLifecycleService).transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: ['Ein manueller Schritt ist offen.'] });
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.attentionReasons[0]).toMatch(/^Freigabe offen: Ein geänderter Plan \(Revision \d+\) wartet auf Ihre Bestätigung\./);
    expect(row.attentionReasons).toContain('Ein manueller Schritt ist offen.');
    const viewer = { tenantId, userId: 'u', permissions: ['case.read', 'case.manage', 'approval.decide'] } as never;
    const view = await app.get(CaseOrchestrationService).projection(viewer, caseId);
    expect(view.pendingApprovals).toEqual({ plan: { revision: successor.plan.revision }, actions: 0 });
    await orchestrator.rejectPlan(tenantId, 'user-confirm', successor.plan.id, 'nicht nötig');
    await app.get(CaseLifecycleService).transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: ['Ein manueller Schritt ist offen.'] });
    const after = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.attentionReasons.join(' ')).not.toContain('Freigabe offen');
    expect((await app.get(CaseOrchestrationService).projection(viewer, caseId)).pendingApprovals).toBeUndefined();
  });

  it('ein Schritt, der die jüngste Nachricht liest, läuft nach einer neueren Nachricht erneut; ein Schritt mit Wirkung nach außen wird dadurch nie wiederholt', async () => {
    const tenantId = await newTenant();
    const caseId = await newCase(tenantId, 'Angebot Heizungsregler');
    const scoped = prisma.forTenantId(tenantId);
    await scoped.emailMessage.create({ data: { tenantId, caseId, direction: 'INBOUND', fromAddress: TOM, toAddresses: ['info@betrieb.example'], subject: 'Regler', bodyText: 'Wir brauchen einen Regler.', threadId: 't1', rfcMessageId: `<a-${caseId}@k>`, receivedAt: new Date(), createdAt: new Date(Date.now() - 60_000) } });
    const nodes = () => [
      node('extract', 'PREPARE', { capability: { key: 'facts.extract_from_message' }, inputs: { messageId: { sourceRef: 'inbound.latestMessageId' } } }),
      node('send', 'ACTION', { capability: { key: 'email.send' }, inputs: { threadId: { sourceRef: 'inbound.latestThreadId' } }, config: { purpose: 'CLARIFICATION' } }),
      node('other', 'PREPARE', { capability: { key: 'context.lookup' } }),
    ];
    const first = await store.createRevision(tenantId, caseId, { proposal: proposal(nodes(), []), source: 'LLM_PLANNER', status: 'VALIDATED', basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null } });
    await store.activate(tenantId, first.plan.id);
    for (const key of ['extract', 'send', 'other']) await store.transitionNode(tenantId, caseId, first.plan.id, key, 'PLANNED', { state: 'SUCCEEDED', completedAt: new Date(Date.now() - 30_000) });

    // Keine neuere Nachricht: alles bleibt erledigt.
    const same = await store.createRevision(tenantId, caseId, { proposal: proposal(nodes(), []), source: 'LLM_PLANNER', status: 'VALIDATED', basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null }, parentPlanId: first.plan.id });
    expect(same.nodes.map((n) => [n.nodeKey, n.state]).sort()).toEqual([['extract', 'SUCCEEDED'], ['other', 'SUCCEEDED'], ['send', 'SUCCEEDED']]);
    await store.activate(tenantId, same.plan.id);

    // Die Kundschaft antwortet: die Auslese läuft für die neue Nachricht erneut; Versand und Kontextprüfung bleiben, wie sie waren.
    await scoped.emailMessage.create({ data: { tenantId, caseId, direction: 'INBOUND', fromAddress: TOM, toAddresses: ['info@betrieb.example'], subject: 'Re: Regler', bodyText: 'Gas.', threadId: 't1', rfcMessageId: `<b-${caseId}@k>`, receivedAt: new Date() } });
    const after = await store.createRevision(tenantId, caseId, { proposal: proposal(nodes(), []), source: 'LLM_PLANNER', status: 'VALIDATED', basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null }, parentPlanId: same.plan.id });
    expect(after.nodes.map((n) => [n.nodeKey, n.state]).sort()).toEqual([['extract', 'PLANNED'], ['other', 'SUCCEEDED'], ['send', 'SUCCEEDED']]);
  });

  it('die Antwort „Gas.“ auf die ausdrücklich gestellte Frage nach der Heizungsart wird zur Angabe der Heizungsart (über die erfragte Angabe, keine Sonderregel für ein Wort)', async () => {
    const tenantId = await newTenant();
    const caseId = await newCase(tenantId, 'Angebot Heizungsregler');
    const scoped = prisma.forTenantId(tenantId);
    // Die Analyse hat die Heizungsart als fehlende, erfragte Angabe ermittelt.
    await app.get(CaseEventsService).append(tenantId, caseId, {
      type: 'requirements.analyzed',
      payload: { analysis: { requestType: 'Reglerangebot', summary: 'Neuer Regler', known: [], requirements: [{ key: 'ai.heating_system_type', label: 'Heizungsart', question: 'Für welchen Heizungs- bzw. Kesseltyp benötigen Sie den neuen Regler?', type: 'string', blocking: true }], nextStep: 'ASK_CUSTOMER' } },
    });
    const message = await scoped.emailMessage.create({ data: { tenantId, caseId, direction: 'INBOUND', fromAddress: TOM, toAddresses: ['info@betrieb.example'], subject: 'Re: Regler', bodyText: 'Gas. Der alte Regler ist ein Vaillant VRC 700.', threadId: 't1', rfcMessageId: `<c-${caseId}@k>`, receivedAt: new Date() } });
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_extracted_facts', input: { facts: [{ key: 'ai.heating_system_type', value: 'Gas', evidence: 'Gas.', confidence: 0.95 }] } }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
    const run = await scoped.agentRun.create({ data: { tenantId, caseId, agentType: 'ORCHESTRATOR', triggerType: 'MANUAL', status: 'RUNNING', input: { purpose: 'test' } } });
    const result = await app.get(ReferenceProcessTools).extractFromMessage({ tenantId, agentRunId: run.id }, caseId, message.id);
    expect(result.recorded).toEqual([expect.objectContaining({ key: 'ai.heating_system_type', value: 'Gas', status: 'CONFIRMED' })]);
    const fact = (await scoped.caseFact.findMany({ where: { caseId, key: 'ai.heating_system_type', isCurrent: true } }))[0]!;
    expect(fact).toMatchObject({ value: 'Gas', status: 'CONFIRMED', sourceRef: `message:${message.id}` });
  });
});
