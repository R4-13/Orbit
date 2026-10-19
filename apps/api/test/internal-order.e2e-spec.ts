import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider, ToolRegistry } from '@orbit/agent-core';
import { TOOL_REGISTRY, LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { SONDE_ACT_TOOL_NAMES } from '../src/copilot/tools/sonde.tools';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * FX-03 (Konzept Flexible Autonomie D6, Eigentümerentscheidung 19.10.): ein interner Auftrag über Sonde und ein zeitgesteuertes Ereignis laufen durch dieselbe Orchestrierung bis zu
 * einem nachgewiesenen Ergebnis – hier: die zuständige Person ist nachweislich informiert (bestätigte Wirkung `staff.notify`, Aufmerksamkeitspunkt vorhanden), der Vorgang schließt mit
 * `ADHOC_GOALS_PROVEN`. Keine Nachricht nach außen. Die Frist wird nicht abgewartet, sondern in der Datenbank in die Vergangenheit gesetzt (eigener Mandant, kein Sweep über fremde Daten).
 */
describe('Interner Auftrag über Sonde und zeitgesteuertes Ereignis (FX-03, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: ToolRegistry;
  let llm: MockLLMProvider;
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Auftrag ${suffix.slice(0, 8)}`, slug: `e2e-auftrag-${suffix}`, adminEmail: `admin-${suffix}@e2e-auftrag.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    for (const action of ['staff.notify', 'task.create']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    return tenant.id;
  }
  const order = (tenantId: string, input: Record<string, unknown>) => registry.execute('create_internal_order', input, { tenantId, agentRunId: randomUUID() }) as Promise<{ caseId: string; mode: string; status: string }>;
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    registry = app.get<ToolRegistry>(TOOL_REGISTRY);
    llm = app.get(LLM_PROVIDER);
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('Sonde kann Aufträge erteilen: das Werkzeug ist registriert und Teil der Sonde-Handlungen', () => {
    expect(registry.get('create_internal_order')).toBeDefined();
    expect(SONDE_ACT_TOOL_NAMES).toContain('create_internal_order');
    expect(registry.get('create_internal_order')!.policyAction).toBe('task.create');
  });

  it('Auftrag mit Zeitpunkt: der Vorgang wartet bis dahin, informiert dann die zuständige Person und schließt mit Nachweis – ohne jede Nachricht nach außen', async () => {
    const tenantId = await newTenant();
    const dueAt = new Date(Date.now() + 3600_000).toISOString();
    const result = await order(tenantId, { title: 'Wartung bei Meier', instruction: 'Bitte am Freitag an die Wartung der Heizung bei Meier erinnern.', dueAt });
    expect(result.mode).toBe('TIMED_REMINDER');

    // Bis zum Zeitpunkt: Wiedervorlage, nichts ist informiert, nichts abgeschlossen.
    let row = await caseOf(tenantId, result.caseId);
    expect(row.orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
    expect(row.attentionReasons.join(' ')).toMatch(/Wiedervorlage/);
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.caseId } })).toBe(0);
    const wait = await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: result.caseId } });
    expect(wait).toMatchObject({ eventType: 'time.reached', status: 'WAITING' });
    expect(wait.deadlineAt!.toISOString()).toBe(dueAt);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: result.caseId, type: 'order.created' } })).toBe(1);

    // Ein vorzeitiges Anstoßen ändert nichts.
    await app.get(OrchestratorService).advance(tenantId, result.caseId);
    expect((await caseOf(tenantId, result.caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');

    // Der Zeitpunkt ist erreicht.
    await prisma.withRlsBypass((tx) => tx.waitSubscription.updateMany({ where: { id: wait.id }, data: { deadlineAt: new Date(Date.now() - 1000) } }));
    await app.get(OrchestratorService).advance(tenantId, result.caseId);

    row = await caseOf(tenantId, result.caseId);
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(row.outcome).toMatchObject({ code: 'ADHOC_GOALS_PROVEN' });
    expect(await prisma.forTenantId(tenantId).waitSubscription.findUniqueOrThrow({ where: { id: wait.id } })).toMatchObject({ status: 'SATISFIED' });
    const items = await prisma.forTenantId(tenantId).attentionItem.findMany({ where: { caseId: result.caseId } });
    expect(items).toHaveLength(1); // Wirkung im Zielsystem: die Person wurde informiert (Aufmerksamkeitspunkt)
    expect(items[0]!.reason).toContain('Wartung bei Meier');
    expect(await prisma.forTenantId(tenantId).emailMessage.count({ where: { caseId: result.caseId } })).toBe(0);

    // Ein weiterer Durchlauf wiederholt die Meldung nicht.
    await app.get(OrchestratorService).advance(tenantId, result.caseId);
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.caseId } })).toBe(1);
  });

  it('Auftrag ohne Zeitpunkt: ORBIT plant ihn selbst (freier Plan mit dem Wortlaut des Auftrags) und erreicht das Ziel mit Nachweis', async () => {
    const tenantId = await newTenant();
    llm.seedResponse({
      toolCalls: [
        {
          toolCallId: randomUUID(),
          toolName: 'submit_process_plan',
          input: {
            goalKeys: ['staff.informed'],
            nodes: [
              { id: 'notify', type: 'ACTION', title: 'Person informieren', inputs: { message: { literal: 'Auftrag: Angebot für Müller nachfassen.' } }, config: {}, capability: { key: 'staff.notify' } },
              { id: 'done', type: 'COMPLETE', title: 'Erledigt', inputs: {}, config: {} },
            ],
            edges: [{ id: 'e1', source: 'notify', target: 'done' }],
            unresolvedRequirements: [],
            assumptions: [],
            conciseExplanation: 'Interner Auftrag: Person informieren.',
          },
        },
      ],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    const result = await order(tenantId, { title: 'Müller nachfassen', instruction: 'Angebot für Müller nachfassen.' });
    expect(result.mode).toBe('PLANNED');
    const row = await caseOf(tenantId, result.caseId);
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(row.outcome).toMatchObject({ code: 'ADHOC_GOALS_PROVEN' });
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.caseId } })).toBe(1);
  });

  it('ein Zeitpunkt zu weit in der Zukunft oder ungültig wird abgelehnt – es entsteht kein Vorgang', async () => {
    const tenantId = await newTenant();
    const far = new Date(Date.now() + 200 * 24 * 3600_000).toISOString();
    await expect(order(tenantId, { title: 'Zu spät', instruction: 'Irgendwann erinnern.', dueAt: far })).rejects.toThrow(/Tage/);
    await expect(order(tenantId, { title: 'Ungültig', instruction: 'Irgendwann erinnern.', dueAt: 'morgen' })).rejects.toThrow();
    expect(await prisma.forTenantId(tenantId).case.count()).toBe(0);
  });
});
