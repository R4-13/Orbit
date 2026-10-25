import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { CrmConnector } from '@orbit/integration-core';
import { triageFixtureForScenario } from '@orbit/shared';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { CRM_CONNECTOR } from '../src/connectors/connectors.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { LeadSyncService } from '../src/process/lead-sync.service';
import { SupplementService } from '../src/process/supplement.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'tom@kunde.example';
const REQUEST = 'Guten Tag, wir brauchen eine neue Heizung für unser Haus. Bitte schicken Sie uns ein Angebot. Tom Kunde';

/**
 * Meilenstein B: der vom Vorgang angelegte Lead im CRM wird nach der Übergabe ergänzt und korrigiert – gelesen, geändert, zurückgelesen; nie überschrieben, was jemand im CRM von Hand geändert hat;
 * ein Ausfall bleibt sichtbar offen und wird wiederholt; dieselbe Nachricht wirkt nur einmal; die Kundschaft erhält eine zutreffende Bestätigung. Das Modell ist ein Skript (nach Werkzeug geordnet,
 * nicht nach Aufrufreihenfolge); Versand ist ein Aufzeichnungs-Double, das CRM die persistente Test-Ablage.
 */
describe('Lead-Abgleich nach der Übergabe (Meilenstein B, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let leadSync: LeadSyncService;
  let supplements: SupplementService;
  let crm: CrmConnector;
  let sent: OutboundMessage[] = [];
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();
  const scripts = new Map<string, Array<Record<string, unknown>>>();
  const previousSwitch = process.env.FACT_CORRECTION_ENABLED;

  const script = (tool: string, input: Record<string, unknown>) => {
    const queue = scripts.get(tool) ?? [];
    queue.push(input);
    scripts.set(tool, queue);
  };
  const scriptExtraction = (facts: Array<{ key: string; value: string | number; evidence: string }> = []) => script('submit_extracted_facts', { facts: facts.map((f) => ({ ...f, confidence: 0.9 })) });
  const scriptAnalysis = (over: Record<string, unknown> = {}) =>
    script('submit_request_analysis', {
      requestType: 'Heizung',
      summary: 'Neue Heizung für ein Haus.',
      knownDetails: [],
      missingInformation: [{ key: 'existing_heating', label: 'Vorhandene Heizung', question: 'Welche Heizung ist bisher vorhanden?' }],
      siteVisit: { recommended: false, reason: '' },
      nextStep: 'ASK_CUSTOMER',
      ...over,
    });

  async function newTenant(informationAutonomous = false): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `LeadSync ${suffix.slice(0, 8)}`, slug: `e2e-leadsync-${suffix}`, adminEmail: `admin-${suffix}@e2e-leadsync.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    const autonomous = ['email.send.clarification', 'email.send.acknowledgement', 'lead.create', 'staff.notify', 'crm.contact.manage', ...(informationAutonomous ? ['email.send.information'] : [])];
    for (const action of autonomous) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    await prisma.forTenantId(tenant.id).tenantProfile.create({ data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren Heizungen und Bäder.', services: ['Heizungsinstallation', 'Badsanierung'], faqs: [] } });
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.handoff.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenant.id, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenant.id, 'u1', blueprint.key, blueprint.version);
    return tenant.id;
  }

  function mail(tenantId: string, over: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Tom Kunde' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Neue Heizung', content: REQUEST, threadId: 'thr-1', rfcMessageId: '<m1@kunde.example>', ...over };
  }
  const reply = (tenantId: string, content: string, n: number) =>
    intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Neue Heizung', content, rfcMessageId: `<m${n + 1}@kunde.example>`, inReplyTo: `<sent-${sent.length}@mail.example>`, references: ['<m1@kunde.example>', `<sent-${sent.length}@mail.example>`] }));
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const leadOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).lead.findFirstOrThrow({ where: { caseId } });

  /** B1 bis zur Übergabe: Anfrage, Rückfrage, Antwort „Gasheizung von 1985“ → Lead angelegt, Vorgang abgeschlossen. */
  async function handedOverCase(tenantId: string): Promise<string> {
    script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown>);
    script('submit_blueprint_fit', { fits: true, reason: 'Eine klassische Angebotsanfrage.' });
    scriptExtraction();
    scriptAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Welche Heizung ist bisher vorhanden?');
    scriptExtraction([{ key: 'ai.existing_heating', value: 'Gasheizung von 1985', evidence: 'Gasheizung von 1985' }]);
    await reply(tenantId, 'Die vorhandene Heizung ist eine Gasheizung von 1985.', 1);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
    return caseId;
  }

  beforeAll(async () => {
    process.env.FACT_CORRECTION_ENABLED = 'true';
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    leadSync = app.get(LeadSyncService);
    supplements = app.get(SupplementService);
    crm = app.get<CrmConnector>(CRM_CONNECTOR);
    const live = {
      providerName: 'scripted-live',
      modelName: 'scripted',
      complete: async (request: { messages: unknown[]; tools: Array<{ name: string }> }) => {
        if (request.messages.length > 1) return { text: 'ok', toolCalls: [], stopReason: 'end_turn' as const };
        for (const tool of request.tools) {
          const next = scripts.get(tool.name)?.shift();
          if (next) return { toolCalls: [{ toolCallId: randomUUID(), toolName: tool.name, input: next }], stopReason: 'tool_use' as const };
        }
        return { text: '', toolCalls: [], stopReason: 'end_turn' as const };
      },
    };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
    spies.push(
      jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenant, message) => {
        sent.push(message);
        return { providerMessageId: `gm-${sent.length}`, threadId: message.threadId ?? 'thr-1', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
    );
  });
  beforeEach(() => {
    sent = [];
    scripts.clear();
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    if (previousSwitch === undefined) delete process.env.FACT_CORRECTION_ENABLED;
    else process.env.FACT_CORRECTION_ENABLED = previousSwitch;
    await app.close();
  });

  it('nach der Übergabe: Korrektur und neue Angabe erreichen den Lead (gelesen, geändert, zurückgelesen), die Kundschaft erhält eine zutreffende Bestätigung, dieselbe Nachricht wirkt nur einmal', async () => {
    const tenantId = await newTenant();
    const caseId = await handedOverCase(tenantId);
    const created = await leadOf(tenantId, caseId);
    expect(created).toMatchObject({ crmSyncState: 'SYNCED' });
    expect(created.crmExternalId).toBeTruthy();
    expect(created.notes).toContain('Vorhandene Heizung: Gasheizung von 1985');
    const sentBefore = sent.length;

    // Korrektur („nicht von 1985, sondern von 1995“) und eine weitere Angabe in einer Nachricht nach der Übergabe.
    scriptExtraction([{ key: 'ai.standort', value: 'Köln, Musterstraße 12', evidence: 'Köln, Musterstraße 12' }]);
    const text = 'Eine Korrektur: Die vorhandene Heizung ist nicht von 1985, sondern von 1995. Das Haus steht in Köln, Musterstraße 12.';
    await reply(tenantId, text, 2);

    const lead = await leadOf(tenantId, caseId);
    expect(lead.crmSyncState).toBe('SYNCED');
    expect(lead.notes).toContain('Vorhandene Heizung: Gasheizung von 1995'); // der unveränderte Teil „Gasheizung“ bleibt erhalten
    expect(lead.notes).toContain('Standort: Köln, Musterstraße 12');
    expect(lead.notes).not.toContain('1985');
    // Rücklesen aus dem CRM: derselbe Stand.
    const remote = await crm.readLead({ tenantId, externalId: lead.crmExternalId! });
    expect(remote?.notes?.replace(/\s+/g, ' ')).toBe(lead.notes!.replace(/\s+/g, ' ').trim());
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'lead.synced' } })).toBeGreaterThanOrEqual(1);
    // Die Folgeaufgabe des Vertriebs trägt denselben aktuellen Stand; es gibt keine zusätzliche Aufgabe „nach Abschluss“.
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId } });
    expect(tasks.find((t) => t.title.startsWith('Neuen Lead kontaktieren'))?.description).toContain('Gasheizung von 1995');
    expect(tasks.some((t) => t.title.startsWith('Neue Nachricht nach Abschluss') || t.title.startsWith('Korrektur nach Übergabe'))).toBe(false);
    // Eine Bestätigung, die nennt, was übernommen wurde – nur an die Kundschaft.
    expect(sent).toHaveLength(sentBefore + 1);
    const confirmation = sent[sentBefore]!;
    expect(confirmation.to).toBe(SENDER);
    expect(confirmation.bodyText).toContain('Gasheizung von 1995 (korrigiert, bisher: Gasheizung von 1985)');
    expect(confirmation.bodyText).toContain('Köln, Musterstraße 12');
    expect(confirmation.bodyText).not.toMatch(/€|Euro|Preis/);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');

    // Dieselbe Nachricht noch einmal verarbeitet (Wiederholung): keine zweite Wirkung.
    const inbound = await prisma.forTenantId(tenantId).emailMessage.findFirstOrThrow({ where: { caseId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    const eventsBefore = await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'lead.synced' } });
    await supplements.processLateMessage(tenantId, caseId, inbound.id);
    expect(sent).toHaveLength(sentBefore + 1);
    expect((await leadOf(tenantId, caseId)).crmSyncedHash).toBe(lead.crmSyncedHash);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'lead.synced' } })).toBe(eventsBefore);
    expect(await prisma.forTenantId(tenantId).lead.count({ where: { caseId } })).toBe(1); // nie ein zweiter Lead
  });

  it('wurde der Lead im CRM von Hand geändert, überschreibt ORBIT nichts: Konflikt bleibt sichtbar, der Vorgang ist nicht abgeschlossen, die Kundschaft hört nichts Falsches', async () => {
    const tenantId = await newTenant();
    const caseId = await handedOverCase(tenantId);
    const lead = await leadOf(tenantId, caseId);
    const record = await prisma.forTenantId(tenantId).mockCrmRecord.findFirstOrThrow({ where: { tenantId, kind: 'LEAD', externalId: lead.crmExternalId! } });
    await prisma.forTenantId(tenantId).mockCrmRecord.update({ where: { id: record.id }, data: { data: { ...(record.data as object), notes: 'Vom Vertrieb von Hand ergänzt: Rückruf am Dienstag.' } } });
    const sentBefore = sent.length;

    await reply(tenantId, 'Die vorhandene Heizung ist nicht von 1985, sondern von 1995.', 2);

    const after = await leadOf(tenantId, caseId);
    expect(after.crmSyncState).toBe('CONFLICT');
    expect(after.crmSyncError).toContain('von Hand geändert');
    expect((await crm.readLead({ tenantId, externalId: lead.crmExternalId! }))?.notes).toBe('Vom Vertrieb von Hand ergänzt: Rückruf am Dienstag.'); // nichts überschrieben
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.attentionReasons.join(' ')).toContain('Lead-Abgleich');
    expect(sent).toHaveLength(sentBefore); // „übernommen und weitergegeben“ wird nicht behauptet
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'lead.sync_conflict' } })).toBe(1);
  });

  it('fällt das CRM aus, bleibt der Abgleich sichtbar offen (FAILED, Vorgang nicht abgeschlossen); später gelingt er, der Vorgang schließt wieder, die zurückgehaltene Bestätigung geht hinaus', async () => {
    const tenantId = await newTenant();
    const caseId = await handedOverCase(tenantId);
    const sentBefore = sent.length;
    scriptExtraction();
    const failing = jest.spyOn(crm, 'updateLead').mockRejectedValue(new Error('CRM nicht erreichbar'));
    try {
      await reply(tenantId, 'Die vorhandene Heizung ist nicht von 1985, sondern von 1995.', 2);
      const failed = await leadOf(tenantId, caseId);
      expect(failed.crmSyncState).toBe('FAILED');
      expect(failed.crmSyncError).toContain('nicht erreichbar');
      expect(failed.notes).toContain('1985'); // der Lead im CRM trägt noch den alten Stand – und das ist sichtbar
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('MANUAL_REVIEW');
      expect(sent).toHaveLength(sentBefore);
    } finally {
      failing.mockRestore();
    }
    // Wiederholung (Sweep): der Lead wird auf den Stand gebracht, der Vorgang schließt, die Kundschaft bekommt die Bestätigung.
    const retried = await leadSync.retryOpen(new Date(Date.now() + 5 * 60_000));
    expect(retried.synced).toBeGreaterThanOrEqual(1);
    await supplements.resumeAfterSync(tenantId, caseId);
    const healed = await leadOf(tenantId, caseId);
    expect(healed.crmSyncState).toBe('SYNCED');
    expect(healed.notes).toContain('Gasheizung von 1995');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
    expect(sent).toHaveLength(sentBefore + 1);
    expect(sent[sentBefore]!.bodyText).toContain('Gasheizung von 1995');
    await supplements.resumeAfterSync(tenantId, caseId);
    expect(sent).toHaveLength(sentBefore + 1); // nicht ein zweites Mal
  });

  it('Preisfrage: wird aus dem Betriebswissen beantwortet (statt nur den Eingang zu bestätigen); der Lead nennt die Frage als beantwortet', async () => {
    const tenantId = await newTenant(true);
    script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown>);
    script('submit_blueprint_fit', { fits: true, reason: 'Eine Angebotsanfrage mit Preisfrage.' });
    scriptExtraction();
    scriptAnalysis({ missingInformation: [] });
    script('submit_knowledge_answer', { answerable: true, answer: 'Konkrete Preise nennen wir erst nach einer Besichtigung vor Ort; danach erhalten Sie ein schriftliches Angebot.', sources: ['Profil: Preise'], confidence: 0.95 });
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Badezimmer erneuern – was kostet das?', content: 'Guten Tag, wir möchten unser Bad komplett erneuern lassen, mit ebenerdiger Dusche. Tom Kunde' }));
    const caseId = first.case!.id;

    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Konkrete Preise nennen wir erst nach einer Besichtigung');
    const lead = await leadOf(tenantId, caseId);
    expect(lead.notes).toMatch(/Preisfrage der Kundschaft: „Badezimmer erneuern – was kostet das\?“ – per E-Mail beantwortet\./);
    expect(lead.crmSyncState).toBe('SYNCED');
  });

  it('Preisfrage ohne gesicherte Auskunft: keine Antwort aus dem Nichts – Eingangsbestätigung, die Frage steht im Lead ausdrücklich als offen', async () => {
    const tenantId = await newTenant(true);
    script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown>);
    script('submit_blueprint_fit', { fits: true, reason: 'Eine Angebotsanfrage mit Preisfrage.' });
    scriptExtraction();
    scriptAnalysis({ missingInformation: [] });
    script('submit_knowledge_answer', { answerable: false, answer: '', sources: [], confidence: 0.2 });
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Badezimmer erneuern – was kostet das?', content: 'Guten Tag, wir möchten unser Bad komplett erneuern lassen. Tom Kunde' }));
    const caseId = first.case!.id;

    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Sie ist bei uns eingegangen');
    expect(sent[0]!.bodyText).not.toMatch(/Preise nennen/);
    const lead = await leadOf(tenantId, caseId);
    expect(lead.notes).toMatch(/Preisfrage der Kundschaft: „Badezimmer erneuern – was kostet das\?“ – noch offen/);
  });
});
