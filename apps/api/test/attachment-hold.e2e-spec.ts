import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { ATTACHMENT_POLICY, triageFixtureForScenario } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { HeldAttachmentService } from '../src/intake/held-attachment.service';
import { IntakeService } from '../src/intake/intake.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const b64 = (bytes: Buffer | Uint8Array): string => Buffer.from(bytes).toString('base64');
const PDF = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, 'latin1');

/**
 * Anhangsfreigabe an der Aufnahme (technisch erzwungen): Was die Freigabe nicht zulässt – zu groß, Programm in Verkleidung, nicht freigegebene Art oder Endung, zu viele –, wird NICHT gespeichert, NICHT gelesen
 * (kein Textauszug, keine Vorschau) und der Triage nur als „nicht verarbeitet“ gemeldet; der Eingang trägt den Vermerk, und der Vorgang bekommt genau eine sichtbare Aufgabe für eine Person.
 */
describe('Anhangsfreigabe an der Aufnahme (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let llm: MockLLMProvider;
  const tenants: string[] = [];

  async function setup() {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `E2E Hold ${suffix}`, slug: `e2e-hold-${suffix}`, adminEmail: `admin-${suffix}@e2e-hold.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', lastSuccessAt: new Date(), externalAccountId: 'konto@firma.example' } });
    return { tenantId: tenant.id, connectionId: integration.id };
  }

  function event(tenantId: string, connectionId: string, attachments: NormalizedIntakeEvent['attachments']): NormalizedIntakeEvent {
    return {
      tenantId,
      connectionId,
      channel: 'EMAIL',
      provider: 'gmail',
      externalEventId: `gmail-${randomUUID()}`,
      occurredAt: new Date(),
      sender: { address: `kunde-${randomUUID()}@kunde.example` },
      recipients: [{ address: 'konto@firma.example' }],
      subject: 'Anfrage mit Anhängen',
      content: 'Bitte um ein Angebot, Unterlagen anbei.',
      direction: 'INBOUND',
      attachments,
    };
  }

  const script = () =>
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }], stopReason: 'tool_use' });

  function triageMessage(): string {
    const request = llm.getRequests().filter((r) => r.tools.some((t) => t.name === 'submit_triage_result')).at(-1);
    const user = request?.messages.find((m) => m.role === 'user');
    return typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    llm = app.get(LLM_PROVIDER);
  });

  afterAll(async () => {
    for (const tenantId of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    await app.close();
  });

  it('zurückgehaltene Anhänge werden nicht gespeichert und nicht gelesen, die Triage sieht sie als „nicht verarbeitet“, und eine Person bekommt genau eine Aufgabe', async () => {
    const { tenantId, connectionId } = await setup();
    const huge = Buffer.alloc(ATTACHMENT_POLICY.maxBytesEach + 1, 'a');
    script();
    const result = await intake.handleIntakeEvent(
      tenantId,
      undefined,
      event(tenantId, connectionId, [
        { fileName: 'angebot-wunsch.pdf', mimeType: 'application/pdf', contentBase64: b64(PDF('Wunsch Heizung')) },
        { fileName: 'lagerliste.txt', mimeType: 'text/plain', contentBase64: b64(huge) },
        { fileName: 'rechnung.pdf', mimeType: 'application/pdf', contentBase64: b64(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])) },
        { fileName: 'unterlagen.zip', mimeType: 'application/zip', contentBase64: b64(Buffer.from('PK\x03\x04', 'latin1')) },
      ]),
    );

    // Gespeichert ist nur der freigegebene Anhang.
    const intakeRow = await prisma.forTenantId(tenantId).intakeEvent.findUniqueOrThrow({ where: { id: result.intakeEventId } });
    expect(intakeRow.documentIds).toHaveLength(1);
    const documents = await prisma.forTenantId(tenantId).document.findMany({ where: { tenantId } });
    expect(documents.map((d) => d.fileName)).toEqual(['angebot-wunsch.pdf']);
    const stored = await app.get(StorageService).getObjectBytes(documents[0]!.storageKey);
    expect(stored.byteLength).toBeGreaterThan(0);

    // Der Eingang trägt den Vermerk – nur Metadaten, nie Inhalt.
    const held = (intakeRow.metadata as { heldAttachments: Array<{ fileName: string; reason: string; sizeBytes: number | null }> }).heldAttachments;
    expect(held.map((h) => [h.fileName, h.reason])).toEqual([['lagerliste.txt', 'TOO_LARGE'], ['rechnung.pdf', 'SIGNATURE_MISMATCH'], ['unterlagen.zip', 'BLOCKED_EXTENSION']]);
    expect(JSON.stringify(held)).not.toContain('contentBase64');

    // Die Triage sieht sie, liest sie aber nicht.
    const message = triageMessage();
    expect(message).toContain('lagerliste.txt');
    expect(message).toContain('nicht verarbeitet');
    expect(message).not.toContain('aaaaaaaaaa');

    // Sichtbare manuelle Übergabe: genau eine Aufgabe am Vorgang und ein Verlaufseintrag.
    const final = await prisma.forTenantId(tenantId).intakeEvent.findUniqueOrThrow({ where: { id: result.intakeEventId } });
    expect(final.caseId).toBeTruthy();
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId: final.caseId!, title: { startsWith: 'Anhang prüfen' } } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toContain('lagerliste.txt');
    expect(tasks[0]!.description).toContain('nicht gespeichert');
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: final.caseId!, type: 'attachment.held' } })).toBe(1);

    // Wiederholung der Übergabe legt nichts doppelt an.
    expect(await app.get(HeldAttachmentService).handOver(tenantId, result.intakeEventId)).toBe('ALREADY_DONE');
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId: final.caseId!, title: { startsWith: 'Anhang prüfen' } } })).toBe(1);
  });

  it('mehr als die zulässige Anzahl: die überzähligen werden zurückgehalten, die ersten bleiben unverändert', async () => {
    const { tenantId, connectionId } = await setup();
    script();
    const attachments = Array.from({ length: ATTACHMENT_POLICY.maxCount + 2 }, (_, i) => ({ fileName: `notiz-${i + 1}.txt`, mimeType: 'text/plain', contentBase64: b64(Buffer.from(`Notiz ${i + 1}`)) }));
    const result = await intake.handleIntakeEvent(tenantId, undefined, event(tenantId, connectionId, attachments));
    const row = await prisma.forTenantId(tenantId).intakeEvent.findUniqueOrThrow({ where: { id: result.intakeEventId } });
    expect(row.documentIds).toHaveLength(ATTACHMENT_POLICY.maxCount);
    expect((row.metadata as { heldAttachments: Array<{ fileName: string; reason: string }> }).heldAttachments.map((h) => [h.fileName, h.reason])).toEqual([['notiz-6.txt', 'TOO_MANY'], ['notiz-7.txt', 'TOO_MANY']]);
  });

  it('ohne zurückgehaltene Anhänge ändert sich nichts: keine Aufgabe, kein Vermerk', async () => {
    const { tenantId, connectionId } = await setup();
    script();
    const result = await intake.handleIntakeEvent(tenantId, undefined, event(tenantId, connectionId, [{ fileName: 'foto.png', mimeType: 'image/png', contentBase64: b64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])) }]));
    const row = await prisma.forTenantId(tenantId).intakeEvent.findUniqueOrThrow({ where: { id: result.intakeEventId } });
    expect((row.metadata as { heldAttachments?: unknown }).heldAttachments).toBeUndefined();
    expect(row.documentIds).toHaveLength(1);
    expect(await prisma.forTenantId(tenantId).task.count({ where: { tenantId, title: { startsWith: 'Anhang prüfen' } } })).toBe(0);
  });
});
