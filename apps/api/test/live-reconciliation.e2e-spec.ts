import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import type { OrbitEnv } from '@orbit/config';
import { PERMISSIONS, triageFixtureForScenario } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { ORBIT_ENV } from '../src/config/env.token';
import { IntakeService } from '../src/intake/intake.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActionLedgerService } from '../src/process/action-ledger.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CaseCommandsService, type CommandActor } from '../src/process/case-commands.service';
import { CASE_EVENT_TYPES } from '../src/process/case-events.service';
import { LiveReconciliationService } from '../src/process/live-reconciliation.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const REAL_SENDER = 'thomas.meier@firma-meier.de';
const TEST_SENDER = 'thomas.meier@firma-meier.example';

/**
 * Live-Abgleich auf der echten Datenbank: ein Schritt, der nur simuliert lief oder an einer fehlenden Verbindung hängt, wird von selbst wieder aufgenommen bzw.
 * live wiederholt, sobald der echte Weg verfügbar ist – und nie, wenn das etwas doppelt täte. Das Modell und der Versand sind Doubles, die den Modus wechseln.
 * Geprüft wird je Fall direkt (`reconcile` + `advance`), nicht über den globalen Sweep: der würde auch fremde Vorgänge der Entwicklungsdatenbank anfassen.
 */
describe('Live reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let commands: CaseCommandsService;
  let ledger: ActionLedgerService;
  let store: PlanStoreService;
  let orchestrator: OrchestratorService;
  let live: LiveReconciliationService;
  let tenantsService: TenantsService;
  let reference: ReferenceProcessService;
  let blueprints: BlueprintRegistryService;
  let llm: MockLLMProvider;
  let env: OrbitEnv;
  let sent: Array<{ to: string; subject: string; bodyText: string }>;
  let sendMode: 'SIMULATED' | 'LIVE' = 'SIMULATED';
  let aiLive = false;
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();
  const spies: jest.SpyInstance[] = [];

  async function newTenant(status: 'CONNECTED' | 'AUTH_REQUIRED' = 'CONNECTED'): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({ name: `Musterwerk Live ${suffix.slice(0, 8)}`, slug: `e2e-livereconcile-${suffix}`, adminEmail: `admin-${suffix}@e2e-live.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status, externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    await reference.loadFixture(tenant.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenant.id, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenant.id, 'u1', blueprint.key, blueprint.version);
    return tenant.id;
  }

  const approver = (tenantId: string): CommandActor => ({ id: randomUUID(), tenantId, permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE, PERMISSIONS.APPROVAL_DECIDE] });
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const nodeOf = async (tenantId: string, caseId: string, key: string) => (await store.getActive(tenantId, caseId))!.nodes.find((n) => n.nodeKey === key)!;
  const script = (toolName: string, input: unknown) => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input: input as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  };
  const seedExtraction = () => script('submit_extracted_facts', { facts: [{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'neue Fenster', confidence: 0.9 }] });
  const analysis = () => ({
    requestType: 'Fensteranfrage',
    summary: 'Neue Fenster für ein Bürogebäude.',
    knownDetails: [],
    missingInformation: [{ key: 'oeffnungsart', label: 'Öffnungsart', question: 'Welche Öffnungsart (Dreh-Kipp, Fest) wünschen Sie?' }],
    siteVisit: { recommended: false, reason: '' },
    nextStep: 'ASK_CUSTOMER',
  });
  const mail = (sender: string): NormalizedIntakeEvent => ({ tenantId: '', channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: sender, displayName: 'Thomas Meier' }, recipients: [{ address: 'info@musterwerk.example' }], direction: 'INBOUND', subject: 'Angebot Fenster', content: 'Guten Tag, wir möchten ein Angebot für neue Fenster in unserem Bürogebäude. Viele Grüße', threadId: randomUUID(), rfcMessageId: `<${randomUUID()}@firma-meier.example>` });

  /** Die Anfrage läuft im Testbetrieb: KI = Mock (simuliert), Versand simuliert; die Rückfrage wird freigegeben und „gesendet“. */
  async function simulatedCase(sender = REAL_SENDER): Promise<{ tenantId: string; caseId: string }> {
    sendMode = 'SIMULATED';
    aiLive = false;
    const tenantId = await newTenant();
    script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE'));
    seedExtraction();
    const result = await intake.handleIntakeEvent(tenantId, undefined, { ...mail(sender), connectionId: connectionByTenant.get(tenantId) });
    const caseId = result.case!.id;
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, { commandId: randomUUID(), type: 'APPROVE_ACTION', expectedCaseRevision: (await caseOf(tenantId, caseId)).revision, payload: { intentId: intent!.id } });
    return { tenantId, caseId };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    commands = app.get(CaseCommandsService);
    ledger = app.get(ActionLedgerService);
    store = app.get(PlanStoreService);
    orchestrator = app.get(OrchestratorService);
    live = app.get(LiveReconciliationService);
    tenantsService = app.get(TenantsService);
    reference = app.get(ReferenceProcessService);
    blueprints = app.get(BlueprintRegistryService);
    llm = app.get(LLM_PROVIDER);
    env = app.get<OrbitEnv>(ORBIT_ENV);
    // Das Modell zählt nur als echt, wenn `aiLive` gesetzt ist (Name ohne „mock“); es antwortet immer aus der Skript-Warteschlange.
    const provider = (name: string) => ({ providerName: name, modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) });
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockImplementation(async () => provider(aiLive ? 'scripted-live' : 'mock') as never));
    spies.push(
      jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenantId, message) => {
        sent.push(message as never);
        return { providerMessageId: sendMode === 'SIMULATED' ? `sim-${sent.length}` : `gm-${sent.length}`, threadId: 'thr', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: sendMode };
      }),
    );
  });

  beforeEach(() => {
    sent = [];
    env.OUTBOUND_MAIL_MODE = 'gmail';
    env.LIVE_UPGRADE_ENABLED = 'true'; // in den E2E-Läufen sonst aus (siehe test/utils/e2e-env.ts)
    // Nicht verbrauchte Skriptantworten eines früheren Tests dürfen den nächsten nicht verfälschen.
    (llm as unknown as { queue: unknown[] }).queue.splice(0);
  });

  afterAll(async () => {
    env.LIVE_UPGRADE_ENABLED = 'false';
    for (const spy of spies) spy.mockRestore();
    for (const tenantId of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    await app.close();
  });

  it('simuliert gesendete, bereits freigegebene Rückfrage: sobald der Versand echt möglich ist, geht sie ohne zweite Freigabe live hinaus; die simulierte Aufzeichnung gilt nicht als gesendet', async () => {
    const { tenantId, caseId } = await simulatedCase();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(REAL_SENDER);
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'SIMULATED' });
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
    // Der Hinweis erklärt, dass ORBIT es von selbst nachholt, sobald der echte Versand verfügbar ist.
    expect(await live.hintFor(tenantId, caseId, 'ask')).toContain('automatisch live');

    // Noch nicht verfügbar (Versand ist im Testbetrieb): nichts geschieht.
    env.OUTBOUND_MAIL_MODE = 'simulated';
    expect(await live.reconcile(tenantId, caseId)).toEqual({ resumed: [], redone: [] });
    expect(sent).toHaveLength(1);

    // Der echte Versand wird verfügbar (Postfach mit Sendeberechtigung, Modus gmail).
    env.OUTBOUND_MAIL_MODE = 'gmail';
    sendMode = 'LIVE';
    const result = await live.reconcile(tenantId, caseId);
    expect(result.redone).toEqual(expect.arrayContaining(['ask', 'wait']));
    expect(result.redone).not.toContain('extract'); // die KI ist nicht live: nur der Versand wird wiederholt
    await orchestrator.advance(tenantId, caseId);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ to: REAL_SENDER, subject: sent[0]!.subject });
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'LIVE' });
    expect(await nodeOf(tenantId, caseId, 'wait')).toMatchObject({ state: 'WAITING' });
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');

    // Nachvollziehbar: die simulierte Bestätigung ist ersetzt, die Aufzeichnung nicht mehr „gesendet“, das Ereignis steht im Verlauf.
    const intents = await prisma.forTenantId(tenantId).actionIntent.findMany({ where: { caseId, nodeKey: 'ask' }, orderBy: { createdAt: 'asc' } });
    expect(intents.map((i) => [i.status, i.errorCode])).toEqual([['CANCELLED', 'SIMULATION_SUPERSEDED'], ['CONFIRMED', null]]);
    const messages = await prisma.forTenantId(tenantId).emailMessage.findMany({ where: { caseId, direction: 'OUTBOUND' }, orderBy: { createdAt: 'asc' } });
    expect(messages.map((m) => [m.providerMessageId, m.sentAt === null, m.classification])).toEqual([['sim-1', true, 'SIMULATED_SEND'], ['gm-2', false, null]]);
    const events = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: CASE_EVENT_TYPES.LIVE_UPGRADE } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ kind: 'REDONE', startKey: 'ask' });

    // Danach ist nichts mehr zu tun – insbesondere wird nicht noch einmal gesendet.
    expect(await live.reconcile(tenantId, caseId)).toMatchObject({ redone: [] });
    await orchestrator.advance(tenantId, caseId);
    expect(sent).toHaveLength(2);
  }, 120_000);

  it('mit echter KI wird die Analyse nachgeholt: simulierte Prüfung, neuer Entwurf mit den gezielten Fragen und der neue Versand – mit neuer Freigabe, weil sich der Inhalt geändert hat', async () => {
    const { tenantId, caseId } = await simulatedCase();
    expect(await nodeOf(tenantId, caseId, 'reqs')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'SIMULATED' });

    aiLive = true;
    sendMode = 'LIVE';
    seedExtraction(); // die wiederholte Extraktion
    script('submit_request_analysis', analysis()); // die nachgeholte Analyse
    const result = await live.reconcile(tenantId, caseId);
    expect(result.redone).toEqual(expect.arrayContaining(['extract', 'reqs', 'ask_draft', 'ask']));
    await orchestrator.advance(tenantId, caseId);

    expect(await nodeOf(tenantId, caseId, 'reqs')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'LIVE' });
    const draft = await prisma.forTenantId(tenantId).communicationDraft.findFirstOrThrow({ where: { caseId, purpose: 'CLARIFICATION', status: 'DRAFT' } });
    expect(draft.bodyText).toContain('Welche Öffnungsart (Dreh-Kipp, Fest) wünschen Sie?');
    expect(draft.version).toBeGreaterThan(1);
    // Anderer Inhalt als der freigegebene → die Person entscheidet neu; bis dahin geht nichts hinaus.
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'AWAITING_APPROVAL' });
    expect(sent).toHaveLength(1);
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, { commandId: randomUUID(), type: 'APPROVE_ACTION', expectedCaseRevision: (await caseOf(tenantId, caseId)).revision, payload: { intentId: intent!.id } });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.bodyText).toContain('Welche Öffnungsart');
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'LIVE' });
  }, 120_000);

  it('Schutz: eine bereits echt gesendete Nachricht wird nie ein zweites Mal gesendet – die KI-Schritte davor bleiben dann ehrlich simuliert', async () => {
    sendMode = 'LIVE';
    aiLive = false;
    const tenantId = await newTenant();
    script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE'));
    seedExtraction();
    const result = await intake.handleIntakeEvent(tenantId, undefined, { ...mail(REAL_SENDER), connectionId: connectionByTenant.get(tenantId) });
    const caseId = result.case!.id;
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, { commandId: randomUUID(), type: 'APPROVE_ACTION', expectedCaseRevision: (await caseOf(tenantId, caseId)).revision, payload: { intentId: intent!.id } });
    expect(sent).toHaveLength(1);
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ executionMode: 'LIVE' });

    aiLive = true; // jetzt gäbe es eine echte KI – aber die Rückfrage ist schon echt hinausgegangen
    const outcome = await live.reconcile(tenantId, caseId);
    expect(outcome.redone).toEqual([]);
    expect(outcome.skipped).toBe('Die Nachricht wurde bereits echt gesendet.');
    await orchestrator.advance(tenantId, caseId);
    expect(sent).toHaveLength(1);
    expect(await live.hintFor(tenantId, caseId, 'extract')).toContain('bleibt es');
  }, 120_000);

  it('Schutz: an eine reservierte Testadresse (example.*, .test, .invalid) wird nie live nachgesendet', async () => {
    const { tenantId, caseId } = await simulatedCase(TEST_SENDER);
    sendMode = 'LIVE';
    const outcome = await live.reconcile(tenantId, caseId);
    expect(outcome.redone).toEqual([]);
    expect(outcome.skipped).toContain('reservierte Testadresse');
    expect(sent).toHaveLength(1);
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ executionMode: 'SIMULATED' });
  }, 120_000);

  it('Schutz: alte Vorgänge werden nie live wiederholt', async () => {
    const { tenantId, caseId } = await simulatedCase();
    sendMode = 'LIVE';
    await prisma.withRlsBypass((tx) => tx.$executeRaw`UPDATE cases SET updated_at = now() - interval '30 days' WHERE id = ${caseId}`);
    expect(await live.reconcile(tenantId, caseId)).toEqual({ resumed: [], redone: [] });
    expect(sent).toHaveLength(1);
  }, 120_000);

  it('Schutz: Schleifen gibt es nicht – endet ein wiederholter Schritt wieder simuliert, wird er höchstens dreimal vom selben Startschritt aus versucht', async () => {
    const { tenantId, caseId } = await simulatedCase();
    sendMode = 'SIMULATED'; // der „echte“ Weg meldet sich als verfügbar, liefert aber wieder eine Simulation
    for (let round = 1; round <= 5; round += 1) {
      const outcome = await live.reconcile(tenantId, caseId);
      if (round <= 3) {
        expect(outcome.redone).toContain('ask');
        await orchestrator.advance(tenantId, caseId);
        // Der Versand wartet erneut auf die Antwort der Kundschaft; die Freigabe wurde übernommen.
        expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'SIMULATED' });
      } else {
        expect(outcome.redone).toEqual([]);
        expect(outcome.skipped).toContain('mehrfach');
      }
    }
    expect(sent).toHaveLength(4); // der ursprüngliche und drei Wiederholungen – dann ist Schluss
  }, 180_000);

  it('Verbindung fiel aus, während die Freigabe erteilt wurde: der blockierte Schritt „wartet auf externes System“ nimmt sich von selbst wieder auf, sobald die Verbindung besteht – und sendet die freigegebene Nachricht', async () => {
    sendMode = 'LIVE';
    aiLive = false;
    const tenantId = await newTenant();
    script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE'));
    seedExtraction();
    const result = await intake.handleIntakeEvent(tenantId, undefined, { ...mail(REAL_SENDER), connectionId: connectionByTenant.get(tenantId) });
    const caseId = result.case!.id;
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'AWAITING_APPROVAL' });

    // Die Verbindung bricht ab; in dieser Zeit wird die Rückfrage freigegeben (die Freigabe wird erteilt, ausgeführt werden kann sie nicht).
    await prisma.forTenantId(tenantId).integration.update({ where: { id: connectionByTenant.get(tenantId)! }, data: { status: 'AUTH_REQUIRED' } });
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, { commandId: randomUUID(), type: 'APPROVE_ACTION', expectedCaseRevision: (await caseOf(tenantId, caseId)).revision, payload: { intentId: intent!.id } });
    expect(sent).toHaveLength(0);
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'BLOCKED', errorCode: 'CAPABILITY_NOT_EXECUTABLE' });
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
    expect(await live.hintFor(tenantId, caseId, 'ask')).toContain('automatisch wieder auf');
    // Solange die Verbindung fehlt, geschieht nichts.
    expect(await live.reconcile(tenantId, caseId)).toEqual({ resumed: [], redone: [] });

    await prisma.forTenantId(tenantId).integration.update({ where: { id: connectionByTenant.get(tenantId)! }, data: { status: 'CONNECTED' } });
    const outcome = await live.reconcile(tenantId, caseId);
    expect(outcome.resumed).toEqual(['ask']);
    await orchestrator.advance(tenantId, caseId);
    // Die erteilte Freigabe gilt weiter: die Nachricht geht jetzt hinaus, ohne dass jemand etwas tun muss.
    expect(sent).toHaveLength(1);
    expect(await nodeOf(tenantId, caseId, 'ask')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'LIVE' });
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
  }, 120_000);

  it('Kandidaten für den Hintergrundabgleich: Vorgänge mit simuliertem Schritt oder blockiertem Schritt, keine abgeschlossenen', async () => {
    const { tenantId, caseId } = await simulatedCase();
    const candidates = await live.candidates(new Date(), tenantId);
    expect(candidates).toEqual(expect.arrayContaining([{ tenantId, caseId }]));
    await prisma.forTenantId(tenantId).case.update({ where: { id: caseId }, data: { orchestrationStatus: 'CANCELLED' } });
    expect(await live.candidates(new Date(), tenantId)).not.toEqual(expect.arrayContaining([{ tenantId, caseId }]));
  }, 120_000);
});
