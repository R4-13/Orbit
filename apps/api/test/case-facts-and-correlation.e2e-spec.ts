import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { IntakeService } from '../src/intake/intake.service';
import { CaseCorrelationService } from '../src/process/case-correlation.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { CaseLifecycleService } from '../src/process/case-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/** Amendment 02 §7 (facts, lifecycle) and §13.1 (case correlation) against the real database. */
describe('Case facts, lifecycle and correlation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let facts: CaseFactsService;
  let correlation: CaseCorrelationService;
  let lifecycle: CaseLifecycleService;
  let intake: IntakeService;
  let llm: MockLLMProvider;
  let tenantsService: TenantsService;
  const tenants: string[] = [];

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({
      name: `E2E Cases ${suffix}`,
      slug: `e2e-cases-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-cases.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenants.push(tenant.id);
    return tenant.id;
  }

  async function newCase(tenantId: string, title = 'Fall') {
    return prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title } });
  }

  async function newMail(
    tenantId: string,
    caseId: string | null,
    overrides: Partial<{ direction: 'INBOUND' | 'OUTBOUND'; fromAddress: string; toAddresses: string[]; threadId: string; rfcMessageId: string }> = {},
  ) {
    return prisma.forTenantId(tenantId).emailMessage.create({
      data: {
        tenantId,
        caseId,
        direction: overrides.direction ?? 'INBOUND',
        fromAddress: overrides.fromAddress ?? 'kunde@kunde.example',
        toAddresses: overrides.toAddresses ?? ['info@firma.example'],
        threadId: overrides.threadId,
        rfcMessageId: overrides.rfcMessageId,
        providerMessageId: randomUUID(),
      },
    });
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    facts = app.get(CaseFactsService);
    correlation = app.get(CaseCorrelationService);
    lifecycle = app.get(CaseLifecycleService);
    intake = app.get(IntakeService);
    llm = app.get(LLM_PROVIDER);
    tenantsService = app.get(TenantsService);
  });

  afterAll(async () => {
    for (const tenantId of tenants) {
      await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    }
    await app.close();
  });

  describe('facts (§7.2)', () => {
    it('records a candidate with provenance and bumps the case revision', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);

      const [fact] = await facts.propose(tenantId, c.id, [
        { key: 'request.product_or_service', value: 'Badsanierung', sourceType: 'EMAIL', sourceRef: 'msg-1', evidenceRefs: ['body'], confidence: 0.8 },
      ]);

      expect(fact).toMatchObject({ status: 'CANDIDATE', sourceType: 'EMAIL', sourceRef: 'msg-1', revision: 1, isCurrent: true, verifiedBy: null });
      expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: c.id } })).revision).toBe(2);
    });

    it('an equal value is a no-op; a different value next to a standing one makes BOTH conflicted — no last-mail-wins', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await facts.propose(tenantId, c.id, [{ key: 'request.quantity_or_scope', value: { count: 3 }, sourceType: 'EMAIL' }]);

      expect(await facts.propose(tenantId, c.id, [{ key: 'request.quantity_or_scope', value: { count: 3 }, sourceType: 'EMAIL' }])).toHaveLength(0);

      await facts.propose(tenantId, c.id, [{ key: 'request.quantity_or_scope', value: { count: 5 }, sourceType: 'EMAIL' }]);
      const current = (await facts.getCurrent(tenantId, c.id)).filter((f) => f.key === 'request.quantity_or_scope');
      expect(current).toHaveLength(2);
      expect(current.every((f) => f.status === 'CONFLICTED')).toBe(true);
    });

    it('a conflicted fact cannot be confirmed by schema; a person resolves it, which keeps the full history', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await facts.propose(tenantId, c.id, [{ key: 'customer.reply_address', value: 'a@kunde.example', sourceType: 'EMAIL' }]);
      const [second] = await facts.propose(tenantId, c.id, [{ key: 'customer.reply_address', value: 'b@kunde.example', sourceType: 'EMAIL' }]);

      await expect(facts.confirmBySchema(tenantId, second!.id, 'email')).rejects.toThrow(/conflict/i);

      const resolved = await facts.setByHuman(tenantId, c.id, 'user_1', { key: 'customer.reply_address', value: 'b@kunde.example', valueType: 'email' });

      expect(resolved).toMatchObject({ status: 'CONFIRMED', verifiedBy: 'user_1', sourceType: 'HUMAN', revision: 3 });
      const current = (await facts.getCurrent(tenantId, c.id)).filter((f) => f.key === 'customer.reply_address');
      expect(current).toHaveLength(1);
      const history = await facts.getHistory(tenantId, c.id, 'customer.reply_address');
      expect(history).toHaveLength(3); // nothing overwritten or deleted
      expect(history.filter((f) => f.isCurrent)).toHaveLength(1);
      expect(resolved.supersedesFactId).toBeTruthy();
    });

    it('schema confirmation refuses a value that does not satisfy its declared type, and an unknown type', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      const [bad] = await facts.propose(tenantId, c.id, [{ key: 'customer.reply_address', value: 'kein-email', sourceType: 'EMAIL' }]);

      await expect(facts.confirmBySchema(tenantId, bad!.id, 'email')).rejects.toThrow(/email|type/i);
      await expect(facts.confirmBySchema(tenantId, bad!.id, 'made_up_type')).rejects.toThrow(/Unbekannter Faktentyp/);
      expect((await prisma.forTenantId(tenantId).caseFact.findUniqueOrThrow({ where: { id: bad!.id } })).status).toBe('CANDIDATE');

      const [good] = await facts.propose(tenantId, c.id, [{ key: 'customer.contact', value: 'ok@kunde.example', sourceType: 'EMAIL' }]);
      expect(await facts.confirmBySchema(tenantId, good!.id, 'email')).toMatchObject({ status: 'CONFIRMED', verifiedBy: 'schema' });
    });

    it('a human value is validated against its type before it is accepted', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await expect(facts.setByHuman(tenantId, c.id, 'user_1', { key: 'k', value: 'x', valueType: 'money' })).rejects.toThrow(/money/);
    });

    it('an expired fact becomes STALE instead of silently staying valid; a rejected one leaves the current set but stays as history', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      const [expiring] = await facts.propose(tenantId, c.id, [{ key: 'price.unit', value: 10, sourceType: 'SYSTEM_OF_RECORD', expiresAt: new Date(Date.now() - 1000) }]);
      const [wrong] = await facts.propose(tenantId, c.id, [{ key: 'request.note', value: 'x', sourceType: 'EMAIL' }]);

      expect(await facts.markExpiredStale(tenantId, c.id)).toBe(1);
      await facts.reject(tenantId, wrong!.id, 'user_1');

      const scoped = prisma.forTenantId(tenantId);
      expect((await scoped.caseFact.findUniqueOrThrow({ where: { id: expiring!.id } })).status).toBe('STALE');
      const rejected = await scoped.caseFact.findUniqueOrThrow({ where: { id: wrong!.id } });
      expect(rejected).toMatchObject({ status: 'REJECTED', isCurrent: false });
    });

    it("tenant B can neither see nor touch tenant A's facts", async () => {
      const a = await newTenant();
      const b = await newTenant();
      const caseA = await newCase(a);
      const [fact] = await facts.propose(a, caseA.id, [{ key: 'secret', value: 'A-only', sourceType: 'EMAIL' }]);

      expect(await facts.getCurrent(b, caseA.id)).toHaveLength(0);
      await expect(facts.confirmBySchema(b, fact!.id, 'string')).rejects.toThrow(/not found/i);
    });
  });

  describe('lifecycle (§12.1)', () => {
    it('keeps the fine-grained state and the simple status consistent through the one mapping table, and audits the change', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);

      const waiting = await lifecycle.transition(tenantId, c.id, { to: 'WAITING_FOR_INFORMATION', attentionReasons: ['Menge fehlt'] }, { type: 'SYSTEM' });
      expect(waiting).toMatchObject({ orchestrationStatus: 'WAITING_FOR_INFORMATION', status: 'IN_PROGRESS', attentionReasons: ['Menge fehlt'] });

      const approval = await lifecycle.transition(tenantId, c.id, { to: 'WAITING_FOR_APPROVAL' }, { type: 'SYSTEM' });
      expect(approval).toMatchObject({ status: 'WAITING_APPROVAL', attentionReasons: [] });

      const failed = await lifecycle.transition(tenantId, c.id, { to: 'FAILED', attentionReasons: ['Tool kaputt'] }, { type: 'SYSTEM' });
      expect(failed.status).toBe('IN_PROGRESS'); // a failed case is never shown as finished

      const done = await lifecycle.transition(tenantId, c.id, { to: 'COMPLETED', outcome: { code: 'QUOTE_DELIVERED', evidenceRefs: ['receipt-1'] } }, { type: 'SYSTEM' });
      expect(done).toMatchObject({ status: 'DONE', outcome: { code: 'QUOTE_DELIVERED', evidenceRefs: ['receipt-1'] } });
      expect(done.completedAt).toBeInstanceOf(Date);
      expect(done.revision).toBe(c.revision + 4);
      expect(await prisma.forTenantId(tenantId).auditLog.count({ where: { eventType: 'CASE_STATUS_CHANGED', entityId: c.id } })).toBe(4);
    });

    it('a manual DONE by a person is recorded as MANUALLY_CLOSED, never as a verified completion', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      const cases = app.get(await import('../src/cases/cases.service').then((m) => m.CasesService));

      const closed = await cases.updateStatus(tenantId, c.id, 'user_1', 'DONE');

      expect(closed.orchestrationStatus).toBe('COMPLETED');
      expect(closed.outcome).toEqual({ code: 'MANUALLY_CLOSED', evidenceRefs: [] });
    });
  });

  describe('correlation (§13.1)', () => {
    it('matches a reply to a stored ORBIT outbound message of a case via In-Reply-To, when the sender is a participant', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await newMail(tenantId, c.id, { direction: 'INBOUND', fromAddress: 'kunde@kunde.example' });
      await newMail(tenantId, c.id, { direction: 'OUTBOUND', fromAddress: 'info@firma.example', toAddresses: ['kunde@kunde.example'], rfcMessageId: '<orbit-1@firma.example>' });
      const reply = await newMail(tenantId, null, { fromAddress: 'Kunde@Kunde.example' });

      const result = await correlation.correlate({ tenantId, emailMessageId: reply.id, inReplyTo: '<orbit-1@firma.example>', senderAddress: 'Kunde@Kunde.example' });

      expect(result).toMatchObject({ status: 'MATCHED', caseId: c.id, rule: 'IN_REPLY_TO' });
    });

    it('does NOT merge a reply from someone who is not yet a participant — the case facts would be exposed to a new party', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await newMail(tenantId, c.id, { direction: 'OUTBOUND', fromAddress: 'info@firma.example', toAddresses: ['kunde@kunde.example'], rfcMessageId: '<orbit-2@firma.example>' });
      const reply = await newMail(tenantId, null, { fromAddress: 'fremder@andere.example' });

      const result = await correlation.correlate({ tenantId, emailMessageId: reply.id, inReplyTo: '<orbit-2@firma.example>', senderAddress: 'fremder@andere.example' });

      expect(result.status).toBe('AMBIGUOUS');
      expect(result.caseId).toBeUndefined();
      expect(result.note).toContain('Teilnehmer');
    });

    it('matches by provider thread only to an OPEN case with a known participant; a completed case is not reopened by a stray thread message', async () => {
      const tenantId = await newTenant();
      const openCase = await newCase(tenantId, 'offen');
      await newMail(tenantId, openCase.id, { threadId: 'thread-open', fromAddress: 'kunde@kunde.example' });
      const closedCase = await newCase(tenantId, 'erledigt');
      await newMail(tenantId, closedCase.id, { threadId: 'thread-closed', fromAddress: 'kunde@kunde.example' });
      await lifecycle.transition(tenantId, closedCase.id, { to: 'COMPLETED', outcome: { code: 'X', evidenceRefs: [] } });

      const inOpen = await newMail(tenantId, null, { threadId: 'thread-open', fromAddress: 'kunde@kunde.example' });
      const inClosed = await newMail(tenantId, null, { threadId: 'thread-closed', fromAddress: 'kunde@kunde.example' });

      expect(await correlation.correlate({ tenantId, emailMessageId: inOpen.id, threadId: 'thread-open', senderAddress: 'kunde@kunde.example' })).toMatchObject({ status: 'MATCHED', caseId: openCase.id, rule: 'PROVIDER_THREAD' });
      expect((await correlation.correlate({ tenantId, emailMessageId: inClosed.id, threadId: 'thread-closed', senderAddress: 'kunde@kunde.example' })).status).toBe('NONE');
    });

    it('a sender with two open cases is never merged by address alone; a new subject without any strong reference is not merged either (E15/E16)', async () => {
      const tenantId = await newTenant();
      const one = await newCase(tenantId, 'Fall 1');
      const two = await newCase(tenantId, 'Fall 2');
      await newMail(tenantId, one.id, { fromAddress: 'kunde@kunde.example' });
      await newMail(tenantId, two.id, { fromAddress: 'kunde@kunde.example' });
      const incoming = await newMail(tenantId, null, { fromAddress: 'kunde@kunde.example' });

      const plain = await correlation.correlate({ tenantId, emailMessageId: incoming.id, senderAddress: 'kunde@kunde.example', semanticRelation: 'NEW' });
      expect(plain).toMatchObject({ status: 'NONE', rule: 'NONE' });

      const forwarded = await newMail(tenantId, null, { fromAddress: 'kunde@kunde.example' });
      const suggestion = await correlation.correlate({ tenantId, emailMessageId: forwarded.id, senderAddress: 'kunde@kunde.example', semanticRelation: 'CONTINUATION' });
      expect(suggestion.status).toBe('AMBIGUOUS'); // a model's guess is only ever a review hint
      expect(suggestion.rule).toBe('SEMANTIC_SUGGESTION');
      expect([...suggestion.candidateCaseIds].sort()).toEqual([one.id, two.id].sort());
      expect(suggestion.caseId).toBeUndefined();
    });

    it('two cases that match the same reference are ambiguous, never guessed', async () => {
      const tenantId = await newTenant();
      const one = await newCase(tenantId);
      const two = await newCase(tenantId);
      await newMail(tenantId, one.id, { direction: 'OUTBOUND', rfcMessageId: '<dup@firma.example>', toAddresses: ['kunde@kunde.example'] });
      await newMail(tenantId, two.id, { direction: 'OUTBOUND', rfcMessageId: '<dup@firma.example>', toAddresses: ['kunde@kunde.example'] });
      const reply = await newMail(tenantId, null);

      const result = await correlation.correlate({ tenantId, emailMessageId: reply.id, inReplyTo: '<dup@firma.example>', senderAddress: 'kunde@kunde.example' });

      expect(result.status).toBe('AMBIGUOUS');
      expect(result.candidateCaseIds).toHaveLength(2);
    });

    it('is bounded by the tenant: a reference to another tenant\'s outbound message matches nothing', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const caseA = await newCase(a);
      await newMail(a, caseA.id, { direction: 'OUTBOUND', rfcMessageId: '<tenant-a@firma.example>', toAddresses: ['kunde@kunde.example'] });
      const caseB = await newCase(b);
      const replyInB = await newMail(b, null, { fromAddress: 'kunde@kunde.example' });
      await newMail(b, caseB.id, { fromAddress: 'kunde@kunde.example' });

      const result = await correlation.correlate({ tenantId: b, emailMessageId: replyInB.id, inReplyTo: '<tenant-a@firma.example>', senderAddress: 'kunde@kunde.example' });

      expect(result.status).toBe('NONE');
    });

    it('is idempotent: a second correlation of the same message returns the stored decision', async () => {
      const tenantId = await newTenant();
      const c = await newCase(tenantId);
      await newMail(tenantId, c.id, { threadId: 'thread-x', fromAddress: 'kunde@kunde.example' });
      const incoming = await newMail(tenantId, null, { threadId: 'thread-x', fromAddress: 'kunde@kunde.example' });
      const input = { tenantId, emailMessageId: incoming.id, threadId: 'thread-x', senderAddress: 'kunde@kunde.example' };

      const first = await correlation.correlate(input);
      const second = await correlation.correlate(input);

      expect(second).toMatchObject({ status: first.status, caseId: first.caseId, rule: first.rule });
      expect(await prisma.forTenantId(tenantId).caseCorrelation.count({ where: { emailMessageId: incoming.id } })).toBe(1);
    });
  });

  describe('intake integration', () => {
    it('stores the triage goals and fact candidates (as CANDIDATES with evidence) on the new case and sets an honest state', async () => {
      const tenantId = await newTenant();
      llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'submit_triage_result',
            input: buildTriageFixture({
              businessRelevance: 'RELEVANT',
              category: 'REQUEST_FOR_QUOTE',
              proposedBusinessGoals: ['CREATE_AND_DELIVER_QUOTE'],
              intents: [{ key: 'REQUEST_FOR_QUOTE', confidence: 0.9, evidenceRefs: ['body'] }],
              confidence: { relevance: 0.95, intent: 0.9 },
              extractedFactCandidates: [{ key: 'request.product_or_service', value: 'Badsanierung', confidence: 0.8, evidenceRefs: ['body'] }],
            }) as unknown as Record<string, unknown>,
          },
        ],
        stopReason: 'tool_use',
      });

      const result = await intake.handleIntakeEvent(tenantId, undefined, {
        tenantId,
        channel: 'SIMULATED',
        provider: 'simulated',
        externalEventId: randomUUID(),
        occurredAt: new Date(),
        sender: { address: 'interessent@kunde.example' },
        recipients: [{ address: 'info@firma.example' }],
        subject: 'Anfrage Badsanierung',
        content: 'Wir benötigen ein Angebot für eine Badsanierung.',
      });

      const stored = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: result.case!.id } });
      expect(stored.businessGoals).toEqual(['CREATE_AND_DELIVER_QUOTE']);
      expect(stored.currentIntent).toBe('REQUEST_FOR_QUOTE');
      // The legacy sales workflow only created records: that is not a verified completed process, so the case stays open.
      expect(stored.orchestrationStatus).toBe('IN_PROGRESS');
      expect(stored.status).toBe('IN_PROGRESS');
      const caseFacts = await facts.getCurrent(tenantId, stored.id);
      expect(caseFacts).toHaveLength(1);
      expect(caseFacts[0]).toMatchObject({ key: 'request.product_or_service', status: 'CANDIDATE', sourceType: 'EMAIL', verifiedBy: null });
      expect(caseFacts[0]?.evidenceRefs).toEqual(['body']);
    });
  });
});
