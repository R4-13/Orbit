import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider, ToolFailedError, type ToolRegistry } from '@orbit/agent-core';
import { PERMISSIONS, PLATFORM_ROLES, triageFixtureForScenario, type PlatformPrincipal } from '@orbit/shared';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../src/agent/agent.tokens';
import { IntakeService } from '../src/intake/intake.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ProcessSweepService } from '../src/process/process-sweep.service';
import { CaseCommandsService, type CommandActor } from '../src/process/case-commands.service';
import { PlatformControlAdminService } from '../src/platform-control/platform-control-admin.service';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/** Nur der Teil des Blueprints, den Tests gezielt anpassen. */
interface TestBlueprint {
  referenceGraph: { nodes: Array<{ id: string; retry?: { maxAttempts: number } }> };
}

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'petra.adaptiv@kunde.example';

/**
 * Amendment 02 Revision 1.2 (AD-01…AD-18, BP-31…BP-45): adaptive, zielorientierte Orchestrierung. Fehlende Informationen lösen zuerst die Auflösungsleiter
 * aus und nicht automatisch einen internen Benutzer; zulässige Sachrückfragen gehen autonom hinaus; die Antwort setzt DENSELBEN Fall ohne manuelles
 * „Fortsetzen“ fort; Konflikte und erreichte Limits führen zu Prüfung statt zu Endlosschleifen oder stillem Weitermachen. Modell und Mailtransport sind
 * Testdoubles (SIMULATED) – der Live-Status dieser Pfade wird getrennt berichtet.
 */
describe('Adaptive orchestration (Amendment 02 v1.2, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let facts: CaseFactsService;
  let store: PlanStoreService;
  let llm: MockLLMProvider;
  let sent: Array<{ to: string; subject: string; bodyText: string; threadId?: string; inReplyTo?: string }>;
  const tenants: string[] = [];
  const platformUsers: string[] = [];
  const connectionByTenant = new Map<string, string>();

  async function newTenant(options: { autonomousClarification: boolean; limits?: Record<string, number>; mutateBlueprint?: (blueprint: TestBlueprint) => void }): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `AD ${suffix.slice(0, 8)}`, slug: `e2e-ad-${suffix}`, adminEmail: `admin-${suffix}@e2e-ad.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'D' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    await app.get(ReferenceProcessService).loadFixture(tenant.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string; limits?: Record<string, number> };
    if (options.limits) blueprint.limits = { ...blueprint.limits, ...options.limits };
    options.mutateBlueprint?.(blueprint as unknown as TestBlueprint);
    await blueprints.importDraft(tenant.id, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenant.id, 'u1', blueprint.key, blueprint.version);
    if (options.autonomousClarification) {
      // Mandantenentscheidung (Amendment 02 v1.2 §30.3): eine sachliche Rückfrage darf autonom versendet werden. Die Angebotszustellung bleibt freigabepflichtig.
      await prisma.forTenantId(tenant.id).policyConfig.update({ where: { tenantId_action: { tenantId: tenant.id, action: 'email.send.clarification' } }, data: { mode: 'AUTONOMOUS' } });
    }
    return tenant.id;
  }

  const nodeState = async (tenantId: string, caseId: string, key: string) => (await store.getActive(tenantId, caseId))?.nodes.find((n) => n.nodeKey === key)?.state;
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });

  function seedTriage(): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  function seedExtraction(items: Array<{ key: string; value: string | number; evidence: string }>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_extracted_facts', input: { facts: items.map((f) => ({ ...f, confidence: 0.9 })) } }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  function mail(tenantId: string, overrides: Partial<NormalizedIntakeEvent>): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Petra Adaptiv' }, recipients: [{ address: 'info@musterwerk.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), ...overrides };
  }


  /** Eine Betreiberidentität (Owner) für Plattformänderungen mitten im Ablauf eines Vorgangs. */
  async function platformOwner(): Promise<PlatformPrincipal> {
    const password = `Pf-${randomUUID().slice(0, 12)}-9!`;
    const email = `ad-${randomUUID().slice(0, 8)}@platform-test.example`;
    platformUsers.push((await app.get(PlatformIdentityService).create(null, { email, displayName: 'AD Owner', password, roles: [PLATFORM_ROLES.PLATFORM_OWNER] })).id);
    const auth = app.get(PlatformAuthService);
    return auth.authenticate((await auth.login(email, password)).accessToken);
  }
  const approver = (tenantId: string): CommandActor => ({ id: randomUUID(), tenantId, permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE, PERMISSIONS.APPROVAL_DECIDE] });
  const command = (type: string, revision: number, payload: Record<string, unknown>) => ({ commandId: randomUUID(), type, expectedCaseRevision: revision, payload });

  /** Erste Nachricht (Rückfrage geht autonom raus) und Antwort mit allen Angaben: der Vorgang steht danach bei der Freigabe der Angebotszustellung. */
  async function reachDelivery(tenantId: string, tag: string): Promise<string> {
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für Fenster.', threadId: `thr-${tag}`, rfcMessageId: `<${tag}-1@kunde.example>` }));
    const caseId = first.case!.id;
    seedExtraction([
      { key: 'request.quantity', value: 12, evidence: '12 Fenster' },
      { key: 'request.delivery_address', value: 'Hauptstr. 5, 12345 Berlin', evidence: 'Hauptstr. 5, 12345 Berlin' },
    ]);
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Angebot Fenster', content: '12 Fenster, Hauptstr. 5, 12345 Berlin.', threadId: `thr-${tag}`, inReplyTo: '<sent-1@mail.example>', rfcMessageId: `<${tag}-2@kunde.example>` }));
    return caseId;
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    facts = app.get(CaseFactsService);
    store = app.get(PlanStoreService);
    llm = app.get(LLM_PROVIDER);
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenantId, message) => {
      sent.push(message as never);
      return { providerMessageId: `gm-${sent.length}`, threadId: message.threadId ?? 'thr-new', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
    });
  });

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    await prisma.withPlatformScope((tx) => tx.platformUser.deleteMany({ where: { id: { in: platformUsers } } }));
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  it('AD-03/AD-04 (BP-32/33/34): fehlende Angabe nur beim Kunden → ORBIT fragt autonom nach, wartet, setzt DENSELBEN Fall bei der Antwort ohne internen Benutzer fort – bis zum nächsten verifizierten fachlichen Zustand', async () => {
    const tenantId = await newTenant({ autonomousClarification: true });
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Guten Tag, wir möchten ein Angebot für Fenster. Petra', threadId: 'thr-ad1', rfcMessageId: '<ad1@kunde.example>' }));
    const caseId = first.case!.id;

    // Die Rückfrage ging OHNE Freigabe und OHNE internen Benutzer hinaus; der Fall wartet auf die Antwort.
    expect(await nodeState(tenantId, caseId, 'ask')).toBe('SUCCEEDED');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: SENDER, threadId: 'thr-ad1', inReplyTo: '<ad1@kunde.example>' });
    expect(sent[0]!.bodyText).toContain('Welche Menge');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(0); // keine Aufgabe an einen internen Benutzer
    expect(await prisma.forTenantId(tenantId).approval.count({ where: { status: 'PENDING' } })).toBe(0);

    // BP-32: die Auflösungsleiter ist nachvollziehbar protokolliert – zuerst bekannte Angaben/Kommunikation, die externe Rückfrage erst danach, kein Mensch.
    const attempts = async () => (await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: 'context.resolution_attempted' }, orderBy: { sequence: 'asc' } })).map((e) => e.payload as Record<string, unknown>);
    const beforeReply = await attempts();
    expect(beforeReply.find((a) => a.requirementKey === 'request.product_sku')).toMatchObject({ result: 'SATISFIED', strategy: 'COMMUNICATION' });
    expect(beforeReply.find((a) => a.requirementKey === 'request.quantity')).toMatchObject({ result: 'NOT_FOUND', triedStrategies: ['CASE_FACT', 'COMMUNICATION'], nextAllowedStrategies: ['EXTERNAL_CLARIFICATION', 'HUMAN_REVIEW'] });

    // Die Antwort kommt – niemand klickt „Fortsetzen“.
    seedExtraction([
      { key: 'request.quantity', value: 12, evidence: '12 Fenster' },
      { key: 'request.delivery_address', value: 'Hauptstr. 5, 12345 Berlin', evidence: 'Hauptstr. 5, 12345 Berlin' },
    ]);
    const reply = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Angebot Fenster', content: 'Es sind 12 Fenster. Lieferadresse: Hauptstr. 5, 12345 Berlin.', threadId: 'thr-ad1', inReplyTo: '<sent-1@mail.example>', rfcMessageId: '<ad2@kunde.example>' }));
    expect(reply.case!.id).toBe(caseId);

    expect(await nodeState(tenantId, caseId, 'wait')).toBe('SUCCEEDED');
    expect(await nodeState(tenantId, caseId, 'price')).toBe('SUCCEEDED');
    const quote = await prisma.forTenantId(tenantId).quote.findFirstOrThrow({ where: { caseId } });
    expect(quote.priceSource).toBe('TEST_SOR:catalog');
    // Der nächste fachliche Zustand ist verifiziert, die Auslieferung wartet policy-konform auf Freigabe (REQUIRE_APPROVAL bleibt für den Angebotsversand).
    expect(await nodeState(tenantId, caseId, 'deliver')).toBe('AWAITING_APPROVAL');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
    expect(sent).toHaveLength(1); // nichts Weiteres wurde ohne Freigabe gesendet
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(0);
    const received = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: { in: ['communication.received', 'wait.satisfied'] } } });
    expect(received.map((e) => e.type)).toEqual(expect.arrayContaining(['communication.received', 'wait.satisfied']));
    // Nach der Antwort ist dieselbe Angabe über die Kommunikation geklärt; derselbe Faktenstand wird nicht doppelt protokolliert.
    const afterReply = await attempts();
    expect(afterReply.filter((a) => a.requirementKey === 'request.quantity' && a.result === 'SATISFIED')).toHaveLength(1);
    expect(afterReply.filter((a) => a.requirementKey === 'request.quantity' && a.result === 'NOT_FOUND')).toHaveLength(1);
  });

  it('AD-05/AD-12 (BP-39): Teilantwort → nur die verbleibende Angabe bleibt offen; das Limit für automatische Rückfragen (1) ist erreicht → Prüfung statt Endlosschleife, kein Angebot', async () => {
    const tenantId = await newTenant({ autonomousClarification: true });
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für Fenster.', threadId: 'thr-ad2', rfcMessageId: '<ad3@kunde.example>' }));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1);

    seedExtraction([{ key: 'request.quantity', value: 8, evidence: '8 Fenster' }]); // Lieferadresse fehlt weiterhin
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Angebot Fenster', content: 'Wir brauchen 8 Fenster.', threadId: 'thr-ad2', inReplyTo: '<sent-1@mail.example>', rfcMessageId: '<ad4@kunde.example>' }));

    const current = await facts.getCurrent(tenantId, caseId);
    expect(current.find((f) => f.key === 'request.quantity')).toMatchObject({ value: 8, status: 'CONFIRMED' });
    expect(current.find((f) => f.key === 'request.delivery_address')).toBeUndefined();
    expect(sent).toHaveLength(1); // keine zweite autonome Rückfrage über das Limit hinaus
    expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId } })).toBe(0);
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    expect(row.attentionReasons.join(' ')).not.toBe('');
  });

  it('BP-39: erreicht ein Vorgang das Aktionslimit des Blueprints (3: Extraktion, Entwurf und Versand der Rückfrage), wird keine weitere Aktion vorbereitet – Prüfung mit verständlichem Grund statt stiller Fortsetzung', async () => {
    const tenantId = await newTenant({ autonomousClarification: true, limits: { maxActionsPerCase: 3 } });
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für Fenster.', threadId: 'thr-ad-lim', rfcMessageId: '<adl1@kunde.example>' }));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1); // die ersten drei Aktionen (Extraktion, Entwurf, Versand der Rückfrage) sind erlaubt

    // Die Extraktion der Antwort wäre die vierte Aktion und wird gar nicht erst vorbereitet – deshalb wird dafür keine Modellantwort bereitgestellt.
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Angebot Fenster', content: '12 Fenster, Hauptstr. 5, 12345 Berlin.', threadId: 'thr-ad-lim', inReplyTo: '<sent-1@mail.example>', rfcMessageId: '<adl2@kunde.example>' }));

    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.attentionReasons.join(' ')).toContain('Limit von 3');
    expect(sent).toHaveLength(1); // nichts Weiteres wurde versendet
    expect(row.completedAt).toBeNull();
    const intents = await prisma.forTenantId(tenantId).actionIntent.count({ where: { caseId } });
    expect(intents).toBe(3); // das Limit verhindert das Vorbereiten einer vierten Aktion
    const blocked = (await store.getActive(tenantId, caseId))!.nodes.filter((n) => n.errorCode === 'LIMIT_ACTIONS_PER_CASE');
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('AD-13: die Preisquelle ist vorübergehend nicht erreichbar → der Schritt wird mit Wartezeit wiederholt, kein Mensch wird belästigt, nichts wird erfunden – danach geht derselbe Fall weiter', async () => {
    const tenantId = await newTenant({
      autonomousClarification: true,
      mutateBlueprint: (blueprint) => {
        blueprint.referenceGraph.nodes.find((n) => n.id === 'price')!.retry = { maxAttempts: 3 };
      },
    });
    const tool = app.get<ToolRegistry>(TOOL_REGISTRY).get('resolve_price')!;
    const original = tool.execute.bind(tool);
    let sourceDown = true;
    const spy = jest.spyOn(tool, 'execute').mockImplementation(async (input, ctx) => {
      if (sourceDown) throw new ToolFailedError('Die Preisquelle ist gerade nicht erreichbar.', { errorCode: 'SOURCE_TEMPORARILY_UNAVAILABLE', retryable: true });
      return original(input, ctx);
    });
    try {
      seedTriage();
      seedExtraction([
        { key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' },
        { key: 'request.quantity', value: 12, evidence: '12 Fenster' },
        { key: 'request.delivery_address', value: 'Hauptstr. 5, 12345 Berlin', evidence: 'Hauptstr. 5, 12345 Berlin' },
      ]);
      const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten 12 Fenster, Hauptstr. 5, 12345 Berlin.', threadId: 'thr-ad13', rfcMessageId: '<ad13@kunde.example>' }));
      const caseId = first.case!.id;

      // Die Quelle ist weg: der Schritt wartet auf seine Wiederholung – kein Preis, kein Angebot, keine Aufgabe, keine Eskalation an einen Menschen.
      const waiting = (await store.getActive(tenantId, caseId))!.nodes.find((n) => n.nodeKey === 'price')!;
      expect(waiting.state).toBe('PLANNED');
      expect(waiting.errorCode).toBe('SOURCE_TEMPORARILY_UNAVAILABLE');
      expect(waiting.retryAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId } })).toBe(0);
      expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(0);
      expect(waiting.attempts).toBe(1); // genau ein Versuch – die Wartezeit schützt vor einem Sofort-Wiederholen aller Versuche
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');

      // Die Quelle ist zurück, die Wartezeit ist um: derselbe Fall setzt sich fort und erreicht den nächsten verifizierten Zustand.
      sourceDown = false;
      await prisma.forTenantId(tenantId).processPlanNode.updateMany({ where: { state: 'PLANNED', retryAt: { not: null }, plan: { caseId } }, data: { retryAt: new Date(Date.now() - 1000) } });
      await app.get(ProcessSweepService).sweep();
      expect(await nodeState(tenantId, caseId, 'price')).toBe('SUCCEEDED');
      expect((await prisma.forTenantId(tenantId).quote.findFirstOrThrow({ where: { caseId } })).priceSource).toBe('TEST_SOR:catalog');
      expect(await nodeState(tenantId, caseId, 'deliver')).toBe('AWAITING_APPROVAL');
    } finally {
      spy.mockRestore();
    }
  });

  it('§29.5 Notschalter KI-Planer und Neuplanung: die Neuplanung fällt auf den festen Referenzgraphen zurück, nichts wird erneut versendet, es gibt genau einen aktiven Plan – und der Fall setzt bei der Antwort fort', async () => {
    const actor = await platformOwner();
    const admin = app.get(PlatformControlAdminService);
    const tenantId = await newTenant({ autonomousClarification: true });
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für Fenster.', threadId: 'thr-ks', rfcMessageId: '<ks1@kunde.example>' }));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1);
    const intentsBefore = await prisma.forTenantId(tenantId).actionIntent.count({ where: { caseId } });
    const revisionsBefore = await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId } });

    await admin.setKillSwitch(actor, 'planner.adaptive', { engaged: true, reason: 'Test: KI-Planer gestoppt während der Neuplanung' });
    try {
      // Der echte Weg: der Befehl „Neu planen“ einer Person, danach läuft der Vorgang weiter.
      await app.get(CaseCommandsService).execute(approver(tenantId), caseId, command('REPLAN', (await caseOf(tenantId, caseId)).revision, {}));
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).not.toBe('MANUAL_REVIEW'); // der Referenzgraph ist der sichere Rückfall, keine Prüfung nötig

      const plans = await prisma.forTenantId(tenantId).processPlan.findMany({ where: { caseId } });
      expect(plans.length).toBe(revisionsBefore + 1);
      expect(plans.filter((p) => p.status === 'ACTIVE')).toHaveLength(1); // nie zwei aktive Pläne
      expect(plans.filter((p) => p.source === 'LLM_PLANNER')).toHaveLength(0); // der Planer war aus: kein Modellplan
      expect(sent).toHaveLength(1); // die bereits bestätigte Rückfrage wurde nicht wiederholt
      expect(await prisma.forTenantId(tenantId).actionIntent.count({ where: { caseId } })).toBe(intentsBefore);
      const nodes = (await store.getActive(tenantId, caseId))!.nodes;
      expect(nodes.filter((n) => n.state === 'RUNNING')).toHaveLength(0);
      // Genau eine Erwartung wartet, und zwar die des aktiven Plans; die des abgelösten ist beendet – sonst verbrauchte eine Antwort die falsche und der Vorgang bliebe stehen.
      const waits = await prisma.forTenantId(tenantId).waitSubscription.findMany({ where: { caseId } });
      expect(waits.filter((w) => w.status === 'WAITING')).toHaveLength(1);
      expect(waits.filter((w) => w.status === 'WAITING')[0]!.planId).toBe(plans.find((p) => p.status === 'ACTIVE')!.id);
      expect(waits.filter((w) => w.planId !== plans.find((p) => p.status === 'ACTIVE')!.id).every((w) => w.status === 'CANCELLED')).toBe(true); // die Erwartung des abgelösten Plans ist beendet, keine veraltete wartet
      expect(['FAILED', 'CANCELLED']).not.toContain((await caseOf(tenantId, caseId)).orchestrationStatus);

      // Feste Referenzgraphen laufen mit abgeschaltetem KI-Planer weiter: die Antwort setzt denselben Fall fort.
      seedExtraction([
        { key: 'request.quantity', value: 12, evidence: '12 Fenster' },
        { key: 'request.delivery_address', value: 'Hauptstr. 5, 12345 Berlin', evidence: 'Hauptstr. 5, 12345 Berlin' },
      ]);
      await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Angebot Fenster', content: '12 Fenster, Hauptstr. 5, 12345 Berlin.', threadId: 'thr-ks', inReplyTo: '<sent-1@mail.example>', rfcMessageId: '<ks2@kunde.example>' }));
      expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId } })).toBe(1);
      expect(sent).toHaveLength(1); // die Zustellung wartet weiter auf Freigabe
    } finally {
      await admin.setKillSwitch(actor, 'planner.adaptive', { engaged: false, reason: 'Test beendet' });
    }
  });

  it('§29.5 Connector-Sperre während einer offenen Freigabe: die Freigabe führt nichts aus, der Vorgang wartet mit verständlichem Grund; nach Aufhebung wird genau einmal gesendet', async () => {
    const actor = await platformOwner();
    const admin = app.get(PlatformControlAdminService);
    const commands = app.get(CaseCommandsService);
    const tenantId = await newTenant({ autonomousClarification: true });
    const caseId = await reachDelivery(tenantId, 'cs');
    expect(await nodeState(tenantId, caseId, 'deliver')).toBe('AWAITING_APPROVAL');
    expect(sent).toHaveLength(1);
    const delivery = await prisma.forTenantId(tenantId).actionIntent.findFirstOrThrow({ where: { caseId, purpose: 'QUOTE_DELIVERY', capabilityKey: 'email.send' } });

    const versionOf = async () => (await admin.listConnectors()).find((c) => c.connectorKey === 'GMAIL')!.version;
    await admin.setConnectorLifecycle(actor, 'GMAIL', { to: 'SUSPENDED', reason: 'Test: Anbieterstörung', expectedVersion: await versionOf() });
    try {
      // Eine Person gibt frei, während der Connector gesperrt ist: es wird nichts versendet.
      await commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', (await caseOf(tenantId, caseId)).revision, { intentId: delivery.id }));
      expect(sent).toHaveLength(1);
      const blocked = (await store.getActive(tenantId, caseId))!.nodes.find((n) => n.nodeKey === 'deliver')!;
      expect(blocked).toMatchObject({ state: 'BLOCKED', errorCode: 'CAPABILITY_NOT_EXECUTABLE' });
      const row = await caseOf(tenantId, caseId);
      expect(row.orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
      expect(row.attentionReasons.join(' ')).toMatch(/gesperrt|nicht ausführbar|Anbieter/i); // verständlicher Grund, kein Technikcode
      expect(row.completedAt).toBeNull();
      expect((await prisma.forTenantId(tenantId).actionIntent.findUniqueOrThrow({ where: { id: delivery.id } })).status).not.toBe('CONFIRMED'); // nichts als erledigt vermerkt
    } finally {
      await admin.setConnectorLifecycle(actor, 'GMAIL', { to: 'ACTIVE', reason: 'Test: Störung behoben', expectedVersion: await versionOf() });
    }

    // Sperre aufgehoben: der Schritt wird wiederholt und sendet genau einmal; der Vorgang schließt ab.
    // Der echte Weg: der Befehl „Schritt wiederholen“; die frühere Freigabe gilt weiter (sie wurde nicht entwertet), eine neue ist nicht nötig.
    expect((await prisma.forTenantId(tenantId).actionIntent.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('APPROVED');
    await commands.execute(approver(tenantId), caseId, command('RETRY_STEP', (await caseOf(tenantId, caseId)).revision, { stepRunId: 'deliver' }));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toMatch(/^Ihr Angebot /);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
    await app.get(ProcessSweepService).sweep();
    expect(sent).toHaveLength(2); // auch ein weiterer Durchlauf versendet nichts doppelt
  });

  it('AD-06: widersprüchliche Antwort → Konflikt sichtbar, keine automatische riskante Fortsetzung, kein Angebot', async () => {
    const tenantId = await newTenant({ autonomousClarification: true });
    seedTriage();
    seedExtraction([
      { key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' },
      { key: 'request.quantity', value: 12, evidence: '12 Fenster' },
    ]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für 12 Fenster.', threadId: 'thr-ad3', rfcMessageId: '<ad5@kunde.example>' }));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1); // die Lieferadresse fehlt noch

    seedExtraction([
      { key: 'request.quantity', value: 20, evidence: '20 Fenster' },
      { key: 'request.delivery_address', value: 'Hauptstr. 5, 12345 Berlin', evidence: 'Hauptstr. 5, 12345 Berlin' },
    ]);
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Angebot Fenster', content: 'Es sind 20 Fenster. Lieferadresse Hauptstr. 5, 12345 Berlin.', threadId: 'thr-ad3', inReplyTo: '<sent-1@mail.example>', rfcMessageId: '<ad6@kunde.example>' }));

    const quantity = (await facts.getCurrent(tenantId, caseId)).filter((f) => f.key === 'request.quantity');
    expect(quantity.length).toBeGreaterThanOrEqual(1);
    expect(quantity.every((f) => f.status === 'CONFLICTED')).toBe(true);
    expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId } })).toBe(0);
    expect(['MANUAL_REVIEW', 'WAITING_FOR_INFORMATION']).toContain((await caseOf(tenantId, caseId)).orchestrationStatus);
    expect((await caseOf(tenantId, caseId)).completedAt).toBeNull();
  });

  it('AD-07: Policy REQUIRE_APPROVAL → die Vorbereitung läuft autonom, die Wirkung wartet auf die gebundene Freigabe (nichts versendet)', async () => {
    const tenantId = await newTenant({ autonomousClarification: false });
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für Fenster.', threadId: 'thr-ad4', rfcMessageId: '<ad7@kunde.example>' }));
    const caseId = first.case!.id;
    expect(await nodeState(tenantId, caseId, 'ask_draft')).toBe('SUCCEEDED');
    expect(await nodeState(tenantId, caseId, 'ask')).toBe('AWAITING_APPROVAL');
    expect(sent).toHaveLength(0);
    expect(await prisma.forTenantId(tenantId).approval.count({ where: { status: 'PENDING' } })).toBeGreaterThan(0);
  });

  it('BP-35: die menschliche Anfrage ist konkret – Grund, Frage und zulässige Wirkungen (HumanInteractionRequest als Projektion, keine zweite Tabelle)', async () => {
    const tenantId = await newTenant({ autonomousClarification: false });
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster' }]);
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot Fenster', content: 'Wir möchten ein Angebot für Fenster.', threadId: 'thr-ad5', rfcMessageId: '<ad8@kunde.example>' }));
    const requests = await app.get(HumanInteractionService).forCase({ tenantId, permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE, PERMISSIONS.APPROVAL_DECIDE] }, first.case!.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ type: 'APPROVAL', reasonCode: 'POLICY_REQUIRES_APPROVAL' });
    expect(requests[0]!.businessQuestion).toContain('Rückfrage');
    expect(requests[0]!.allowedResponses.map((r) => r.key)).toEqual(expect.arrayContaining(['APPROVE_ACTION', 'REJECT_ACTION']));
    for (const response of requests[0]!.allowedResponses) expect(response.effectDescription.length).toBeGreaterThan(10);
  });
});

import { HumanInteractionService } from '../src/process/human-interaction.service';
