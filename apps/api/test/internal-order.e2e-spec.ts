import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider, ToolRegistry } from '@orbit/agent-core';
import { TOOL_REGISTRY, LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { SONDE_ACT_TOOL_NAMES } from '../src/copilot/tools/sonde.tools';
import { PrismaService } from '../src/prisma/prisma.service';
import { InternalOrderService } from '../src/process/internal-order.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * FX-03 (Konzept Flexible Autonomie D6, Eigentümerentscheidung 19.10.): ein interner Auftrag über Sonde und ein zeitgesteuertes Ereignis laufen durch dieselbe Orchestrierung bis zu
 * einem nachgewiesenen Ergebnis. **Zeitpunkt, Fälligkeit und fachliches Ziel sind getrennt:** „Erinnere mich um 8 an X“ (REMINDER) endet mit der Erinnerung; „Prüfe bis morgen X“ (TASK) behält die
 * Prüfung als Ziel – die Fälligkeit ist eine Frist, kein Ziel. Die Frist wird nicht abgewartet, sondern in der Datenbank in die Vergangenheit gesetzt (eigener Mandant, kein Sweep über fremde Daten).
 */
describe('Interner Auftrag über Sonde und zeitgesteuertes Ereignis (FX-03, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: ToolRegistry;
  let llm: MockLLMProvider;
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];

  async function newTenant(timezone = 'Europe/Berlin'): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Auftrag ${suffix.slice(0, 8)}`, slug: `e2e-auftrag-${suffix}`, adminEmail: `admin-${suffix}@e2e-auftrag.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    await prisma.withRlsBypass((tx) => tx.tenant.update({ where: { id: tenant.id }, data: { timezone } }));
    for (const action of ['staff.notify', 'task.create']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    return tenant.id;
  }
  const order = (tenantId: string, input: Record<string, unknown>) =>
    registry.execute('create_internal_order', input, { tenantId, agentRunId: randomUUID() }) as Promise<{ caseId: string; mode: string; status: string; understoodTime?: { local: string; utc: string; timeZone: string; role: string } }>;
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const seedPlan = (proposal: Record<string, unknown>) => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_process_plan', input: proposal }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  };
  /** Ein Zeitpunkt in Ortszeit des Betriebs (ohne Versatz), n Minuten ab jetzt, abgerundet auf die Minute. */
  const localIn = (minutes: number, timeZone: string) => {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + minutes * 60_000));
    return parts.replace(' ', 'T');
  };

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

  it('Erinnerung: die Ortszeit des Betriebs wird richtig gelesen, vorher geschieht nichts, zum Zeitpunkt genau eine Meldung, dann Abschluss mit Nachweis – ohne Nachricht nach außen', async () => {
    const tenantId = await newTenant('Europe/Berlin');
    const remindAt = localIn(60, 'Europe/Berlin');
    const result = await order(tenantId, { kind: 'REMINDER', title: 'Wartung bei Meier', instruction: 'Bitte an die Wartung der Heizung bei Meier erinnern.', remindAt });
    expect(result.mode).toBe('TIMED_REMINDER');
    // Zeitzone: die Ortszeit (Berlin) wurde in den richtigen UTC-Zeitpunkt umgesetzt – in rund einer Stunde, nicht um den Versatz verschoben.
    const wait = await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: result.caseId } });
    const minutesAhead = (wait.deadlineAt!.getTime() - Date.now()) / 60_000;
    expect(minutesAhead).toBeGreaterThan(58);
    expect(minutesAhead).toBeLessThan(61);
    expect(result.understoodTime).toMatchObject({ timeZone: 'Europe/Berlin', role: 'REMINDER' });

    let row = await caseOf(tenantId, result.caseId);
    expect(row.orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
    expect(row.attentionReasons.join(' ')).toMatch(/Wiedervorlage/);
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.caseId } })).toBe(0);
    expect(wait).toMatchObject({ eventType: 'time.reached', status: 'WAITING' });

    await app.get(OrchestratorService).advance(tenantId, result.caseId); // vorzeitig angestoßen: keine Aktion
    expect((await caseOf(tenantId, result.caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.caseId } })).toBe(0);

    await prisma.withRlsBypass((tx) => tx.waitSubscription.updateMany({ where: { id: wait.id }, data: { deadlineAt: new Date(Date.now() - 1000) } }));
    await app.get(OrchestratorService).advance(tenantId, result.caseId);
    row = await caseOf(tenantId, result.caseId);
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(row.outcome).toMatchObject({ code: 'ADHOC_GOALS_PROVEN' });
    const items = await prisma.forTenantId(tenantId).attentionItem.findMany({ where: { caseId: result.caseId } });
    expect(items).toHaveLength(1);
    expect(items[0]!.reason).toContain('Wartung bei Meier');
    expect(await prisma.forTenantId(tenantId).emailMessage.count({ where: { caseId: result.caseId } })).toBe(0);
    await app.get(OrchestratorService).advance(tenantId, result.caseId);
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.caseId } })).toBe(1); // nicht wiederholt
  });

  it('die Ortszeit folgt der Zeitzone des Betriebs, nicht der des Servers', async () => {
    const tenantId = await newTenant('America/New_York');
    const result = await order(tenantId, { kind: 'REMINDER', title: 'Anruf', instruction: 'Rückruf nicht vergessen.', remindAt: localIn(30, 'America/New_York') });
    const wait = await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: result.caseId } });
    const minutesAhead = (wait.deadlineAt!.getTime() - Date.now()) / 60_000;
    expect(minutesAhead).toBeGreaterThan(28);
    expect(minutesAhead).toBeLessThan(31);
    expect(result.understoodTime!.timeZone).toBe('America/New_York');
  });

  it('Aufgabe mit Frist („Prüfe bis morgen …“): die Prüfung bleibt das Ziel, die Frist ist keine Erinnerung – der Vorgang wird nicht als erledigt geschlossen, die Aufgabe trägt die Fälligkeit, ein überfälliger Auftrag wird einmal gemeldet', async () => {
    const tenantId = await newTenant();
    seedPlan({
      goalKeys: ['human.review'],
      nodes: [
        { id: 'task', type: 'MANUAL_TASK', title: 'Angebot von Müller prüfen', inputs: {}, config: {} },
      ],
      edges: [],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Die Prüfung liegt bei einer Person; ORBIT legt die Aufgabe mit Frist an.',
    });
    const dueAt = localIn(24 * 60, 'Europe/Berlin');
    const result = await order(tenantId, { kind: 'TASK', title: 'Angebot Müller prüfen', instruction: 'Prüfe das Angebot von Müller auf Vollständigkeit.', dueAt });
    expect(result.mode).toBe('PLANNED');
    expect(result.understoodTime).toMatchObject({ role: 'DUE', timeZone: 'Europe/Berlin' });
    const row = await caseOf(tenantId, result.caseId);
    expect(row.description).toContain('Fällig bis:');
    // Ziel bleibt die Prüfung: keine Erinnerungsprozedur, keine Wartung bis zur Frist, kein Abschluss.
    expect(await prisma.forTenantId(tenantId).waitSubscription.count({ where: { caseId: result.caseId } })).toBe(0);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.completedAt).toBeNull();
    const task = await prisma.forTenantId(tenantId).task.findFirstOrThrow({ where: { caseId: result.caseId } });
    expect(task.dueDate!.toISOString()).toBe(result.understoodTime!.utc);

    // Die Frist läuft ab, der Auftrag ist offen: genau eine Meldung, der Vorgang schließt dadurch nicht.
    await prisma.withRlsBypass((tx) => tx.caseEvent.updateMany({ where: { caseId: result.caseId, type: 'order.created' }, data: { payload: { kind: 'TASK', dueAt: new Date(Date.now() - 60_000).toISOString(), instruction: 'x' } } }));
    const service = app.get(InternalOrderService);
    expect(await service.raiseOverdue(new Date())).toBeGreaterThanOrEqual(1);
    expect(await service.raiseOverdue(new Date())).toBe(0);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: result.caseId, type: 'order.overdue' } })).toBe(1);
    const items = await prisma.forTenantId(tenantId).attentionItem.findMany({ where: { caseId: result.caseId } });
    expect(items.some((i) => (i.reason ?? '').includes('Überfällig'))).toBe(true);
    expect((await caseOf(tenantId, result.caseId)).completedAt).toBeNull();
  });

  it('eine Erinnerung mit Fälligkeit oder eine Aufgabe mit Erinnerungszeit wird nicht still umgedeutet, sondern abgelehnt', async () => {
    const tenantId = await newTenant();
    await expect(order(tenantId, { kind: 'REMINDER', title: 'Falsch', instruction: 'Bitte prüfen.', remindAt: localIn(60, 'Europe/Berlin'), dueAt: localIn(120, 'Europe/Berlin') })).rejects.toThrow(/Fälligkeit/);
    await expect(order(tenantId, { kind: 'TASK', title: 'Falsch', instruction: 'Bitte prüfen.', remindAt: localIn(60, 'Europe/Berlin') })).rejects.toThrow(/Erinnerung/);
    await expect(order(tenantId, { kind: 'REMINDER', title: 'Ohne Zeit', instruction: 'Bitte erinnern.' })).rejects.toThrow(/Zeitpunkt/);
    expect(await prisma.forTenantId(tenantId).case.count()).toBe(0);
  });

  it('ein ungültiger, vergangener oder zu weit entfernter Zeitpunkt wird abgelehnt – es entsteht kein Vorgang', async () => {
    const tenantId = await newTenant();
    const far = new Date(Date.now() + 200 * 24 * 3600_000).toISOString();
    await expect(order(tenantId, { kind: 'REMINDER', title: 'Zu spät', instruction: 'Irgendwann erinnern.', remindAt: far })).rejects.toThrow(/Tage/);
    await expect(order(tenantId, { kind: 'REMINDER', title: 'Ungültig', instruction: 'Irgendwann erinnern.', remindAt: 'morgen früh' })).rejects.toThrow();
    await expect(order(tenantId, { kind: 'REMINDER', title: 'Vorbei', instruction: 'Irgendwann erinnern.', remindAt: '2020-01-01T08:00' })).rejects.toThrow(/Vergangenheit/);
    expect(await prisma.forTenantId(tenantId).case.count()).toBe(0);
  });
});
