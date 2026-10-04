import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider, type ToolRegistry } from '@orbit/agent-core';
import { PERMISSIONS, triageFixtureForScenario } from '@orbit/shared';
import { z } from 'zod';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../src/agent/agent.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActionLedgerService } from '../src/process/action-ledger.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CapabilityRegistryService } from '../src/process/capability-registry.service';
import { CaseCommandsService, type CommandActor } from '../src/process/case-commands.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'petra.lang@lang-metall.example';

/**
 * The execution cases of Amendment 02 §25.2 that the other suites do not cover: thrown exceptions, duplicate and
 * concurrent approvals, late events, a send whose local confirmation fails, a lost send scope, model outage, a changed
 * price, replanning with a confirmed action and the replan limit.
 */
describe('Process hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let commands: CaseCommandsService;
  let orchestrator: OrchestratorService;
  let facts: CaseFactsService;
  let ledger: ActionLedgerService;
  let store: PlanStoreService;
  let reference: ReferenceProcessService;
  let blueprints: BlueprintRegistryService;
  let capabilities: CapabilityRegistryService;
  let tenantsService: TenantsService;
  let llm: MockLLMProvider;
  let tools: ToolRegistry;
  let sendSpy: jest.SpyInstance;
  let sent: Array<{ to: string; subject: string }>;
  let nextProviderId: () => string;
  const tenants: string[] = [];
  let lookupThrows = false;

  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, ...extra });
  const edge = (id: string, source: string, target: string) => ({ id, source, target });
  const fxLookup = {
    key: 'fx.lookup2',
    version: '1.0.0',
    description: 'Fixture: liest einen Wert.',
    inputSchemaRef: 'schema/fx-lookup2/1',
    outputSchemaRef: 'schema/fx-lookup2-result/1',
    permissionKeys: ['case.read'],
    policyAction: 'context.lookup' as const,
    sideEffect: 'NONE' as const,
    riskClass: 'LOW' as const,
    toolBindings: ['fx_lookup2'],
    idempotencyStrategy: 'NONE' as const,
    confirmationStrategy: 'NONE' as const,
    timeoutMs: 5000,
    retryPolicyRef: 'read-default',
  };
  const lookupBlueprint = {
    schemaVersion: '1.0',
    key: 'FX_THROW',
    version: '1.0.0',
    title: 'Fixture Exception',
    goals: ['x.done'],
    triggers: [{ type: 'communication.received' }],
    intentHints: ['FX_THROW'],
    requiredFacts: [{ key: 'topic', type: 'string' }],
    allowedCapabilities: ['fx.lookup2'],
    planMode: 'FIXED',
    referenceGraph: {
      nodes: [node('interpret', 'INTERPRET'), node('look', 'ACTION', { capability: { key: 'fx.lookup2' }, inputs: { key: { fact: 'topic' } } }), node('done', 'COMPLETE')],
      edges: [edge('e1', 'interpret', 'look'), edge('e2', 'look', 'done')],
    },
    completionCriteria: { all: [{ requirementSatisfied: 'topic' }, { exists: { stepOutput: { node: 'look', path: 'found' } } }] },
  };

  const approver = (tenantId: string): CommandActor => ({ id: randomUUID(), tenantId, permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE, PERMISSIONS.APPROVAL_DECIDE] });
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const command = (type: string, revision: number, payload: Record<string, unknown>) => ({ commandId: randomUUID(), type, expectedCaseRevision: revision, payload });
  const nodeState = async (tenantId: string, caseId: string, key: string) => (await store.getActive(tenantId, caseId))?.nodes.find((n) => n.nodeKey === key)?.state;

  async function newTenant(options: { send?: boolean } = {}): Promise<{ tenantId: string; integrationId: string }> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({ name: `Hardening ${suffix.slice(0, 6)}`, slug: `e2e-hard-${suffix}`, adminEmail: `admin-${suffix}@e2e-hard.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({
      data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: options.send === false ? ['email.read'] : ['email.read', 'email.send'] },
    });
    await reference.loadFixture(tenant.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const rfq = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    for (const definition of [rfq, lookupBlueprint]) {
      await blueprints.importDraft(tenant.id, 'u1', definition);
      for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', definition.key, definition.version, to);
      await blueprints.activate(tenant.id, 'u1', definition.key, definition.version);
    }
    return { tenantId: tenant.id, integrationId: integration.id };
  }

  function seedTriage(): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  function seedExtraction(list: Array<{ key: string; value: string | number; evidence: string }>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_extracted_facts', input: { facts: list.map((f) => ({ ...f, confidence: 0.9 })) } }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  const mail = (tenantId: string, over: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent => ({
    tenantId,
    channel: 'SIMULATED',
    provider: 'simulated',
    externalEventId: randomUUID(),
    occurredAt: new Date(),
    sender: { address: SENDER },
    recipients: [{ address: 'info@musterwerk.example' }],
    subject: 'Angebot Tür',
    content: 'Wir möchten ein Angebot für eine Haustür, 1 Stück, Lieferung nach Ringstr. 3, 20095 Hamburg.',
    threadId: `thr-${randomUUID()}`,
    rfcMessageId: `<${randomUUID()}@lang-metall.example>`,
    direction: 'INBOUND',
    ...over,
  });
  /** A complete request: everything is known, so the case runs straight to the delivery approval. */
  async function completeRequest(tenantId: string): Promise<string> {
    seedTriage();
    seedExtraction([
      { key: 'request.product_sku', value: 'TUER-HAUS', evidence: 'Haustür' },
      { key: 'request.quantity', value: 1, evidence: '1 Stück' },
      { key: 'request.delivery_address', value: 'Ringstr. 3, 20095 Hamburg', evidence: 'Ringstr. 3, 20095 Hamburg' },
    ]);
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    return result.case!.id;
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    commands = app.get(CaseCommandsService);
    orchestrator = app.get(OrchestratorService);
    facts = app.get(CaseFactsService);
    ledger = app.get(ActionLedgerService);
    store = app.get(PlanStoreService);
    reference = app.get(ReferenceProcessService);
    blueprints = app.get(BlueprintRegistryService);
    capabilities = app.get(CapabilityRegistryService);
    tenantsService = app.get(TenantsService);
    llm = app.get(LLM_PROVIDER);
    tools = app.get(TOOL_REGISTRY);

    tools.register({
      name: 'fx_lookup2',
      description: 'fixture',
      inputSchema: z.object({ key: z.string() }),
      policyAction: 'context.lookup',
      execute: async (input: { key: string }) => {
        if (lookupThrows) throw new Error('Verbindung zum Quellsystem abgebrochen');
        return { found: true, echo: input.key, executionMode: 'LIVE' };
      },
    });
    capabilities.register(fxLookup);

    sendSpy = jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push({ to: message.to, subject: message.subject });
      return { providerMessageId: nextProviderId(), threadId: message.threadId ?? 'thr', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
    });
  });

  beforeEach(() => {
    sent = [];
    let n = 0;
    nextProviderId = () => `gm-${randomUUID().slice(0, 8)}-${++n}`;
    sendSpy.mockClear();
    lookupThrows = false;
  });

  afterAll(async () => {
    capabilities.unregister('fx.lookup2');
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  it('a thrown exception (not a returned error) fails the node, the case and the intake status the same way', async () => {
    const { tenantId, integrationId } = await newTenant();
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'GENERAL', title: 'Exception' } });
    await facts.setByHuman(tenantId, c.id, 'u1', { key: 'topic', value: 'Garantie', valueType: 'string' });
    const intakeEvent = await prisma.forTenantId(tenantId).intakeEvent.create({ data: { tenantId, connectionId: integrationId, channel: 'EMAIL', provider: 'gmail', externalEventId: randomUUID(), occurredAt: new Date(), status: 'COMPLETED', caseId: c.id } });
    lookupThrows = true;

    await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_THROW' });
    await orchestrator.advance(tenantId, c.id);

    expect(await nodeState(tenantId, c.id, 'look')).toBe('FAILED');
    expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(await nodeState(tenantId, c.id, 'done')).toBe('PLANNED');
    expect(await prisma.forTenantId(tenantId).intakeEvent.findUniqueOrThrow({ where: { id: intakeEvent.id } })).toMatchObject({ status: 'NEEDS_REVIEW' });
    const failed = (await store.getActive(tenantId, c.id))!.nodes.find((n) => n.nodeKey === 'look')!;
    expect(failed).toMatchObject({ errorCode: 'TOOL_EXCEPTION' });
    expect(failed.errorMessage).toContain('Quellsystem');
  });

  it('the same approval delivered twice, and two approvals decided at the same moment, send exactly once', async () => {
    const { tenantId } = await newTenant();
    const caseId = await completeRequest(tenantId);
    const [intent] = await ledger.openIntents(tenantId, caseId);
    expect(intent).toMatchObject({ purpose: 'QUOTE_DELIVERY', status: 'AWAITING_APPROVAL' });
    const revision = (await caseOf(tenantId, caseId)).revision;

    const results = await Promise.allSettled([
      commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', revision, { intentId: intent!.id })),
      commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', revision, { intentId: intent!.id })),
      commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', revision, { intentId: intent!.id })),
    ]);

    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(sent).toHaveLength(1);
    expect((await ledger.get(tenantId, intent!.id)).status).toBe('CONFIRMED');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
    expect((await ledger.receipts(tenantId, intent!.id)).filter((r) => r.status === 'CONFIRMED')).toHaveLength(1);
  });

  it('an event that arrives after completion is recorded, consumed and changes nothing', async () => {
    const { tenantId } = await newTenant();
    const caseId = await completeRequest(tenantId);
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', (await caseOf(tenantId, caseId)).revision, { intentId: intent!.id }));
    const done = await caseOf(tenantId, caseId);
    expect(done.orchestrationStatus).toBe('COMPLETED');

    const late = await orchestrator.receiveInbound(tenantId, caseId, { type: 'communication.received', payload: { emailMessageId: 'late' }, dedupeKey: 'inbound:late' });
    await orchestrator.advance(tenantId, caseId);

    expect(late.accepted).toBe(true);
    const after = await caseOf(tenantId, caseId);
    expect(after.orchestrationStatus).toBe('COMPLETED');
    expect(after.outcome).toEqual(done.outcome);
    expect((await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: 'communication.received' } })).every((e) => e.processedAt !== null)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('mail is sent but the local confirmation fails → OUTCOME_UNKNOWN, never resent, reconciled by a person', async () => {
    const { tenantId } = await newTenant();
    const providerId = `dup-${randomUUID()}`;
    nextProviderId = () => providerId;
    // A row with the provider id already exists, so recording the sent message violates its uniqueness AFTER the send.
    await prisma.forTenantId(tenantId).emailMessage.create({ data: { tenantId, direction: 'OUTBOUND', fromAddress: 'x@x.example', toAddresses: ['y@y.example'], providerMessageId: providerId } });
    const caseId = await completeRequest(tenantId);
    const [intent] = await ledger.openIntents(tenantId, caseId);

    await commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', (await caseOf(tenantId, caseId)).revision, { intentId: intent!.id }));

    expect(sent).toHaveLength(1);
    expect(await nodeState(tenantId, caseId, 'deliver')).toBe('OUTCOME_UNKNOWN');
    expect((await ledger.get(tenantId, intent!.id)).status).toBe('OUTCOME_UNKNOWN');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('MANUAL_REVIEW');
    const unknownReceipt = (await ledger.receipts(tenantId, intent!.id))[0]!;
    expect(unknownReceipt).toMatchObject({ status: 'OUTCOME_UNKNOWN' });
    expect(JSON.stringify(unknownReceipt.evidence)).toContain(providerId);

    await orchestrator.advance(tenantId, caseId);
    await orchestrator.advance(tenantId, caseId);
    expect(sent).toHaveLength(1);

    // The person checks the mailbox and confirms it happened → completes without a second send.
    await commands.execute(approver(tenantId), caseId, command('RECONCILE_ACTION', (await caseOf(tenantId, caseId)).revision, { intentId: intent!.id, happened: true, note: 'Im Postfach gefunden' }));
    expect(sent).toHaveLength(1);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
  });

  it('a connection that loses the send permission before execution blocks the step; nothing is sent', async () => {
    const { tenantId, integrationId } = await newTenant();
    const caseId = await completeRequest(tenantId);
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await prisma.withRlsBypass((tx) => tx.integration.update({ where: { id: integrationId }, data: { grantedCapabilities: ['email.read'] } }));

    await commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', (await caseOf(tenantId, caseId)).revision, { intentId: intent!.id }));

    expect(sent).toHaveLength(0);
    expect(await nodeState(tenantId, caseId, 'deliver')).toBe('BLOCKED');
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
    expect(row.attentionReasons.join(' ')).toContain('email.send');
    // The block is explained to the user, and fixing the cause (granting again) lets the step be retried.
    await prisma.withRlsBypass((tx) => tx.integration.update({ where: { id: integrationId }, data: { grantedCapabilities: ['email.read', 'email.send'] } }));
    await commands.execute(approver(tenantId), caseId, command('RETRY_STEP', (await caseOf(tenantId, caseId)).revision, { stepRunId: 'deliver' }));
    expect(sent).toHaveLength(1);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
  });

  it('without a connected model the extraction fails visibly and nothing is guessed', async () => {
    const { tenantId } = await newTenant();
    seedTriage(); // triage works, the extraction call finds no scripted answer (the simulated model has nothing to say)
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Angebot', content: 'Bitte ein Angebot für Fenster.' }));
    const caseId = result.case!.id;

    expect(await nodeState(tenantId, caseId, 'extract')).toBe('FAILED');
    const extract = (await store.getActive(tenantId, caseId))!.nodes.find((n) => n.nodeKey === 'extract')!;
    expect(extract.errorCode).toBe('AI_NOT_CONNECTED');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('MANUAL_REVIEW');
    expect((await facts.getCurrent(tenantId, caseId)).some((f) => f.key === 'request.product_sku')).toBe(false);
    expect(await prisma.forTenantId(tenantId).communicationDraft.count({ where: { caseId } })).toBe(0);
    expect(await prisma.forTenantId(tenantId).intakeEvent.findFirstOrThrow({ where: { caseId } })).toMatchObject({ status: 'NEEDS_REVIEW' });
  });

  it('a price that changed after pricing is caught when the quote is created (no stale price slips through)', async () => {
    const { tenantId } = await newTenant();
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Preis' } });
    const run = await prisma.forTenantId(tenantId).agentRun.create({ data: { tenantId, caseId: c.id, agentType: 'ORCHESTRATOR', triggerType: 'MANUAL', status: 'RUNNING' } });
    const priced = (await tools.execute('resolve_price', { sku: 'TUER-HAUS', quantity: 2 }, { tenantId, agentRunId: run.id })) as { lines: unknown[]; currency: string; priceSource: string };
    expect(priced.priceSource).toBe('TEST_SOR:catalog');

    await reference.loadFixture(tenantId, { catalog: [{ sku: 'TUER-HAUS', name: 'Haustür Aluminium', category: 'DOORS', unit: 'Stk', unitPrice: '1990.00', currency: 'EUR', taxRate: 19 }] });

    await expect(tools.execute('create_quote', { lines: priced.lines, currency: priced.currency, priceSource: priced.priceSource }, { tenantId, agentRunId: run.id })).rejects.toMatchObject({ errorCode: 'PRICE_CHANGED' });
    expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId: c.id } })).toBe(0);
    // An unknown SKU never gets a price.
    await expect(tools.execute('resolve_price', { sku: 'GIBT-ES-NICHT', quantity: 1 }, { tenantId, agentRunId: run.id })).rejects.toMatchObject({ errorCode: 'PRICE_SOURCE_NOT_FOUND' });
  });

  it('a replan after a confirmed send keeps the receipt, repeats nothing and records what changed', async () => {
    const { tenantId } = await newTenant();
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'TUER-HAUS', evidence: 'Haustür' }]);
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { content: 'Wir möchten ein Angebot für eine Haustür.' }));
    const caseId = result.case!.id;
    const [clarification] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, command('APPROVE_ACTION', (await caseOf(tenantId, caseId)).revision, { intentId: clarification!.id }));
    expect(sent).toHaveLength(1);

    await commands.execute(approver(tenantId), caseId, command('REPLAN', (await caseOf(tenantId, caseId)).revision, {}));

    const revisions = await store.listRevisions(tenantId, caseId);
    expect(revisions.map((r) => [r.revision, r.status])).toEqual([[1, 'SUPERSEDED'], [2, 'ACTIVE']]);
    expect(revisions[1]!.diffFromParent).toMatchObject({ removed: [] });
    expect((revisions[1]!.diffFromParent as { kept: string[] }).kept).toEqual(expect.arrayContaining(['ask', 'interpret']));
    expect(await nodeState(tenantId, caseId, 'ask')).toBe('SUCCEEDED');
    expect(sent).toHaveLength(1);
    expect((await ledger.get(tenantId, clarification!.id)).status).toBe('CONFIRMED');
  });

  it('the replan limit sends the case to review instead of looping', async () => {
    const { tenantId } = await newTenant();
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'TUER-HAUS', evidence: 'Haustür' }]);
    const caseId = (await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { content: 'Ein Angebot für eine Haustür bitte.' }))).case!.id;
    const person = approver(tenantId);
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const outcome = await commands
        .execute(person, caseId, command('REPLAN', (await caseOf(tenantId, caseId)).revision, {}))
        .then(() => 'ok')
        .catch((e: Error) => e.message);
      outcomes.push(outcome);
    }
    expect(outcomes.filter((o) => o === 'ok').length).toBeLessThanOrEqual(3);
    expect(outcomes.at(-1)).toContain('Limit');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('MANUAL_REVIEW');
  });
});
