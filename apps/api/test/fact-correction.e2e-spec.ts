import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { CasesService } from '../src/cases/cases.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { FactCorrectionService } from '../src/process/fact-correction.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const TOM = 'tom@kunde.example';

/**
 * FX-20: Korrekturen früher genannter Angaben (7 → 8 → 12 m²) werden bei jeder neuen Nachricht erkannt – unabhängig vom Prozessschritt. Eindeutige Selbstkorrektur derselben Person: neuer Wert gilt, alter
 * bleibt als Verlauf; Mehrdeutigkeit: sichtbarer Widerspruch statt geratenem Wert; weiterer Gegenstand: keine Änderung. Modell = Skript-Warteschlange.
 */
describe('Korrekturen früher genannter Angaben (FX-20, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let llm: MockLLMProvider;
  let service: FactCorrectionService;
  let facts: CaseFactsService;
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];

  function seedTool(toolName: string, input: Record<string, unknown>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  const seedUpdates = (updates: Array<Record<string, unknown>>) => seedTool('submit_fact_updates', { updates });

  async function setup(): Promise<{ tenantId: string; caseId: string; firstMessageId: string }> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Korrektur ${suffix.slice(0, 8)}`, slug: `e2e-korrektur-${suffix}`, adminEmail: `admin-${suffix}@e2e-korrektur.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const row = await app.get(CasesService).create(tenant.id, '', { type: 'GENERAL', title: 'Badsanierung' });
    const first = await message(tenant.id, row.id, TOM, 'Mein Bad hat ca. 7 m². Bitte um ein Angebot.');
    await facts.propose(tenant.id, row.id, [{ key: 'bathroom.area_m2', value: 7, valueType: 'number', sourceType: 'EMAIL', sourceRef: `message:${first}`, evidenceRefs: ['ca. 7 m²'] }]);
    const [fact] = await facts.getCurrent(tenant.id, row.id);
    await facts.confirmBySchema(tenant.id, fact!.id, 'number');
    return { tenantId: tenant.id, caseId: row.id, firstMessageId: first };
  }
  async function message(tenantId: string, caseId: string, from: string, text: string): Promise<string> {
    const created = await prisma.forTenantId(tenantId).emailMessage.create({ data: { tenantId, caseId, direction: 'INBOUND', fromAddress: from, toAddresses: ['info@betrieb.example'], subject: 'Re: Badsanierung', bodyText: text, bodyPreview: text.slice(0, 100), receivedAt: new Date() } });
    return created.id;
  }
  const currentValues = async (tenantId: string, caseId: string) => (await facts.getCurrent(tenantId, caseId)).filter((f) => f.key === 'bathroom.area_m2').map((f) => ({ value: f.value, status: f.status }));

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    llm = app.get(LLM_PROVIDER);
    service = app.get(FactCorrectionService);
    facts = app.get(CaseFactsService);
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('eindeutige Selbstkorrektur derselben Person (7 → 8 → 12 m²): der aktuelle Wert gilt, die früheren bleiben als Verlauf erhalten', async () => {
    const { tenantId, caseId } = await setup();
    seedUpdates([{ key: 'bathroom.area_m2', newValue: 8, evidence: 'doch 8 m²', kind: 'CORRECTION', reason: 'nimmt 7 zurück' }]);
    const second = await message(tenantId, caseId, TOM, 'Ach nein, es sind doch 8 m². Viele Grüße');
    const outcome = await service.processInbound(tenantId, caseId, second);
    expect(outcome.corrected).toEqual([{ key: 'bathroom.area_m2', previous: 7, current: 8 }]);
    expect(await currentValues(tenantId, caseId)).toEqual([{ value: 8, status: 'CONFIRMED' }]);

    seedUpdates([{ key: 'bathroom.area_m2', newValue: 12, evidence: 'nicht 8, sondern 12 m²', kind: 'CORRECTION', reason: 'korrigiert erneut' }]);
    const third = await message(tenantId, caseId, TOM, 'Sorry, ich habe nachgemessen: nicht 8, sondern 12 m².');
    await service.processInbound(tenantId, caseId, third);
    expect(await currentValues(tenantId, caseId)).toEqual([{ value: 12, status: 'CONFIRMED' }]);

    const history = await facts.getHistory(tenantId, caseId, 'bathroom.area_m2');
    expect(history.map((f) => [f.value, f.isCurrent])).toEqual([[7, false], [8, false], [12, true]]);
    expect(history[2]!.supersedesFactId).toBe(history[1]!.id);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'fact.corrected' } })).toBe(2);
  });

  it('echte Mehrdeutigkeit: kein Wert wird geraten – beide stehen sichtbar im Widerspruch', async () => {
    const { tenantId, caseId } = await setup();
    seedUpdates([{ key: 'bathroom.area_m2', newValue: 9, evidence: 'vielleicht 9 oder 10 m²', kind: 'AMBIGUOUS', reason: 'Schätzung mit Alternative' }]);
    const second = await message(tenantId, caseId, TOM, 'Beim Nachmessen: vielleicht 9 oder 10 m², genau weiß ich es nicht.');
    const outcome = await service.processInbound(tenantId, caseId, second);
    expect(outcome.corrected).toEqual([]);
    expect(outcome.conflicts).toHaveLength(1);
    expect((await currentValues(tenantId, caseId)).map((v) => v.status)).toEqual(['CONFLICTED', 'CONFLICTED']);
    const event = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: 'fact.conflict_detected' } });
    expect((event.payload as { values: unknown[] }).values).toEqual([7, 9]);
  });

  it('eine Korrektur von einer anderen Person wird nicht als Selbstkorrektur übernommen – sie steht im Widerspruch', async () => {
    const { tenantId, caseId } = await setup();
    seedUpdates([{ key: 'bathroom.area_m2', newValue: 8, evidence: 'es sind 8 m²', kind: 'CORRECTION', reason: 'Korrektur' }]);
    const other = await message(tenantId, caseId, 'nachbar@kunde.example', 'Hallo, es sind 8 m², nicht 7.');
    const outcome = await service.processInbound(tenantId, caseId, other);
    expect(outcome.corrected).toEqual([]);
    expect(outcome.conflicts[0]!.reason).toMatch(/nicht nachweislich von derselben Person/);
    expect((await currentValues(tenantId, caseId)).map((v) => v.status)).toEqual(['CONFLICTED', 'CONFLICTED']);
  });

  it('ein weiterer Gegenstand, ein erfundener Beleg und derselbe Wert ändern nichts', async () => {
    const { tenantId, caseId } = await setup();
    seedUpdates([
      { key: 'bathroom.area_m2', newValue: 5, evidence: 'das Gäste-WC hat 5 m²', kind: 'ADDITIONAL', reason: 'anderer Raum' },
    ]);
    await service.processInbound(tenantId, caseId, await message(tenantId, caseId, TOM, 'Außerdem: das Gäste-WC hat 5 m².'));
    seedUpdates([{ key: 'bathroom.area_m2', newValue: 20, evidence: 'es sind 20 m²', kind: 'CORRECTION', reason: 'erfunden' }]);
    const invented = await service.processInbound(tenantId, caseId, await message(tenantId, caseId, TOM, 'Danke, bis bald.'));
    expect(invented.ignored[0]!.reason).toMatch(/Beleg steht nicht wörtlich/);
    seedUpdates([{ key: 'bathroom.area_m2', newValue: 7, evidence: 'wie gesagt 7 m²', kind: 'CORRECTION', reason: 'unverändert' }]);
    const same = await service.processInbound(tenantId, caseId, await message(tenantId, caseId, TOM, 'Es bleibt dabei: wie gesagt 7 m².'));
    expect(same.ignored[0]!.reason).toBe('gleicher Wert');
    expect(await currentValues(tenantId, caseId)).toEqual([{ value: 7, status: 'CONFIRMED' }]);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: { in: ['fact.corrected', 'fact.conflict_detected'] } } })).toBe(0);
  });

  it('von einer Person gesetzte Angaben überschreibt eine Kundennachricht nie; ohne bekannte Angaben entsteht kein KI-Aufruf', async () => {
    const { tenantId, caseId } = await setup();
    await facts.setByHuman(tenantId, caseId, 'user-1', { key: 'bathroom.area_m2', value: 7.5, valueType: 'number' });
    const requestsBefore = llm.getRequests().length;
    const outcome = await service.processInbound(tenantId, caseId, await message(tenantId, caseId, TOM, 'Es sind doch 8 m².'));
    expect(outcome.corrected).toEqual([]);
    expect(llm.getRequests().length).toBe(requestsBefore); // nur Werte aus Kundennachrichten werden geprüft; die Angabe der Person ist bekannt-fest
    expect(await currentValues(tenantId, caseId)).toEqual([{ value: 7.5, status: 'CONFIRMED' }]);
    const bare = await app.get(CasesService).create(tenantId, '', { type: 'GENERAL', title: 'Ohne Angaben' });
    const noFacts = await service.processInbound(tenantId, bare.id, await message(tenantId, bare.id, TOM, 'Nur eine Frage.'));
    expect(noFacts).toEqual({ corrected: [], conflicts: [], ignored: [] });
    expect(llm.getRequests().length).toBe(requestsBefore);
  });
});
