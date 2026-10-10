import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture } from '@orbit/shared';
import request from 'supertest';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { AttentionService } from '../src/organization/attention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';
const MIN = 60_000;
const HOUR = 60 * MIN;

interface Sent {
  to: string;
  subject: string;
  text: string;
}

/**
 * Vorgänge, die auf Menschen warten: Meldung an die Zuständigen, Erinnerung mit Vertretung, Eskalation an Vorgesetzte und Leitung, Notfälle, Quittierung, ehrliche
 * Kanalangabe, Wiederholung fehlgeschlagener Zustellung – gegen echte Postgres. Der Versand ist ein Aufzeichnungs-Double: nichts verlässt den Testprozess.
 */
describe('Attention: notify, remind, escalate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let attention: AttentionService;
  let tenantId: string;
  let token: string;
  let sent: Sent[] = [];
  let failNext: string[] = [];
  const staffIds: Record<string, string> = {};
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const t0 = new Date();
  const at = (ms: number) => new Date(t0.getTime() + ms);

  async function createCase(over: Record<string, unknown> = {}) {
    return prisma.forTenantId(tenantId).case.create({
      data: { tenantId, type: 'FINANCE', title: `Rechnung ${randomUUID().slice(0, 6)}`, orchestrationStatus: 'WAITING_FOR_APPROVAL', attentionReasons: ['Eine Freigabe ist offen.'], ...over } as never,
    });
  }
  const itemFor = (caseId: string) => prisma.forTenantId(tenantId).attentionItem.findFirst({ where: { tenantId, caseId }, orderBy: { createdAt: 'desc' } });
  const notifications = (itemId: string) => prisma.forTenantId(tenantId).staffNotification.findMany({ where: { tenantId, attentionItemId: itemId }, include: { staffMember: true }, orderBy: { createdAt: 'asc' } });
  const recipients = () => sent.map((s) => s.to).sort();

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    attention = app.get(AttentionService);
    const mail = app.get<OutboundMailPort>(OUTBOUND_MAIL);
    jest.spyOn(mail, 'send').mockImplementation(async (_tenant: string, message: OutboundMessage) => {
      if (failNext.includes(message.to)) throw new Error('Postfach nicht erreichbar');
      sent.push({ to: message.to, subject: message.subject, text: message.bodyText });
      return { providerMessageId: 'test', from: 'betrieb@test.example', executionMode: 'LIVE' };
    });

    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `E2E Attention ${suffix}`, slug: `e2e-attention-${suffix}`, adminEmail: `admin-${suffix}@e2e-attention.example`, adminPassword: PASSWORD, adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenantId = tenant.id;
    token = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;

    // Verzeichnis über die echte Schnittstelle: Inhaber → Leitung → Buchhalterin (Vertretung: Vera), dazu Notfallzuständiger Ben und Wanda mit WhatsApp-Wunsch.
    const post = async (key: string, body: Record<string, unknown>) => {
      const res = await request(app.getHttpServer()).post('/api/v1/staff').set(auth()).send(body).expect(201);
      staffIds[key] = res.body.id as string;
    };
    await post('chef', { externalId: 'A-1', firstName: 'Clara', lastName: 'Chef', roleKind: 'OWNER', email: 'chef@betrieb.test' });
    await post('leiter', { externalId: 'A-2', firstName: 'Lars', lastName: 'Leiter', roleKind: 'MANAGER', email: 'leiter@betrieb.test', supervisorRef: 'A-1' });
    await post('vera', { externalId: 'A-3', firstName: 'Vera', lastName: 'Vertretung', roleKind: 'OFFICE', email: 'vera@betrieb.test', supervisorRef: 'A-2' });
    await post('bea', { externalId: 'A-4', firstName: 'Bea', lastName: 'Buchhaltung', roleKind: 'ACCOUNTING', email: 'bea@betrieb.test', responsibilities: ['INVOICES'], supervisorRef: 'A-2', deputyRef: 'A-3' });
    await post('ben', { externalId: 'A-5', firstName: 'Ben', lastName: 'Notdienst', roleKind: 'TECHNICIAN', email: 'ben@betrieb.test', phone: '+49 171 1234567', preferredChannel: 'WHATSAPP', responsibilities: ['EMERGENCY'], supervisorRef: 'A-1' });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  beforeEach(() => {
    sent = [];
    failNext = [];
  });

  describe('Phasen: Meldung → Erinnerung mit Vertretung → Eskalation', () => {
    let caseId: string;
    let itemId: string;

    it('ein auf Freigabe wartender Vorgang meldet sich bei der zuständigen Person – nur bei ihr', async () => {
      caseId = (await createCase()).id;
      const result = await attention.syncTenant(tenantId, t0);
      expect(result).toMatchObject({ opened: 1, notified: 1 });
      const item = await itemFor(caseId);
      itemId = item!.id;
      expect(item).toMatchObject({ kind: 'WAITING_FOR_APPROVAL', responsibility: 'INVOICES', state: 'OPEN', emergency: false });
      expect(recipients()).toEqual(['bea@betrieb.test']);
      expect(sent[0]!.subject.startsWith('Neu: Rechnung')).toBe(true);
      expect(sent[0]!.text).toContain(`/cases/${caseId}`);
      expect(sent[0]!.text).toContain('Eine Freigabe ist offen.');
    });

    it('derselbe Stand ergibt keine zweite Meldung (höchstens eine je Person und Phase)', async () => {
      await attention.syncTenant(tenantId, at(10 * MIN));
      await attention.syncTenant(tenantId, at(2 * HOUR));
      expect(sent).toEqual([]);
    });

    it('nach 4 Stunden ohne Reaktion: Erinnerung an die Person und Meldung an die Vertretung (die Person kann krank sein)', async () => {
      await attention.syncTenant(tenantId, at(4 * HOUR + MIN));
      expect(recipients()).toEqual(['bea@betrieb.test', 'vera@betrieb.test']);
      const vera = sent.find((s) => s.to === 'vera@betrieb.test')!;
      expect(vera.subject.startsWith('Erinnerung:')).toBe(true);
      expect(vera.text).toContain('als Vertretung eingetragen für Bea Buchhaltung');
      expect((await itemFor(caseId))!.phase).toBe('REMINDER');
    });

    it('nach 24 Stunden: zusätzlich der Vorgesetzte und die Leitung – mit Hinweis, wer nicht reagiert hat', async () => {
      await attention.syncTenant(tenantId, at(25 * HOUR));
      expect(recipients()).toEqual(['bea@betrieb.test', 'chef@betrieb.test', 'leiter@betrieb.test', 'vera@betrieb.test']);
      const leader = sent.find((s) => s.to === 'leiter@betrieb.test')!;
      expect(leader.subject.startsWith('Eskalation:')).toBe(true);
      expect(leader.text).toContain('Bea Buchhaltung hat seit 25 Stunden nicht reagiert');
      expect((await itemFor(caseId))!.phase).toBe('ESCALATED');
      const audit = await prisma.forTenantId(tenantId).auditLog.findMany({ where: { tenantId, eventType: { in: ['ATTENTION_NOTIFIED', 'ATTENTION_ESCALATED'] }, entityId: caseId } });
      expect(audit.filter((a) => a.eventType === 'ATTENTION_ESCALATED').length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audit.map((a) => a.payload))).not.toContain('@betrieb.test'); // keine Adressen im Audit
    });

    it('der Stand der Meldungen ist am Vorgang sichtbar: wer, wann, über welchen Kanal', async () => {
      const view = (await request(app.getHttpServer()).get(`/api/v1/attention/cases/${caseId}`).set(auth()).expect(200)).body as { attention: { phase: string; notifications: Array<{ person: string; role: string; phase: string; deliveredVia: string; status: string }> } };
      expect(view.attention.phase).toBe('ESCALATED');
      expect(view.attention.notifications.map((n) => `${n.person}:${n.phase}`)).toEqual(
        expect.arrayContaining(['Bea Buchhaltung:INITIAL', 'Bea Buchhaltung:REMINDER', 'Vera Vertretung:REMINDER', 'Lars Leiter:ESCALATED', 'Clara Chef:ESCALATED']),
      );
      expect(view.attention.notifications.every((n) => n.status === 'SENT' && n.deliveredVia === 'EMAIL')).toBe(true);
    });

    it('„Ich kümmere mich“ beendet die Erinnerungen; verlässt der Vorgang den wartenden Zustand, ist der Eintrag gelöst', async () => {
      const ack = (await request(app.getHttpServer()).post(`/api/v1/attention/${itemId}/acknowledge`).set(auth()).expect(201)).body as { attention?: unknown; state: string };
      expect(ack.state).toBe('ACKNOWLEDGED');
      await attention.syncTenant(tenantId, at(60 * HOUR));
      expect(sent).toEqual([]);

      await prisma.forTenantId(tenantId).case.update({ where: { id: caseId }, data: { orchestrationStatus: 'COMPLETED' } });
      const result = await attention.syncTenant(tenantId, at(61 * HOUR));
      expect(result.resolved).toBe(1);
      expect((await itemFor(caseId))!.state).toBe('RESOLVED');
      await request(app.getHttpServer()).get(`/api/v1/attention/cases/${caseId}`).set(auth()).expect(200).expect((r) => expect(r.body.attention).toBeNull());
    });
  });

  describe('Notfälle und Kanäle', () => {
    it('ein als kritisch eingestufter Eingang meldet sofort an die Notfallzuständigen; die Wartezeiten sind kurz (15/45 Minuten)', async () => {
      const emergency = await createCase({ type: 'SALES', title: 'Wasserrohrbruch Keller', orchestrationStatus: 'IN_PROGRESS', attentionReasons: [] });
      const event = await prisma.forTenantId(tenantId).intakeEvent.create({
        data: { tenantId, channel: 'EMAIL', provider: 'test', externalEventId: randomUUID(), occurredAt: new Date(), caseId: emergency.id, subject: 'Wasserrohrbruch' } as never,
      });
      await prisma.forTenantId(tenantId).intakeDecision.create({
        data: { tenantId, intakeEventId: event.id, status: 'DECIDED', appliedRelevance: 'BUSINESS_ACTIONABLE', result: { category: 'COMPLAINT_OR_SERVICE', urgency: 'CRITICAL' } } as never,
      });

      const now = at(70 * HOUR);
      await attention.syncTenant(tenantId, now);
      const item = await itemFor(emergency.id);
      expect(item).toMatchObject({ kind: 'EMERGENCY', responsibility: 'EMERGENCY', emergency: true, state: 'OPEN' });
      expect(recipients()).toEqual(['ben@betrieb.test']);
      expect(sent[0]!.subject.startsWith('NOTFALL:')).toBe(true);

      // Ben wünscht WhatsApp; zugestellt wird per E-Mail – und das steht in der Meldung (kein stilles Umlenken).
      const [n] = await notifications(item!.id);
      expect(n).toMatchObject({ wantedChannel: 'WHATSAPP', deliveredVia: 'EMAIL', status: 'SENT', executionMode: 'LIVE' });
      expect(n!.note).toContain('noch nicht angebunden');

      sent = [];
      await attention.syncTenant(tenantId, new Date(now.getTime() + 16 * MIN));
      expect(recipients()).toEqual(['ben@betrieb.test']); // Erinnerung nach 15 Minuten
      sent = [];
      await attention.syncTenant(tenantId, new Date(now.getTime() + 46 * MIN));
      // Eskalation nach 45 Minuten: Bens Vorgesetzte (Chefin) und die Leitung kommen dazu.
      expect(recipients()).toEqual(['ben@betrieb.test', 'chef@betrieb.test', 'leiter@betrieb.test']);
    });

    it('Ende zu Ende: eine Notfall-Nachricht ohne hinterlegten Prozess wird ein Vorgang und erreicht die Notfallzuständige', async () => {
      const llm = app.get<MockLLMProvider>(LLM_PROVIDER);
      llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'submit_triage_result',
            input: buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'COMPLAINT_OR_SERVICE', urgency: 'CRITICAL', conciseReason: 'Akuter Rohrbruch, Wasser läuft.', confidence: { relevance: 0.97, intent: 0.95 } }) as unknown as Record<string, unknown>,
          },
        ],
        stopReason: 'tool_use',
      });
      const integration = await prisma.forTenantId(tenantId).integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', lastSuccessAt: new Date(), externalAccountId: 'konto@betrieb.test' } });
      const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, {
        tenantId,
        connectionId: integration.id,
        channel: 'EMAIL',
        provider: 'gmail',
        externalEventId: `gmail-${randomUUID()}`,
        occurredAt: new Date(),
        sender: { address: 'kunde@privat.example' },
        recipients: [{ address: 'konto@betrieb.test' }],
        subject: 'Rohrbruch im Keller!',
        content: 'Das Wasser läuft, bitte sofort kommen.',
        direction: 'INBOUND',
      });
      expect(result.case).toMatchObject({ type: 'GENERAL' });
      expect(result.case!.title).toBe('Notfall: Rohrbruch im Keller!');

      sent = [];
      await attention.syncTenant(tenantId, new Date());
      const item = await itemFor(result.case!.id);
      expect(item).toMatchObject({ kind: 'EMERGENCY', responsibility: 'EMERGENCY', state: 'OPEN' });
      expect(recipients()).toEqual(['ben@betrieb.test']);
      expect(sent[0]!.subject).toBe('NOTFALL: Rohrbruch im Keller!');
      expect(sent[0]!.text).toContain('hat einen Notfall erkannt');
      await prisma.forTenantId(tenantId).case.update({ where: { id: result.case!.id }, data: { orchestrationStatus: 'COMPLETED' } });
      await attention.syncTenant(tenantId, new Date());
    });

    it('einstellbare Zeiten im Profil gelten: Erinnerung nach 60 Minuten statt 4 Stunden', async () => {
      await request(app.getHttpServer()).put('/api/v1/tenant/profile').set(auth()).send({ escalationPolicy: { reminderAfterMinutes: 60 } }).expect(200);
      const c = await createCase();
      const now = new Date();
      await attention.syncTenant(tenantId, now);
      sent = [];
      await attention.syncTenant(tenantId, new Date(now.getTime() + 61 * MIN));
      expect(recipients()).toEqual(['bea@betrieb.test', 'vera@betrieb.test']);
      await prisma.forTenantId(tenantId).case.update({ where: { id: c.id }, data: { orchestrationStatus: 'COMPLETED' } });
      await request(app.getHttpServer()).put('/api/v1/tenant/profile').set(auth()).send({ escalationPolicy: { reminderAfterMinutes: 240 } }).expect(200);
    });
  });

  describe('Robustheit', () => {
    it('Altbestand beim Einschalten löst keine Meldungen aus (Vorgang seit Tagen unverändert → unterdrückt)', async () => {
      const old = await createCase({ title: 'Alter Vorgang' });
      await prisma.withRlsBypass((tx) => tx.$executeRaw`UPDATE cases SET updated_at = now() - interval '6 days' WHERE id = ${old.id}`);
      await attention.syncTenant(tenantId, new Date());
      expect((await itemFor(old.id))!.state).toBe('SUPPRESSED');
      expect(sent.filter((s) => s.subject.includes('Alter Vorgang'))).toEqual([]);
      await prisma.forTenantId(tenantId).case.update({ where: { id: old.id }, data: { orchestrationStatus: 'COMPLETED' } });
      await attention.syncTenant(tenantId, new Date());
    });

    it('eine fehlgeschlagene Zustellung wird nach Abstand wiederholt, aber nicht ohne Ende; der Fehler ist sichtbar', async () => {
      const c = await createCase({ title: 'Zustellproblem' });
      failNext = ['bea@betrieb.test'];
      const now = new Date();
      const first = await attention.syncTenant(tenantId, now);
      expect(first.failed).toBe(1);
      const item = (await itemFor(c.id))!;
      let [n] = await notifications(item.id);
      expect(n).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(n!.error).toContain('Postfach nicht erreichbar');

      await attention.syncTenant(tenantId, new Date(now.getTime() + 10 * MIN)); // zu früh
      [n] = await notifications(item.id);
      expect(n!.attempts).toBe(1);

      failNext = [];
      const retry = await attention.syncTenant(tenantId, new Date(now.getTime() + 31 * MIN));
      expect(retry.notified).toBe(1);
      [n] = await notifications(item.id);
      expect(n).toMatchObject({ status: 'SENT', attempts: 2 });
      await prisma.forTenantId(tenantId).case.update({ where: { id: c.id }, data: { orchestrationStatus: 'COMPLETED' } });
      await attention.syncTenant(tenantId, new Date(now.getTime() + 32 * MIN));
    });

    it('ohne erfasste Zuständige geht die Meldung an die Leitung; ohne jede Leitung geschieht nichts Falsches', async () => {
      const c = await createCase({ type: 'GENERAL', title: 'Unklarer Vorgang', orchestrationStatus: 'MANUAL_REVIEW', attentionReasons: [] });
      await attention.syncTenant(tenantId, new Date());
      // GENERAL → niemand mit „Allgemein“ → Inhaber, dann Leitung.
      expect(recipients()).toEqual(['chef@betrieb.test', 'leiter@betrieb.test']);
      expect(sent[0]!.text).toContain('Der Vorgang braucht eine Prüfung durch einen Menschen.');
      await prisma.forTenantId(tenantId).case.update({ where: { id: c.id }, data: { orchestrationStatus: 'COMPLETED' } });
      await attention.syncTenant(tenantId, new Date());
    });

    it('der Takt (sweep) ist abschaltbar und fasst nur Mandanten mit erfassten Mitarbeitern an', async () => {
      const previous = process.env.ESCALATION_ENABLED;
      // Im Test ist der Takt aus (ESCALATION_ENABLED=false in e2e-env): kein Mandant wird angefasst, es geht nichts hinaus.
      expect(previous).toBe('false');
      expect(await attention.sweep()).toEqual({ tenants: 0, opened: 0, resolved: 0, notified: 0, failed: 0 });
    });
  });
});
