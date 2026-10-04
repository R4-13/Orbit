import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, type INestApplication } from '@nestjs/common';
import { MockLLMProvider, ToolOutcomeUnknownError, type ToolRegistry } from '@orbit/agent-core';
import { PERMISSIONS, type CapabilityDefinition, type Permission } from '@orbit/shared';
import { z } from 'zod';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../src/agent/agent.tokens';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActionLedgerService } from '../src/process/action-ledger.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CapabilityRegistryService } from '../src/process/capability-registry.service';
import { CaseCommandsService, type CommandActor } from '../src/process/case-commands.service';
import { CaseEventsService } from '../src/process/case-events.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ProcessSweepService } from '../src/process/process-sweep.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * The generic process engine against the real database. The process "domain" here is a throw-away fixture (capabilities
 * `fx.*`, tools `fx_*`, two blueprints for two tenants) registered at runtime — none of it exists in engine code, which
 * is the point (Amendment 02 §0.2 / BP-04 / BP-29: new process and new tenant without a core change).
 */
describe('Process orchestration engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let blueprints: BlueprintRegistryService;
  let orchestrator: OrchestratorService;
  let commands: CaseCommandsService;
  let facts: CaseFactsService;
  let ledger: ActionLedgerService;
  let store: PlanStoreService;
  let events: CaseEventsService;
  let capabilities: CapabilityRegistryService;
  let tenantsService: TenantsService;
  let llm: MockLLMProvider;
  const tenants: string[] = [];

  const calls = { notify: 0, lookup: 0, unsure: 0 };
  let unsureBehaviour: 'UNKNOWN' | 'OK' = 'UNKNOWN';

  const fxCapabilities: CapabilityDefinition[] = [
    {
      key: 'fx.notify',
      version: '1.0.0',
      description: 'Fixture: sendet eine Mitteilung an einen verifizierten Empfänger.',
      inputSchemaRef: 'schema/fx-notify/1',
      outputSchemaRef: 'schema/fx-notify-result/1',
      permissionKeys: ['email.send'],
      policyAction: 'email.send.clarification',
      policyActionByPurpose: { CLARIFICATION: 'email.send.clarification' },
      sideEffect: 'EXTERNAL_WRITE',
      riskClass: 'HIGH',
      toolBindings: ['fx_notify'],
      idempotencyStrategy: 'PAYLOAD_HASH',
      confirmationStrategy: 'PROVIDER_RECEIPT',
      timeoutMs: 5000,
      retryPolicyRef: 'external-write',
    },
    {
      key: 'fx.lookup',
      version: '1.0.0',
      description: 'Fixture: liest einen Wert.',
      inputSchemaRef: 'schema/fx-lookup/1',
      outputSchemaRef: 'schema/fx-lookup-result/1',
      permissionKeys: ['case.read'],
      policyAction: 'context.lookup',
      sideEffect: 'NONE',
      riskClass: 'LOW',
      toolBindings: ['fx_lookup'],
      idempotencyStrategy: 'NONE',
      confirmationStrategy: 'NONE',
      timeoutMs: 5000,
      retryPolicyRef: 'read-default',
    },
    {
      key: 'fx.unsure',
      version: '1.0.0',
      description: 'Fixture: externe Wirkung mit ungewissem Ergebnis.',
      inputSchemaRef: 'schema/fx-unsure/1',
      outputSchemaRef: 'schema/fx-unsure-result/1',
      permissionKeys: ['email.send'],
      policyAction: 'email.send.clarification',
      policyActionByPurpose: { CLARIFICATION: 'email.send.clarification' },
      sideEffect: 'EXTERNAL_WRITE',
      riskClass: 'HIGH',
      toolBindings: ['fx_unsure'],
      idempotencyStrategy: 'PAYLOAD_HASH',
      confirmationStrategy: 'PROVIDER_RECEIPT',
      timeoutMs: 5000,
      retryPolicyRef: 'external-write',
    },
  ];

  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, ...extra });
  const edge = (id: string, source: string, target: string) => ({ id, source, target });

  /** Tenant A: ask for missing detail (approval-bound), wait for the answer, look it up, complete. */
  const requestBlueprint = (version = '1.0.0') => ({
    schemaVersion: '1.0',
    key: 'FX_REQUEST',
    version,
    title: 'Fixture-Anfrage',
    goals: ['request.handled'],
    triggers: [{ type: 'communication.received' }],
    intentHints: ['FX_REQUEST'],
    requiredFacts: [
      { key: 'contact.email', type: 'email' },
      { key: 'request.detail', type: 'string' },
    ],
    allowedCapabilities: ['fx.notify', 'fx.lookup'],
    planMode: 'FIXED',
    referenceGraph: {
      nodes: [
        node('interpret', 'INTERPRET'),
        node('eval', 'EVALUATE_REQUIREMENTS'),
        node('ask', 'ACTION', { capability: { key: 'fx.notify' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'contact.email' }, text: { literal: 'Bitte nennen Sie Details.' } }, preconditions: [{ not: { requirementSatisfied: 'request.detail' } }] }),
        node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 48 }, preconditions: [{ not: { requirementSatisfied: 'request.detail' } }] }),
        node('lookup', 'ACTION', { capability: { key: 'fx.lookup' }, inputs: { key: { fact: 'request.detail' } } }),
        node('done', 'COMPLETE'),
      ],
      edges: [edge('e1', 'interpret', 'eval'), edge('e2', 'eval', 'ask'), edge('e3', 'ask', 'wait'), edge('e4', 'wait', 'lookup'), edge('e5', 'eval', 'lookup'), edge('e6', 'lookup', 'done')],
    },
    completionCriteria: { all: [{ requirementSatisfied: 'request.detail' }, { exists: { stepOutput: { node: 'lookup', path: 'found' } } }] },
  });

  /** Tenant B: a different process with a different capability — same engine. */
  const unsureBlueprint = {
    schemaVersion: '1.0',
    key: 'FX_UNSURE_PROCESS',
    version: '1.0.0',
    title: 'Fixture-Ungewiss',
    goals: ['notice.sent'],
    triggers: [{ type: 'communication.received' }],
    intentHints: ['FX_UNSURE'],
    requiredFacts: [{ key: 'contact.email', type: 'email' }],
    allowedCapabilities: ['fx.unsure'],
    planMode: 'FIXED',
    referenceGraph: {
      nodes: [node('interpret', 'INTERPRET'), node('send', 'ACTION', { capability: { key: 'fx.unsure' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'contact.email' } } }), node('done', 'COMPLETE')],
      edges: [edge('e1', 'interpret', 'send'), edge('e2', 'send', 'done')],
    },
    completionCriteria: { receiptConfirmed: { purpose: 'CLARIFICATION' } },
  };

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({
      name: `E2E Orchestration ${suffix}`,
      slug: `e2e-orch-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-orch.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenants.push(tenant.id);
    return tenant.id;
  }

  async function publish(tenantId: string, definition: { key: string; version: string }): Promise<void> {
    await blueprints.importDraft(tenantId, 'u1', definition);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', definition.key, definition.version, to);
    await blueprints.activate(tenantId, 'u1', definition.key, definition.version);
  }

  async function newCase(tenantId: string, title = 'Fixture-Fall') {
    return prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'GENERAL', title } });
  }

  const actor = (tenantId: string, permissions: Permission[] = [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE, PERMISSIONS.APPROVAL_DECIDE]): CommandActor => ({ id: randomUUID(), tenantId, permissions });
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const nodeState = async (tenantId: string, caseId: string, key: string) => (await store.getActive(tenantId, caseId))?.nodes.find((n) => n.nodeKey === key)?.state;
  const cmd = (type: string, revision: number, payload: Record<string, unknown> = {}) => ({ commandId: randomUUID(), type, expectedCaseRevision: revision, payload });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    blueprints = app.get(BlueprintRegistryService);
    orchestrator = app.get(OrchestratorService);
    commands = app.get(CaseCommandsService);
    facts = app.get(CaseFactsService);
    ledger = app.get(ActionLedgerService);
    store = app.get(PlanStoreService);
    events = app.get(CaseEventsService);
    capabilities = app.get(CapabilityRegistryService);
    tenantsService = app.get(TenantsService);
    llm = app.get(LLM_PROVIDER);

    const registry: ToolRegistry = app.get(TOOL_REGISTRY);
    registry.register({
      name: 'fx_notify',
      description: 'fixture',
      inputSchema: z.object({ to: z.string(), text: z.string().optional(), purpose: z.string().optional() }),
      policyAction: 'email.send.clarification',
      execute: async () => {
        calls.notify += 1;
        return { sent: true, providerRef: `prov-${calls.notify}`, executionMode: 'SIMULATED' };
      },
    });
    registry.register({
      name: 'fx_lookup',
      description: 'fixture',
      inputSchema: z.object({ key: z.string() }),
      policyAction: 'context.lookup',
      execute: async (input: { key: string }) => {
        calls.lookup += 1;
        return { found: true, echo: input.key, executionMode: 'LIVE' };
      },
    });
    registry.register({
      name: 'fx_unsure',
      description: 'fixture',
      inputSchema: z.object({ to: z.string(), purpose: z.string().optional() }),
      policyAction: 'email.send.clarification',
      execute: async () => {
        calls.unsure += 1;
        if (unsureBehaviour === 'UNKNOWN') throw new ToolOutcomeUnknownError('Timeout nach Übergabe an den Anbieter.');
        return { sent: true, providerRef: 'prov-unsure', executionMode: 'SIMULATED' };
      },
    });
    for (const capability of fxCapabilities) capabilities.register(capability);
  });

  afterAll(async () => {
    for (const tenantId of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    for (const capability of fxCapabilities) capabilities.unregister(capability.key);
    await app.close();
  });

  describe('blueprint registry (§8)', () => {
    it('rejects an invalid blueprint with precise findings and never stores it', async () => {
      const tenantId = await newTenant();
      const invalid = { ...requestBlueprint(), allowedCapabilities: ['fx.notify', 'payment.execute'], extra: 'x' };
      const result = blueprints.validate(invalid);
      expect(result.valid).toBe(false);
      await expect(blueprints.importDraft(tenantId, 'u1', invalid)).rejects.toThrow();
      expect(await prisma.forTenantId(tenantId).processBlueprint.count()).toBe(0);
    });

    it('walks the lifecycle, makes a published version immutable and activates it per tenant', async () => {
      const tenantId = await newTenant();
      const { row, validation } = await blueprints.importDraft(tenantId, 'u1', requestBlueprint());
      expect(validation.valid).toBe(true);
      expect(row.status).toBe('DRAFT');
      await expect(blueprints.transition(tenantId, 'u1', 'FX_REQUEST', '1.0.0', 'PUBLISHED')).rejects.toBeInstanceOf(ConflictException);
      expect(await blueprints.getActive(tenantId, 'FX_REQUEST')).toBeNull();

      for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', 'FX_REQUEST', '1.0.0', to);
      await expect(blueprints.importDraft(tenantId, 'u1', { ...requestBlueprint(), title: 'Anders' })).rejects.toBeInstanceOf(ConflictException);
      await blueprints.activate(tenantId, 'u1', 'FX_REQUEST', '1.0.0');
      expect((await blueprints.getActive(tenantId, 'FX_REQUEST'))?.row.version).toBe('1.0.0');

      // A tampered stored definition is detected before use.
      await prisma.withRlsBypass((tx) => tx.processBlueprint.update({ where: { id: row.id }, data: { definition: { ...(row.definition as object), title: 'Manipuliert' } } }));
      await expect(blueprints.getActive(tenantId, 'FX_REQUEST')).rejects.toBeInstanceOf(ConflictException);
    });

    it('suspending a blueprint stops it from starting cases; another tenant never sees it', async () => {
      const tenantA = await newTenant();
      const tenantB = await newTenant();
      await publish(tenantA, requestBlueprint());
      expect(await blueprints.findActiveForIntent(tenantA, 'FX_REQUEST')).not.toBeNull();
      expect(await blueprints.findActiveForIntent(tenantB, 'FX_REQUEST')).toBeNull();
      await blueprints.transition(tenantA, 'u1', 'FX_REQUEST', '1.0.0', 'SUSPENDED');
      expect(await blueprints.getActive(tenantA, 'FX_REQUEST')).toBeNull();
    });
  });

  describe('reference-style run on the generic engine', () => {
    it('plans, waits for approval, executes once, waits for the reply, resumes and completes with evidence', async () => {
      const tenantId = await newTenant();
      await publish(tenantId, requestBlueprint());
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'contact.email', value: 'kunde@kunde.example', valueType: 'email' });

      const start = await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_REQUEST' });
      expect(start.outcome).toBe('RUNNING');
      await orchestrator.advance(tenantId, c.id);

      // The outbound question is policy-bound (email.send.clarification = REQUIRE_APPROVAL): prepared, not sent.
      expect(await nodeState(tenantId, c.id, 'ask')).toBe('AWAITING_APPROVAL');
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
      expect(calls.notify).toBe(0);
      const [intent] = await ledger.openIntents(tenantId, c.id);
      expect(intent).toMatchObject({ status: 'AWAITING_APPROVAL', capabilityKey: 'fx.notify', purpose: 'CLARIFICATION' });
      const approval = await prisma.forTenantId(tenantId).approval.findFirstOrThrow({ where: { entityId: intent!.id } });
      expect(approval).toMatchObject({ entityType: 'PROCESS_ACTION', status: 'PENDING', policyAction: 'email.send.clarification' });

      // A stale view cannot approve.
      const revision = (await caseOf(tenantId, c.id)).revision;
      const approver = actor(tenantId);
      await expect(commands.execute(approver, c.id, cmd('APPROVE_ACTION', revision - 1, { intentId: intent!.id }))).rejects.toBeInstanceOf(ConflictException);
      expect(calls.notify).toBe(0);

      // A person without the approval permission cannot approve either.
      const clerk = actor(tenantId, [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE]);
      await expect(commands.execute(clerk, c.id, cmd('APPROVE_ACTION', revision, { intentId: intent!.id }))).rejects.toBeInstanceOf(ForbiddenException);

      const approve = cmd('APPROVE_ACTION', revision, { intentId: intent!.id });
      const accepted = await commands.execute(approver, c.id, approve);
      expect(accepted).toMatchObject({ status: 'ACCEPTED', replayed: false });
      expect(calls.notify).toBe(1);
      expect(await nodeState(tenantId, c.id, 'ask')).toBe('SUCCEEDED');
      expect(await nodeState(tenantId, c.id, 'wait')).toBe('WAITING');
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
      const [receipt] = await ledger.receipts(tenantId, intent!.id);
      expect(receipt).toMatchObject({ status: 'CONFIRMED', providerRef: 'prov-1', executionMode: 'SIMULATED' });
      expect(await prisma.forTenantId(tenantId).approval.findFirstOrThrow({ where: { entityId: intent!.id } })).toMatchObject({ status: 'APPROVED' });

      // Replaying the same command, and advancing concurrently, never sends a second time.
      expect(await commands.execute(approver, c.id, approve)).toMatchObject({ replayed: true });
      await Promise.all([orchestrator.advance(tenantId, c.id), orchestrator.advance(tenantId, c.id), orchestrator.advance(tenantId, c.id)]);
      expect(calls.notify).toBe(1);

      // The answer arrives (twice — the second delivery is a duplicate), supplies the fact and resumes the case.
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'request.detail', value: 'Es geht um 12 Fenster', valueType: 'string' });
      const first = await orchestrator.receiveInbound(tenantId, c.id, { type: 'communication.received', payload: { emailMessageId: 'm-1' }, dedupeKey: 'inbound:m-1' });
      const second = await orchestrator.receiveInbound(tenantId, c.id, { type: 'communication.received', payload: { emailMessageId: 'm-1' }, dedupeKey: 'inbound:m-1' });
      expect(first).toEqual({ accepted: true, duplicate: false });
      expect(second).toEqual({ accepted: false, duplicate: true });
      await orchestrator.advance(tenantId, c.id);

      expect(calls.lookup).toBe(1);
      const finished = await caseOf(tenantId, c.id);
      expect(finished.orchestrationStatus).toBe('COMPLETED');
      expect(finished.status).toBe('DONE');
      expect(finished.outcome).toMatchObject({ code: 'COMPLETION_CRITERIA_MET' });
      expect((finished.outcome as { evidenceRefs: string[] }).evidenceRefs.join()).toContain('fx.notify/CLARIFICATION:prov-1');
      expect(await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: c.id } })).toMatchObject({ status: 'SATISFIED' });

      // The event log is complete and strictly ordered per case.
      const log = await events.list(tenantId, c.id, 0, 500);
      expect(log.map((e) => e.sequence)).toEqual(log.map((_, i) => i + 1));
      const types = log.map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['plan.created', 'plan.activated', 'action.prepared', 'action.confirmed', 'wait.started', 'wait.satisfied', 'case.completed', 'command.accepted']));
      expect(log.filter((e) => e.type === 'communication.received')).toHaveLength(1);
    });

    it('skips the clarification entirely when the information is already there, and still completes with evidence', async () => {
      const tenantId = await newTenant();
      await publish(tenantId, requestBlueprint());
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'contact.email', value: 'kunde@kunde.example', valueType: 'email' });
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'request.detail', value: 'Alles angegeben', valueType: 'string' });
      const before = calls.notify;

      await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_REQUEST' });
      await orchestrator.advance(tenantId, c.id);

      expect(calls.notify).toBe(before);
      expect(await nodeState(tenantId, c.id, 'ask')).toBe('SKIPPED');
      expect(await nodeState(tenantId, c.id, 'wait')).toBe('SKIPPED');
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('COMPLETED');
    });

    it('never completes when the completion criteria are not met (no hollow success)', async () => {
      const tenantId = await newTenant();
      const bp = requestBlueprint('1.1.0');
      // A graph that reaches COMPLETE without the detail ever arriving.
      bp.referenceGraph.nodes = [node('interpret', 'INTERPRET'), node('done', 'COMPLETE')];
      bp.referenceGraph.edges = [edge('e1', 'interpret', 'done')];
      await publish(tenantId, bp);
      const c = await newCase(tenantId);
      await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_REQUEST' });
      await orchestrator.advance(tenantId, c.id);

      const row = await caseOf(tenantId, c.id);
      expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
      expect(row.completedAt).toBeNull();
      expect(row.attentionReasons.join()).toContain('Abschlusskriterien');
      expect(await nodeState(tenantId, c.id, 'done')).toBe('BLOCKED');
    });

    it('a rejected approval ends the step visibly instead of being retried silently', async () => {
      const tenantId = await newTenant();
      await publish(tenantId, requestBlueprint());
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'contact.email', value: 'kunde@kunde.example', valueType: 'email' });
      await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_REQUEST' });
      await orchestrator.advance(tenantId, c.id);
      const [intent] = await ledger.openIntents(tenantId, c.id);
      const before = calls.notify;

      await commands.execute(actor(tenantId), c.id, cmd('REJECT_ACTION', (await caseOf(tenantId, c.id)).revision, { intentId: intent!.id, reason: 'Nicht gewünscht' }));

      expect(calls.notify).toBe(before);
      expect(await nodeState(tenantId, c.id, 'ask')).toBe('FAILED');
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('MANUAL_REVIEW');
      expect((await ledger.get(tenantId, intent!.id)).status).toBe('CANCELLED');
    });
  });

  describe('uncertain outcomes (§15.2) — second tenant, second blueprint, same engine', () => {
    it('stops on OUTCOME_UNKNOWN, never re-sends, and continues only after reconciliation', async () => {
      const tenantId = await newTenant();
      await prisma.forTenantId(tenantId).policyConfig.updateMany({ where: { action: 'email.send.clarification' }, data: { mode: 'AUTONOMOUS' } });
      await publish(tenantId, unsureBlueprint);
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'contact.email', value: 'kunde@kunde.example', valueType: 'email' });
      unsureBehaviour = 'UNKNOWN';
      const before = calls.unsure;

      await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_UNSURE_PROCESS' });
      await orchestrator.advance(tenantId, c.id);

      expect(calls.unsure).toBe(before + 1);
      expect(await nodeState(tenantId, c.id, 'send')).toBe('OUTCOME_UNKNOWN');
      const [intent] = await ledger.openIntents(tenantId, c.id);
      expect(intent).toMatchObject({ status: 'OUTCOME_UNKNOWN' });
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('MANUAL_REVIEW');

      // Advancing again — even many times — must not repeat the possibly-happened effect.
      await orchestrator.advance(tenantId, c.id);
      await orchestrator.advance(tenantId, c.id);
      expect(calls.unsure).toBe(before + 1);

      // A blind retry is refused; reconciling "did not happen" legitimizes a new attempt.
      const person = actor(tenantId);
      await expect(commands.execute(person, c.id, cmd('RETRY_STEP', (await caseOf(tenantId, c.id)).revision, { stepRunId: 'send' }))).rejects.toThrow();
      await commands.execute(person, c.id, cmd('RECONCILE_ACTION', (await caseOf(tenantId, c.id)).revision, { intentId: intent!.id, happened: false, note: 'Nicht im Postfach' }));
      expect(await nodeState(tenantId, c.id, 'send')).toBe('FAILED');

      unsureBehaviour = 'OK';
      await commands.execute(person, c.id, cmd('RETRY_STEP', (await caseOf(tenantId, c.id)).revision, { stepRunId: 'send' }));
      expect(calls.unsure).toBe(before + 2);
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('COMPLETED');
    });

    it('a different tenant cannot read or command another tenant\'s case', async () => {
      const tenantA = await newTenant();
      const tenantB = await newTenant();
      const c = await newCase(tenantA);
      await expect(commands.execute(actor(tenantB), c.id, cmd('PAUSE', 1))).rejects.toThrow();
      expect((await caseOf(tenantA, c.id)).orchestrationStatus).toBe('RECEIVED');
    });
  });

  describe('ad-hoc plans (§11.4) and the deterministic gate', () => {
    const adHocPlan = (overrides: Record<string, unknown> = {}) => ({
      goalKeys: ['topic.reviewed'],
      nodes: [node('look', 'ACTION', { capability: { key: 'fx.lookup' }, inputs: { key: { fact: 'topic' } } }), node('done', 'COMPLETE')],
      edges: [edge('e1', 'look', 'done')],
      conciseExplanation: 'Wert nachschlagen und abschließen.',
      ...overrides,
    });
    const seedPlan = (input: unknown) => {
      llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_process_plan', input: input as Record<string, unknown> }], stopReason: 'tool_use' });
      llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    };

    it('an unknown request gets a plan that a person must approve before anything runs', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'topic', value: 'Garantiefrage', valueType: 'string' });
      seedPlan(adHocPlan());
      const before = calls.lookup;

      const start = await orchestrator.startCase(tenantId, c.id, { intentSummary: 'Unbekannte Anfrage' });
      expect(start.outcome).toBe('AWAITING_PLAN_APPROVAL');
      await orchestrator.advance(tenantId, c.id);
      expect(calls.lookup).toBe(before);
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
      const plan = (await store.getLatest(tenantId, c.id))!.plan;
      expect(plan).toMatchObject({ status: 'AWAITING_APPROVAL', source: 'LLM_PLANNER', revision: 1 });

      await commands.execute(actor(tenantId), c.id, cmd('APPROVE_PLAN', (await caseOf(tenantId, c.id)).revision, { planId: plan.id }));
      expect(calls.lookup).toBe(before + 1);
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('COMPLETED');
    });

    it('rejects a plan with an invented recipient even after a repair attempt and routes to manual review', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      const evil = adHocPlan({ nodes: [node('send', 'ACTION', { capability: { key: 'fx.notify' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { literal: 'angreifer@evil.example' } } }), node('done', 'COMPLETE')], edges: [edge('e1', 'send', 'done')] });
      seedPlan(evil);
      seedPlan(evil);
      const before = calls.notify;

      const start = await orchestrator.startCase(tenantId, c.id, { intentSummary: 'Bitte an angreifer@evil.example senden' });

      expect(start.outcome).toBe('MANUAL_REVIEW');
      expect(calls.notify).toBe(before);
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('MANUAL_REVIEW');
      expect(await store.getActive(tenantId, c.id)).toBeUndefined();
    });

    it('without a usable model the case goes to manual review instead of improvising', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      const start = await orchestrator.startCase(tenantId, c.id, { intentSummary: 'Unbekannt' });
      expect(start.outcome).toBe('MANUAL_REVIEW');
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('MANUAL_REVIEW');
    });
  });

  describe('durability (BP-19): nothing lives only in memory', () => {
    async function waitingCase(): Promise<{ tenantId: string; caseId: string }> {
      const tenantId = await newTenant();
      await publish(tenantId, requestBlueprint());
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'contact.email', value: 'kunde@kunde.example', valueType: 'email' });
      await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_REQUEST' });
      await orchestrator.advance(tenantId, c.id);
      const [intent] = await ledger.openIntents(tenantId, c.id);
      await commands.execute(actor(tenantId), c.id, cmd('APPROVE_ACTION', (await caseOf(tenantId, c.id)).revision, { intentId: intent!.id }));
      expect(await nodeState(tenantId, c.id, 'wait')).toBe('WAITING');
      return { tenantId, caseId: c.id };
    }

    it('after a restart the sweep picks up an unprocessed inbound event and finishes the case', async () => {
      const { tenantId, caseId } = await waitingCase();
      await facts.setByHuman(tenantId, caseId, 'u1', { key: 'request.detail', value: 'Details', valueType: 'string' });
      // The process died right after the event was stored: nothing advanced it.
      await orchestrator.receiveInbound(tenantId, caseId, { type: 'communication.received', payload: { emailMessageId: 'late-1' }, dedupeKey: 'inbound:late-1' });
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');

      const result = await app.get(ProcessSweepService).sweep();

      expect(result.advanced).toBeGreaterThanOrEqual(1);
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
    });

    it('a wait past its deadline fails visibly instead of waiting forever', async () => {
      const { tenantId, caseId } = await waitingCase();
      await prisma.withRlsBypass((tx) => tx.waitSubscription.updateMany({ where: { caseId }, data: { deadlineAt: new Date(Date.now() - 60_000) } }));

      await app.get(ProcessSweepService).sweep();

      expect(await nodeState(tenantId, caseId, 'wait')).toBe('FAILED');
      const row = await caseOf(tenantId, caseId);
      expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
      expect(row.attentionReasons.join()).toContain('nicht rechtzeitig');
      expect(await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId } })).toMatchObject({ status: 'TIMED_OUT' });
    });

    it('a case left IN_PROGRESS with an expired lease (crashed worker) is taken over, and a live lease is respected', async () => {
      const { tenantId, caseId } = await waitingCase();
      await facts.setByHuman(tenantId, caseId, 'u1', { key: 'request.detail', value: 'Details', valueType: 'string' });
      await orchestrator.receiveInbound(tenantId, caseId, { type: 'communication.received', payload: { emailMessageId: 'late-2' }, dedupeKey: 'inbound:late-2' });
      // Another worker holds a live lease: this advance must not interfere.
      await prisma.withRlsBypass((tx) => tx.case.update({ where: { id: caseId }, data: { leaseOwner: 'other-worker', leaseExpiresAt: new Date(Date.now() + 60_000) } }));
      expect(await orchestrator.advance(tenantId, caseId)).toMatchObject({ status: 'LEASED_ELSEWHERE' });
      // The lease expires (the worker crashed): the next advance takes over.
      await prisma.withRlsBypass((tx) => tx.case.update({ where: { id: caseId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }));
      await orchestrator.advance(tenantId, caseId);
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
    });
  });

  describe('pause and cancel', () => {
    it('a paused case does not advance; cancelling voids open approvals and leaves nothing running', async () => {
      const tenantId = await newTenant();
      await publish(tenantId, requestBlueprint());
      const c = await newCase(tenantId);
      await facts.setByHuman(tenantId, c.id, 'u1', { key: 'contact.email', value: 'kunde@kunde.example', valueType: 'email' });
      await orchestrator.startCase(tenantId, c.id, { blueprintKey: 'FX_REQUEST' });
      await orchestrator.advance(tenantId, c.id);
      const [intent] = await ledger.openIntents(tenantId, c.id);

      const person = actor(tenantId);
      await commands.execute(person, c.id, cmd('PAUSE', (await caseOf(tenantId, c.id)).revision));
      expect(await orchestrator.advance(tenantId, c.id)).toMatchObject({ status: 'PAUSED' });

      await commands.execute(person, c.id, cmd('CANCEL', (await caseOf(tenantId, c.id)).revision));
      expect((await caseOf(tenantId, c.id)).orchestrationStatus).toBe('CANCELLED');
      expect((await ledger.get(tenantId, intent!.id)).status).toBe('CANCELLED');
      expect(await prisma.forTenantId(tenantId).approval.findFirstOrThrow({ where: { entityId: intent!.id } })).toMatchObject({ status: 'REJECTED' });
    });
  });
});
