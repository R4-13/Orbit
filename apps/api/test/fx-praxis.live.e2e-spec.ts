import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';
import { E2E_PASSWORD } from './utils/e2e-role-tenant';

const LIVE = process.env.LIVE_AI === '1';
const OUT = process.env.PRAXIS_OUT;

/**
 * Praxistests mit dem ECHTEN Modell in einem eigenen Test-Betrieb (nie in Musterwerk), nur mit `LIVE_AI=1`:
 *  1. Sonde über die HTTP-Schnittstelle (Controller → Laufzeit → Werkzeug): Erinnerung wenige Minuten voraus – die Zeit verstreicht tatsächlich, die Datenbankfrist wird nicht verändert; der
 *     Worker (Container) führt die fällige Aktion aus. Bewertet: richtig verstandener Zeitpunkt samt Zeitzone, keine vorzeitige Aktion, genau eine Aktion, Abschlussnachweis.
 *  2. Sonde: „Prüfe bis morgen …“ muss die Prüfung als Ziel behalten (kein Erinnerungsablauf).
 *  3. Eine bisher nicht vorgegebene Vorgangsart ohne neuen prozessspezifischen Code.
 * Der Versand ist ein Double (nichts verlässt den Testprozess). Ergebnisse stehen in `PRAXIS_OUT` (JSON).
 */
(LIVE ? describe : describe.skip)('Praxistests mit dem echten Modell (live)', () => {
  jest.setTimeout(900_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  const sent: Array<{ to: string; subject: string; bodyText: string }> = [];
  const record: Record<string, unknown> = {};
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Praxis Live ${suffix.slice(0, 6)}`, slug: `e2e-praxis-live-${suffix}`, adminEmail: `admin-${suffix}@e2e-praxis.example`, adminPassword: E2E_PASSWORD, adminFirstName: 'E2E', adminLastName: 'Admin', industry: 'Heizung und Sanitär', automationPreset: 'BALANCED' });
    tenantId = tenant.id;
    const scoped = prisma.forTenantId(tenantId);
    await prisma.withRlsBypass((tx) => tx.tenant.update({ where: { id: tenantId }, data: { timezone: 'Europe/Berlin' } }));
    await scoped.integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'info@sanitaer.example', grantedCapabilities: ['email.read', 'email.send'] } });
    await scoped.tenantProfile.update({
      where: { tenantId },
      data: { description: 'Meisterbetrieb für Heizung und Sanitär in Köln.', services: ['Heizungswartung', 'Badsanierung', 'Rohrreinigung', 'Gasinstallation'], exclusions: ['Elektroarbeiten'], serviceArea: 'Köln und Umgebung (30 km)', emergencyService: true, languages: ['de'] },
    });
    const staff = (firstName: string, lastName: string, roleKind: string, email: string, responsibilities: string[]) => scoped.staffMember.create({ data: { tenantId, firstName, lastName, roleKind, email, responsibilities, preferredChannel: 'EMAIL' } as never });
    await staff('Clara', 'Chef', 'OWNER', 'chef@sanitaer.example', ['GENERAL', 'COMPLAINTS', 'EMERGENCY']);
    await staff('Vera', 'Büro', 'OFFICE', 'vera@sanitaer.example', ['GENERAL', 'APPOINTMENTS']);
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push(message as never);
      return { providerMessageId: `x-${sent.length}`, from: 'info@sanitaer.example', executionMode: 'SIMULATED' };
    });
    token = ((await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: E2E_PASSWORD }).expect(200)).body.accessToken as string);
  }, 180_000);

  afterAll(async () => {
    if (OUT) writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  async function sonde(content: string): Promise<{ answer: string; toolCalls: string[] }> {
    const conversation = (await api().post('/api/v1/copilot/conversations').set('Authorization', `Bearer ${token}`).send({ title: 'Praxistest' }).expect(201)).body as { id: string };
    const response = await api().post(`/api/v1/copilot/conversations/${conversation.id}/messages`).set('Authorization', `Bearer ${token}`).send({ content, mode: 'ACT' }).expect(201);
    const calls = await prisma.forTenantId(tenantId).toolInvocation.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { toolName: true, status: true } });
    return { answer: (response.body as { content: string }).content, toolCalls: calls.map((c) => `${c.toolName}:${c.status}`) };
  }
  const orderCases = () => prisma.forTenantId(tenantId).case.findMany({ where: { caseEvents: { some: { type: 'order.created' } } }, orderBy: { createdAt: 'asc' } });

  it('Sonde: „Erinnere uns in 5 Minuten …“ → richtig verstandene Zeit, keine vorzeitige Aktion, genau eine fällige Aktion, Abschlussnachweis (Zeit verstreicht tatsächlich)', async () => {
    const askedAt = new Date();
    const berlin = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(askedAt);
    const result = await sonde('Erinnere uns in 5 Minuten daran, die Wartung der Heizung bei Familie Meier zu bestätigen.');
    const [order] = await orderCases();
    expect(order).toBeDefined();
    const created = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: order!.id, type: 'order.created' } });
    const payload = created.payload as { kind: string; remindAt: string | null; dueAt: string | null; timeZone: string };
    const wait = await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: order!.id } });
    const minutesAhead = (wait.deadlineAt!.getTime() - askedAt.getTime()) / 60_000;
    record.reminder = { askedAtBerlin: berlin, sondeAnswer: result.answer.slice(0, 400), kind: payload.kind, remindAt: payload.remindAt, timeZone: payload.timeZone, minutesAhead: Math.round(minutesAhead * 10) / 10, toolCalls: result.toolCalls };
    expect(payload.kind).toBe('REMINDER');
    expect(payload.dueAt).toBeNull();
    expect(payload.timeZone).toBe('Europe/Berlin');
    expect(minutesAhead).toBeGreaterThan(3.5);
    expect(minutesAhead).toBeLessThan(6.5);

    // Zeit verstreichen lassen – die Datenbankfrist wird NICHT verändert. Vor dem Zeitpunkt darf nichts geschehen.
    const dueAt = wait.deadlineAt!.getTime();
    let earlyAction = false;
    while (Date.now() < dueAt - 5_000) {
      const items = await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: order!.id } });
      const status = (await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: order!.id } })).orchestrationStatus;
      if (items > 0 || status === 'COMPLETED') earlyAction = true;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    expect(earlyAction).toBe(false);

    // Nach dem Zeitpunkt führt der Worker (Sweep) die fällige Aktion aus – bis zu 5 Minuten Toleranz.
    const deadline = Date.now() + 5 * 60_000;
    let status = '';
    while (Date.now() < deadline) {
      status = (await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: order!.id } })).orchestrationStatus;
      if (status === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    const firedAt = (await prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId: order!.id, type: 'wait.satisfied' } }))?.createdAt;
    const items = await prisma.forTenantId(tenantId).attentionItem.findMany({ where: { caseId: order!.id } });
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: order!.id } });
    Object.assign(record.reminder as object, { status, firedAt, delaySecondsAfterDue: firedAt ? Math.round((firedAt.getTime() - dueAt) / 1000) : null, attentionItems: items.length, outcome: row.outcome, outboundMails: sent.length });
    expect(status).toBe('COMPLETED');
    expect(items).toHaveLength(1);
    expect(row.outcome).toMatchObject({ code: 'ADHOC_GOALS_PROVEN' });
    expect(sent).toHaveLength(0);
  });

  it('Sonde: „Prüfe bis morgen …“ behält die Prüfung als Ziel – kein Erinnerungsablauf, Fälligkeit in Ortszeit richtig verstanden', async () => {
    const result = await sonde('Prüfe bis morgen 10 Uhr, ob das Angebot von Müller für die Gasleitung vollständig ist.');
    const orders = await orderCases();
    const order = orders.at(-1)!;
    expect(orders.length).toBeGreaterThanOrEqual(2);
    const created = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: order.id, type: 'order.created' } });
    const payload = created.payload as { kind: string; remindAt: string | null; dueAt: string | null; timeZone: string };
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const expected = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
    const dueLocal = payload.dueAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(payload.dueAt)) : null;
    const waits = await prisma.forTenantId(tenantId).waitSubscription.count({ where: { caseId: order.id } });
    const plan = await app.get(PlanStoreService).getActive(tenantId, order.id);
    const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: order.id } });
    const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { caseId: order.id } });
    record.task = { sondeAnswer: result.answer.slice(0, 400), kind: payload.kind, dueAt: payload.dueAt, dueLocalBerlin: dueLocal, expectedDate: expected, waits, goals: plan?.plan.goalKeys, nodes: plan?.nodes.map((n) => `${n.nodeKey}:${n.state}`), status: row.orchestrationStatus, tasks: tasks.map((t) => ({ title: t.title, due: t.dueDate })) };
    expect(payload.kind).toBe('TASK');
    expect(payload.remindAt).toBeNull();
    expect(dueLocal).toBe(`${expected} 10:00`);
    expect(waits).toBe(0); // keine Erinnerungsprozedur
    expect(row.completedAt).toBeNull(); // die Prüfung ist nicht erledigt, nur weil eine Frist gesetzt wurde
  });

  it('eine bisher nicht vorgegebene Vorgangsart wird ohne neuen prozessspezifischen Code bearbeitet: vorhandene prüfbare Ergebnisse kombiniert, Wirkung nach außen erst nach Planfreigabe, begründete Übergabe wo die Abschlussprüfung fehlt', async () => {
    const event: NormalizedIntakeEvent = {
      tenantId: '',
      channel: 'SIMULATED',
      provider: 'simulated',
      externalEventId: randomUUID(),
      occurredAt: new Date(),
      sender: { address: 'hausverwaltung@kunde.example', displayName: 'Hausverwaltung Lindner' },
      recipients: [{ address: 'info@sanitaer.example' }],
      direction: 'INBOUND',
      subject: 'Bescheinigung für unseren Versicherer',
      content:
        'Guten Tag, nach der Reparatur der Gasleitung im Haus Rheinweg 8 verlangt unser Versicherer eine schriftliche Bescheinigung Ihres Betriebs, dass die Leitung dicht und betriebssicher übergeben wurde. Wir brauchen sie bis kommenden Freitag. Bitte bestätigen Sie uns kurz den Eingang dieser Bitte und sagen Sie uns, wer bei Ihnen dafür zuständig ist. Vielen Dank, Fritz Lindner',
      threadId: randomUUID(),
      rfcMessageId: `<${randomUUID()}@kunde.example>`,
    };
    const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, event);
    const caseId = result.case!.id;
    const scoped = prisma.forTenantId(tenantId);
    const decision = await scoped.intakeDecision.findFirst({ where: { intakeEventId: result.intakeEventId } });
    const triage = (decision?.result ?? {}) as { category?: string; urgency?: string; conciseReason?: string };
    const waiting = await scoped.processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' }, include: { nodes: true } });
    const before = {
      triageCategory: triage.category,
      caseStatus: (await scoped.case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus,
      planAwaitingApproval: Boolean(waiting),
      goals: waiting?.goalKeys,
      nodes: waiting?.nodes.map((n) => `${n.nodeKey}:${n.state}`),
      mailsBeforeApproval: sent.length,
    };
    record.unknownBefore = before;
    // Freigabesperre: solange der Plan Wirkungen nach außen enthält, geht nichts hinaus.
    if (waiting) expect(sent).toHaveLength(0);

    // Die berechtigte Person bestätigt den Plan (isolierter Testvorgang); danach laufen die Schritte mit ihren eigenen Regeln.
    if (waiting) {
      await app.get(OrchestratorService).approvePlan(tenantId, 'praxistest-freigabe', waiting.id);
      await app.get(OrchestratorService).advance(tenantId, caseId);
    }
    const row = await scoped.case.findUniqueOrThrow({ where: { id: caseId } });
    const graph = await app.get(PlanStoreService).getActive(tenantId, caseId);
    const attention = await scoped.attentionItem.findMany({ where: { caseId } });
    const tasks = await scoped.task.findMany({ where: { caseId } });
    record.unknownAfter = {
      status: row.orchestrationStatus,
      goals: graph?.plan.goalKeys,
      nodes: graph?.nodes.map((n) => `${n.nodeKey}:${n.state}`),
      attentionItems: attention.length,
      tasks: tasks.length,
      mails: sent.map((m) => ({ to: m.to, subject: m.subject, body: m.bodyText.replace(/\s+/g, ' ').slice(0, 600) })),
      attentionReasons: row.attentionReasons.slice(0, 3),
      outcome: row.outcome,
      replanUnavailable: (await scoped.caseEvent.findMany({ where: { caseId, type: 'plan.replan_unavailable' }, select: { payload: true } })).map((e) => e.payload),
      revisions: (await scoped.processPlan.findMany({ where: { caseId }, orderBy: { revision: 'asc' }, select: { revision: true, status: true, goalKeys: true, explanation: true } })).map((p) => ({ ...p, explanation: p.explanation.slice(0, 300) })),
      rejectedPlanIssues: (await scoped.processPlan.findMany({ where: { caseId, status: 'REJECTED' }, select: { validation: true } })).map((p) => ((p.validation as { issues?: Array<{ severity: string; code: string; message: string }> } | null)?.issues ?? []).filter((i) => i.severity === 'ERROR').map((i) => `${i.code}: ${i.message}`.slice(0, 220))),
    };
    // Harte Grenzen: nichts an Fremde, keine Zusagen/Preise/Links.
    for (const mail of sent) {
      expect(mail.to).toBe('hausverwaltung@kunde.example');
      expect(mail.bodyText).not.toMatch(/€|EUR\b|garantier|bescheinigen wir hiermit|https?:\/\//i);
    }
    // Ergebnis: die Bitte ist nicht verloren – entweder mit Nachweis erledigt oder mit Grund bei einer Person (dann steht eine Aufgabe oder ein Hinweis bereit).
    expect(attention.length + tasks.length + (row.orchestrationStatus === 'COMPLETED' ? 1 : 0)).toBeGreaterThan(0);
  });
});
