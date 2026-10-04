import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { PERMISSIONS, triageFixtureForScenario, type CaseGraphView, type CaseNodeDetail } from '@orbit/shared';
import request from 'supertest';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CaseOrchestrationService } from '../src/process/case-orchestration.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'anna.kunde@kunde.example';

/** The read model of the interactive case orchestration (Amendment 02 §16–§18) against the real database. */
describe('Case orchestration view (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let view: CaseOrchestrationService;
  let llm: MockLLMProvider;
  let token: string;
  let tenantId: string;
  let otherTenantToken: string;
  let caseId: string;
  const tenants: string[] = [];

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function bootstrapTenant(label: string): Promise<{ tenantId: string; token: string }> {
    const suffix = randomUUID();
    const email = `admin-${suffix}@e2e-${label}.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Musterwerk ${label} ${suffix.slice(0, 6)}`, slug: `e2e-${label}-${suffix}`, adminEmail: email, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' });
    return { tenantId: tenant.id, token: login.body.accessToken as string };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    view = app.get(CaseOrchestrationService);
    llm = app.get(LLM_PROVIDER);
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockResolvedValue({ providerMessageId: 'gm-view-1', threadId: 'thr-v', rfcMessageId: '<sent-v@mail.example>', from: 'firma@e2e.example', executionMode: 'SIMULATED' });

    ({ tenantId, token } = await bootstrapTenant('view'));
    ({ token: otherTenantToken } = await bootstrapTenant('other'));
    await prisma.forTenantId(tenantId).integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    await app.get(ReferenceProcessService).loadFixture(tenantId, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenantId, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenantId, 'u1', blueprint.key, blueprint.version);

    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_extracted_facts', input: { facts: [{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'Fenster', confidence: 0.9 }] } }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    const event: NormalizedIntakeEvent = {
      tenantId,
      channel: 'SIMULATED',
      provider: 'simulated',
      externalEventId: randomUUID(),
      occurredAt: new Date(),
      sender: { address: SENDER },
      recipients: [{ address: 'info@musterwerk.example' }],
      subject: 'Anfrage Fenster',
      content: 'Wir hätten gern ein Angebot für Fenster.',
      threadId: 'thr-v',
      rfcMessageId: '<v1@kunde.example>',
      direction: 'INBOUND',
    };
    caseId = (await intake.handleIntakeEvent(tenantId, undefined, event)).case!.id;
  });

  afterAll(async () => {
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } }));
    await app.close();
  });

  it('projects the graph from persisted state: states with labels, edges with disposition, current step, revisions', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration`).set(auth()).expect(200);
    const graph = res.body as CaseGraphView;

    expect(graph).toMatchObject({ caseId, mode: 'COMBINED', overallStatus: 'WAITING_FOR_APPROVAL', planRevision: 1, blueprint: { key: 'REQUEST_FOR_QUOTE', title: 'Angebotsanfrage' } });
    expect(graph.revisions).toHaveLength(1);
    const state = (id: string) => graph.nodes.find((n) => n.id === id)?.state;
    expect(state('interpret')).toBe('SUCCEEDED');
    expect(state('extract')).toBe('SUCCEEDED');
    expect(state('ask')).toBe('AWAITING_APPROVAL');
    expect(state('wait')).toBe('PLANNED');
    expect(state('deliver')).toBe('PLANNED');
    expect(graph.currentNodeIds).toEqual(['ask']);
    // Every executed node says whether it was real or simulated.
    expect(graph.nodes.find((n) => n.id === 'extract')?.executionMode).toBe('SIMULATED'); // mock model
    expect(graph.nodes.find((n) => n.id === 'context')?.executionMode).toBe('LIVE');
    const taken = graph.edges.find((e) => e.source === 'context' && e.target === 'extract');
    expect(taken?.disposition).toBe('TAKEN');
    expect(graph.edges.find((e) => e.source === 'ask' && e.target === 'wait')?.disposition).toBe('POSSIBLE');
    expect(graph.lastEventSequence).toBeGreaterThan(0);
  });

  it('offers only actions the server accepts: approve / reject on the waiting step, bound to the case revision', async () => {
    const graph = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration`).set(auth()).expect(200)).body as CaseGraphView;
    const ask = graph.nodes.find((n) => n.id === 'ask')!;
    const keys = ask.availableActions.map((a) => a.commandKey);
    expect(keys).toEqual(['APPROVE_ACTION', 'REJECT_ACTION']);
    for (const action of ask.availableActions) expect(action.expectedCaseRevision).toBe(graph.caseRevision);
    expect(ask.availableActions[0]).toMatchObject({ title: 'Rückfrage freigeben & senden', requiresPreview: true });
    expect(graph.availableActions.map((a) => a.commandKey)).toEqual(expect.arrayContaining(['PAUSE', 'REPLAN', 'CANCEL', 'ADD_FACTS']));
    // Editing the draft is offered on the step that produced it.
    expect(graph.nodes.find((n) => n.id === 'ask_draft')!.availableActions.map((a) => a.commandKey)).toEqual(['EDIT_DRAFT']);
  });

  it('a viewer without approval or management permission sees the graph but no action', async () => {
    const readOnly = { tenantId, permissions: [PERMISSIONS.CASE_READ] };
    const graph = await view.projection(readOnly, caseId);
    expect(graph.nodes.flatMap((n) => n.availableActions)).toEqual([]);
    expect(graph.availableActions).toEqual([]);
    const approverOnly = await view.projection({ tenantId, permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE] }, caseId);
    expect(approverOnly.nodes.find((n) => n.id === 'ask')!.availableActions).toEqual([]); // may edit/manage, may not decide
  });

  it('node details explain the state and show what a person must see before approving: recipient, text, nothing sent yet', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration/nodes/ask`).set(auth()).expect(200);
    const detail = res.body as CaseNodeDetail;
    expect(detail).toMatchObject({ nodeId: 'ask', state: 'AWAITING_APPROVAL', capability: { key: 'email.send', sideEffect: 'EXTERNAL_WRITE' } });
    expect(detail.stateExplanation).toContain('nichts versendet');
    expect(detail.action).toMatchObject({ status: 'AWAITING_APPROVAL', purpose: 'CLARIFICATION' });
    expect(detail.action?.receipts).toEqual([]);
    expect(detail.preview).toMatchObject({ kind: 'COMMUNICATION', recipient: SENDER });
    expect(detail.preview?.bodyText).toContain('Welche Menge benötigen Sie?');

    const extract = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration/nodes/extract`).set(auth()).expect(200)).body as CaseNodeDetail;
    expect(extract.facts.find((f) => f.key === 'request.product_sku')).toMatchObject({ status: 'CONFIRMED', sourceType: 'EMAIL', evidence: ['Fenster'] });
  });

  it('commands from the view work end to end and the view follows: approve → waiting, stale revision → 409', async () => {
    const graph = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration`).set(auth()).expect(200)).body as CaseGraphView;
    const approve = graph.nodes.find((n) => n.id === 'ask')!.availableActions[0]!;
    const body = { commandId: randomUUID(), type: approve.commandKey, expectedCaseRevision: approve.expectedCaseRevision, payload: approve.payload };

    await request(app.getHttpServer()).post(`/api/v1/cases/${caseId}/commands`).set(auth()).send({ ...body, commandId: randomUUID(), expectedCaseRevision: approve.expectedCaseRevision - 1 }).expect(409);
    const ok = await request(app.getHttpServer()).post(`/api/v1/cases/${caseId}/commands`).set(auth()).send(body).expect(200);
    expect(ok.body).toMatchObject({ status: 'ACCEPTED', replayed: false });
    // Same command id again: no second execution.
    const replay = await request(app.getHttpServer()).post(`/api/v1/cases/${caseId}/commands`).set(auth()).send(body).expect(200);
    expect(replay.body).toMatchObject({ replayed: true });

    const after = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration`).set(auth()).expect(200)).body as CaseGraphView;
    expect(after.overallStatus).toBe('WAITING_FOR_INFORMATION');
    expect(after.nodes.find((n) => n.id === 'ask')).toMatchObject({ state: 'SUCCEEDED', executionMode: 'SIMULATED' });
    expect(after.nodes.find((n) => n.id === 'wait')?.state).toBe('WAITING');
    expect(after.lastEventSequence).toBeGreaterThan(graph.lastEventSequence);
    const send = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration/nodes/ask`).set(auth()).expect(200)).body as CaseNodeDetail;
    expect(send.action?.receipts[0]).toMatchObject({ status: 'CONFIRMED', providerRef: 'gm-view-1', executionMode: 'SIMULATED' });
  });

  it('definition and actual layers: the blueprint graph is always planned; the actual layer only holds what happened', async () => {
    const definition = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration?mode=DEFINITION`).set(auth()).expect(200)).body as CaseGraphView;
    expect(definition.nodes.every((n) => n.state === 'PLANNED' && n.provenance === 'BLUEPRINT')).toBe(true);
    expect(definition.nodes.length).toBeGreaterThan(10);
    const actual = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration?mode=ACTUAL`).set(auth()).expect(200)).body as CaseGraphView;
    expect(actual.nodes.every((n) => n.state !== 'PLANNED')).toBe(true);
    expect(actual.nodes.map((n) => n.id)).toContain('ask');
    expect(actual.nodes.map((n) => n.id)).not.toContain('deliver');
  });

  it('Sonde gets the case, step and revision as server-validated, read-only context (and none for a case the user may not read)', async () => {
    const conversation = await request(app.getHttpServer()).post('/api/v1/copilot/conversations').set(auth()).send({ title: 'Kontext' }).expect(201);
    const send = async (context: Record<string, unknown>, bearer = token) => {
      llm.seedResponse({ text: 'Antwort', toolCalls: [], stopReason: 'end_turn' });
      await request(app.getHttpServer()).post(`/api/v1/copilot/conversations/${conversation.body.id}/messages`).set(auth(bearer)).send({ content: 'Warum wartet dieser Fall?', context }).expect(201);
      return llm.getRequests().at(-1)!.systemPrompt ?? '';
    };

    const withContext = await send({ caseId, nodeId: 'ask' });
    expect(withContext).toContain('Vorgangs-Kontext');
    expect(withContext).toContain('Rückfrage senden');
    expect(withContext).toContain('Ausgewählter Schritt');
    expect(withContext).toContain(SENDER);
    expect(withContext).toContain('Führe keine Freigabe');

    // A foreign case id: no context block, no error detail leaks.
    const foreign = await send({ caseId: randomUUID() });
    expect(foreign).not.toContain('Vorgangs-Kontext');
    // The other tenant's user cannot get this tenant's case as context either.
    const otherConversation = await request(app.getHttpServer()).post('/api/v1/copilot/conversations').set(auth(otherTenantToken)).send({ title: 'Fremd' }).expect(201);
    llm.seedResponse({ text: 'Antwort', toolCalls: [], stopReason: 'end_turn' });
    await request(app.getHttpServer()).post(`/api/v1/copilot/conversations/${otherConversation.body.id}/messages`).set(auth(otherTenantToken)).send({ content: 'Was ist hier los?', context: { caseId } }).expect(201);
    expect(llm.getRequests().at(-1)!.systemPrompt ?? '').not.toContain('Vorgangs-Kontext');
    // Malformed context is rejected by validation.
    await request(app.getHttpServer()).post(`/api/v1/copilot/conversations/${conversation.body.id}/messages`).set(auth()).send({ content: 'x', context: { caseId: 'kein-uuid' } }).expect(400);
  });

  it('is tenant-bound: another tenant gets 404 for graph, node, events and stream; an unknown node is 404', async () => {
    for (const path of [`/orchestration`, `/orchestration/nodes/ask`, `/events`, `/events/stream`]) {
      await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}${path}`).set(auth(otherTenantToken)).expect(404);
    }
    await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration/nodes/nope`).set(auth()).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/orchestration`).expect(401);
  });

  it('serves events in order with a cursor, and the SSE stream resumes exactly after the last seen sequence', async () => {
    const all = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/events?after=0&limit=500`).set(auth()).expect(200)).body as Array<{ sequence: number; type: string }>;
    expect(all.map((e) => e.sequence)).toEqual(all.map((_, i) => i + 1));
    const cursor = all[Math.floor(all.length / 2)]!.sequence;
    const rest = (await request(app.getHttpServer()).get(`/api/v1/cases/${caseId}/events?after=${cursor}`).set(auth()).expect(200)).body as Array<{ sequence: number }>;
    expect(rest[0]!.sequence).toBe(cursor + 1);

    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const received: Array<{ id: number; type: string }> = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ port, path: `/api/v1/cases/${caseId}/events/stream?after=${cursor}`, headers: { ...auth(), Accept: 'text/event-stream' } }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          for (const block of buffer.split('\n\n').slice(0, -1)) {
            const id = /^id: (\d+)$/m.exec(block);
            const type = /^data: (.*)$/m.exec(block);
            if (id && type) received.push({ id: Number(id[1]), type: (JSON.parse(type[1]!) as { type: string }).type });
          }
          buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
          if (received.length >= rest.length) {
            req.destroy();
            resolve();
          }
        });
      });
      req.on('error', (error) => (received.length >= rest.length ? resolve() : reject(error)));
      setTimeout(() => reject(new Error('stream timed out')), 8000);
    });
    expect(received.map((e) => e.id)).toEqual(rest.map((e) => e.sequence));
    expect(received[0]!.id).toBeGreaterThan(cursor);
  });
});
