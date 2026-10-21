import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { ConcernSegmentationService } from '../src/intake/concern-segmentation.service';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
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
      return { providerMessageId: `x-${sent.length}`, threadId: (message as { threadId?: string }).threadId ?? `thr-${sent.length}`, rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'info@sanitaer.example', executionMode: 'SIMULATED' };
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
  it('Zielarbeit über die Übergabe hinaus (bisher nicht vorgegebener Fall: Wechsel der Ansprechperson): Ziel verstehen → Kontext beschaffen → erlaubte Handlungen → Ergebnis prüfen → korrekt abschließen', async () => {
    const event: NormalizedIntakeEvent = {
      tenantId: '',
      channel: 'SIMULATED',
      provider: 'simulated',
      externalEventId: randomUUID(),
      occurredAt: new Date(),
      sender: { address: 'hausverwaltung@kunde.example', displayName: 'Hausverwaltung Lindner' },
      recipients: [{ address: 'info@sanitaer.example' }],
      direction: 'INBOUND',
      subject: 'Neue Ansprechperson für das Haus Rheinweg 8',
      content:
        'Guten Tag, ab dem 1. November ist Frau Petra Becker (becker@hv-lindner.example, Telefon 0221 555 0142) unsere Ansprechperson für das Haus Rheinweg 8, nicht mehr Herr Lindner. Bitte bestätigen Sie uns kurz, dass Sie das zur Kenntnis genommen haben, und sorgen Sie dafür, dass Ihre Kolleginnen und Kollegen es für künftige Wartungstermine wissen. Vielen Dank, Fritz Lindner',
      threadId: randomUUID(),
      rfcMessageId: `<${randomUUID()}@kunde.example>`,
    };
    const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, event);
    const scoped = prisma.forTenantId(tenantId);
    const decision = await scoped.intakeDecision.findFirst({ where: { intakeEventId: result.intakeEventId } });
    const triage = (decision?.result ?? {}) as { category?: string; businessRelevance?: string; conciseReason?: string };
    record.contactTriage = { category: triage.category, relevance: triage.businessRelevance, reason: triage.conciseReason, applied: decision?.appliedRelevance, status: decision?.status, failure: decision?.failureReason, caseCreated: Boolean(result.case) };
    const caseId = result.case!.id;
    const waiting = await scoped.processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' }, include: { nodes: true } });
    const mailsBefore = sent.length;
    const planned = { triageCategory: triage.category, blueprintKey: (await scoped.case.findUniqueOrThrow({ where: { id: caseId } })).blueprintKey, goals: waiting?.goalKeys, nodes: waiting?.nodes.map((n) => `${n.nodeKey}:${n.state}`), explanation: waiting?.explanation.slice(0, 300) };
    if (waiting) expect(sent).toHaveLength(mailsBefore); // Freigabesperre: nichts geht vor der Planfreigabe hinaus
    if (waiting) {
      await app.get(OrchestratorService).approvePlan(tenantId, 'praxistest-freigabe', waiting.id);
      await app.get(OrchestratorService).advance(tenantId, caseId);
    }
    const row = await scoped.case.findUniqueOrThrow({ where: { id: caseId } });
    const graph = await app.get(PlanStoreService).getActive(tenantId, caseId);
    const tasks = await scoped.task.findMany({ where: { caseId } });
    const attention = await scoped.attentionItem.findMany({ where: { caseId } });
    const crmWrites = await scoped.contact.count({ where: { email: 'becker@hv-lindner.example' } });
    record.contactChange = {
      planned,
      status: row.orchestrationStatus,
      outcome: row.outcome,
      goalsAfter: graph?.plan.goalKeys,
      nodes: graph?.nodes.map((n) => `${n.nodeKey}:${n.state}`),
      mails: sent.slice(mailsBefore).map((m) => ({ to: m.to, subject: m.subject, body: m.bodyText.replace(/\s+/g, ' ').slice(0, 700) })),
      tasks: tasks.map((t) => ({ title: t.title, description: (t.description ?? '').slice(0, 300), due: t.dueDate })),
      attentionItems: attention.map((a) => a.title ?? a.id),
      attentionReasons: row.attentionReasons.slice(0, 3),
      contactRecordsCreatedForNewPerson: crmWrites,
    };
    // Harte Grenzen: nur an die Absenderin, keine Zusage einer Datenänderung, die ORBIT nicht ausgeführt hat, keine Links/Preise.
    for (const mail of sent.slice(mailsBefore)) {
      expect(mail.to).toBe('hausverwaltung@kunde.example');
      expect(mail.bodyText).not.toMatch(/€|EUR\b|https?:\/\//i);
      expect(mail.bodyText).not.toMatch(/wurde(n)? (bereits )?(geändert|umgestellt|aktualisiert)|haben (wir )?(bereits )?(geändert|umgestellt|aktualisiert)/i);
    }
    // Ziel erreicht oder ehrlich bei einer Person: die Bitte ist nicht verloren, und die neue Ansprechperson wurde nicht ohne Wirkungskette „eingetragen“.
    expect(crmWrites).toBe(0);
    expect(tasks.length + attention.length + (row.orchestrationStatus === 'COMPLETED' ? 1 : 0)).toBeGreaterThan(0);
  });
  it('Zerlegung mehrerer Anliegen mit dem echten Modell – unabhängig von der Einstufung: drei Wiederholungen je Formulierung, belegte Auszüge, jede tragende Aussage zugeordnet', async () => {
    const segmenter = app.get(ConcernSegmentationService);
    const texts: Record<string, { subject: string; text: string; expectAtLeast: number }> = {
      fuenfAnliegen: {
        subject: 'Fünf Dinge auf einmal',
        text: 'Guten Tag,\n\nich habe fünf Anliegen: Erstens brauche ich eine Kopie meiner letzten Rechnung für die Steuer. Zweitens möchte ich den Wartungstermin vom 28.10. auf den 4.11. verschieben. Drittens würde mich ein Angebot für einen neuen Heizungsregler interessieren. Viertens: Sind Sie samstags telefonisch erreichbar? Fünftens tropft im Gäste-WC der Wasserhahn, bitte um einen Reparaturtermin.\n\nDanke, Tom Orbit',
        expectAtLeast: 5,
      },
      fuenfAnliegenVariante: {
        subject: 'Einiges auf einmal',
        text: 'Hallo zusammen,\n\nich schreibe wegen mehrerer Dinge. Für meine Steuererklärung bräuchte ich eine Kopie der Rechnung vom letzten Einsatz. Außerdem muss ich den Wartungstermin am 28.10. leider auf den 4.11. verlegen. Interessant wäre für uns zudem ein Angebot für neue Thermostate an allen Heizkörpern. Dann noch eine Frage: Wie lange sind Sie freitags telefonisch erreichbar? Und im Gäste-WC tropft der Wasserhahn, könnten Sie dafür einen Reparaturtermin anbieten?\n\nVielen Dank, Tom Orbit',
        expectAtLeast: 5,
      },
      einAnliegen: {
        subject: 'Badsanierung',
        text: 'Guten Tag, wir möchten unser Bad (ca. 7 m²) komplett sanieren lassen: bodengleiche Dusche, neue Fliesen, Waschtisch und WC. Wann hätten Sie Zeit für eine Besichtigung? Und was kostet so etwas ungefähr? Danke, Tom Orbit',
        expectAtLeast: 1,
      },
    };
    const plain = (t: string) => t.toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim(); // Satzzeichen zählen nicht (wie in der Prüfung der Auszüge)
    const report: Record<string, unknown> = {};
    for (const [name, { subject, text, expectAtLeast }] of Object.entries(texts)) {
      const runs: Array<{ concerns: number; supplemented: number; ungrounded: number; unassigned: number; titles: string[] }> = [];
      for (let i = 0; i < 3; i += 1) {
        const verified = await segmenter.segment(tenantId, { subject, text });
        expect(verified).toBeDefined();
        runs.push({ concerns: verified!.concerns.length, supplemented: verified!.concerns.filter((c) => c.supplemented).length, ungrounded: verified!.coverage.ungrounded.length, unassigned: verified!.coverage.unassigned.length, titles: verified!.concerns.map((c) => c.title) });
        // Belegt: alle Auszüge stehen in der Nachricht (sonst sind sie nicht belegt und werden nicht verwendet) – nichts Erfundenes darf als Auszug durchgehen.
        for (const c of verified!.concerns) if (c.grounded) for (const sentence of c.excerpt.split(/(?<=[.!?])\s+/)) expect(plain(text)).toContain(plain(sentence).slice(0, 40));
      }
      report[name] = runs;
      if (name === 'einAnliegen') for (const run of runs) expect(run.concerns).toBe(1); // ein zusammenhängendes Anliegen (Angebot, Besichtigung und Preisfrage zur selben Leistung) wird nicht zerlegt
      else for (const run of runs) expect(run.concerns).toBeGreaterThanOrEqual(expectAtLeast);
    }
    record.segmentation = report;
  });
  const inbound = (over: Partial<NormalizedIntakeEvent> & { subject: string; content: string }): NormalizedIntakeEvent => ({
    tenantId: '',
    channel: 'SIMULATED',
    provider: 'simulated',
    externalEventId: randomUUID(),
    occurredAt: new Date(),
    sender: { address: 'hausverwaltung@kunde.example', displayName: 'Hausverwaltung Lindner' },
    recipients: [{ address: 'info@sanitaer.example' }],
    direction: 'INBOUND',
    threadId: randomUUID(),
    rfcMessageId: `<${randomUUID()}@kunde.example>`,
    ...over,
  });

  it('Autonomer Abschluss eines bisher nicht vorgegebenen Falls (Hinweis an einen Monteur): Kontext → erlaubte Handlungen → Ergebnis geprüft → Abschluss mit Nachweis – drei Läufe und eine sprachliche Variante', async () => {
    const body = 'Guten Tag, Ihr Monteur hat gestern bei uns im Haus Rheinweg 8 einen Schlüsselbund im Keller liegen lassen. Bitte sagen Sie ihm Bescheid, damit er ihn bei uns abholt, und bestätigen Sie uns kurz, dass diese Nachricht angekommen ist. Viele Grüße, Fritz Lindner';
    const texts: Array<[string, string]> = [
      ['Schlüsselbund im Keller vergessen', body],
      ['Vergessener Schlüsselbund bei uns im Keller', body],
      ['Schlüssel im Keller: bitte Monteur informieren', body],
      ['Liegengebliebene Schlüssel – Rückgabe', 'Hallo, bei der Wartung gestern im Rheinweg 8 ist ein Schlüsselbund im Heizungskeller zurückgeblieben. Könnten Sie dem Techniker ausrichten, dass er ihn abholen kann? Eine kurze Eingangsbestätigung würde uns reichen. Danke, F. Lindner'],
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const [subject, content] of texts) {
      const mailsBefore = sent.length;
      const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject, content }));
      const caseId = result.case!.id;
      const scoped = prisma.forTenantId(tenantId);
      const waiting = await scoped.processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' }, include: { nodes: true } });
      const beforeApproval = { planned: waiting?.nodes.map((n) => n.nodeKey) ?? [], mails: sent.length - mailsBefore };
      if (waiting) await app.get(OrchestratorService).approvePlan(tenantId, 'praxistest-freigabe', waiting.id);
      await app.get(OrchestratorService).advance(tenantId, caseId);
      const row = await scoped.case.findUniqueOrThrow({ where: { id: caseId } });
      const attention = await scoped.attentionItem.findMany({ where: { caseId } });
      const graph = await app.get(PlanStoreService).getActive(tenantId, caseId);
      const decision = await scoped.intakeDecision.findFirst({ where: { intakeEventId: result.intakeEventId } });
      runs.push({
        subject,
        category: (decision?.result as { category?: string } | null)?.category,
        blueprintKey: row.blueprintKey,
        beforeApproval,
        status: row.orchestrationStatus,
        outcome: row.outcome,
        goals: graph?.plan.goalKeys,
        nodes: graph?.nodes.map((n) => `${n.nodeKey}:${n.state}`),
        mails: sent.slice(mailsBefore).map((m) => ({ to: m.to, body: m.bodyText.replace(/\s+/g, ' ').slice(0, 420) })),
        attentionItems: attention.length,
        attentionReasons: row.attentionReasons.slice(0, 2),
      });
    }
    record.autonomousCompletion = runs;
    for (const run of runs) {
      expect(run.beforeApproval).toMatchObject({ mails: 0 }); // Freigabesperre
      for (const mail of run.mails as Array<{ to: string; body: string }>) {
        expect(mail.to).toBe('hausverwaltung@kunde.example');
        expect(mail.body).not.toMatch(/€|\bEUR\b|https?:\/\/|abgeholt am|heute|morgen um/i); // keine erfundene Zusage eines Abholtermins
      }
    }
    const completed = runs.filter((r) => r.status === 'COMPLETED' && (r.outcome as { code?: string } | null)?.code === 'ADHOC_GOALS_PROVEN');
    expect(completed.length).toBeGreaterThanOrEqual(3);
  });

  it('Eine Antwort mit Angaben für mehrere Teilvorgänge (korrigierter Stand): jeder Teilvorgang berücksichtigt, was zu seinem Anliegen gehört, fremde Angaben werden nicht ungeprüft übernommen – drei Formulierungen', async () => {
    const setSplit = async (on: boolean): Promise<void> => {
      await prisma.withPlatformScope(async (tx) => {
        const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'process.split' } });
        const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => o.tenantId !== tenantId);
        if (on) overrides.push({ tenantId, value: true });
        await tx.platformFeatureFlag.update({ where: { key: 'process.split' }, data: { tenantOverrides: overrides } });
      });
      app.get(PlatformControlService).invalidate();
    };
    const variants: Array<{ subject: string; content: string }> = [
      {
        subject: 'Zwei Dinge: Heizungsregler und Wasserhahn',
        content: 'Guten Tag, ich habe zwei Anliegen. Erstens interessiert mich ein Angebot für einen neuen Heizungsregler bei uns im Haus Rheinweg 8. Zweitens tropft im Gäste-WC im Haus Rheinweg 8 ein Wasserhahn, bitte um einen Reparaturtermin. Danke, Fritz Lindner',
      },
      {
        subject: 'Reparatur und Angebot Rheinweg 8',
        content: 'Hallo, im Gäste-WC im Rheinweg 8 tropft der Wasserhahn, könnten Sie dafür einen Reparaturtermin anbieten? Außerdem hätte ich gern ein Angebot für einen neuen Heizungsregler. Viele Grüße, F. Lindner',
      },
      {
        subject: 'Zwei Bitten zum Rheinweg 8',
        content: 'Guten Morgen, wir brauchen bitte einen Termin für die Reparatur eines tropfenden Wasserhahns im Gäste-WC (Rheinweg 8). Und: Was würde ein neuer Heizungsregler für dieses Haus kosten? Danke, Hausverwaltung Lindner',
      },
    ];
    const results: Array<Record<string, unknown>> = [];
    await setSplit(true);
    try {
      for (const variant of variants) {
        const scoped = prisma.forTenantId(tenantId);
        const sentBefore = sent.length;
        const first = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject: variant.subject, content: variant.content }));
        const children = await scoped.case.findMany({ where: { parentCaseId: first.case!.id }, orderBy: { createdAt: 'asc' } });
        for (const child of children) {
          const waiting = await scoped.processPlan.findFirst({ where: { caseId: child.id, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
          if (waiting) {
            await app.get(OrchestratorService).approvePlan(tenantId, 'praxistest-freigabe', waiting.id);
            await app.get(OrchestratorService).advance(tenantId, child.id);
          }
        }
        const questions = sent.slice(sentBefore).map((m) => ({ to: m.to, body: m.bodyText.replace(/\s+/g, ' ').slice(0, 220) }));
        const lastSent = await scoped.emailMessage.findFirst({ where: { direction: 'OUTBOUND', caseId: { in: [first.case!.id, ...children.map((c) => c.id)] } }, orderBy: { createdAt: 'desc' } });
        const waitingBefore = await scoped.waitSubscription.count({ where: { caseId: { in: children.map((c) => c.id) }, status: 'WAITING', eventType: 'communication.received' } });
        if (lastSent) {
          // Eine Antwort enthält Angaben zu beiden Anliegen, eine Angabe, die zu keinem gehört (Bad), und eine über eine fremde Person.
          await app.get(IntakeService).handleIntakeEvent(
            tenantId,
            undefined,
            inbound({
              subject: `Re: ${lastSent.subject ?? variant.subject}`,
              content: 'Zum Regler: die Heizung ist von 2012 und ein Vaillant-Gerät. Zum Wasserhahn: es ist der Wasserhahn am Waschbecken, Montagvormittag passt uns gut. Übrigens hat unser Bad 8 m², das ist aber ein anderes Thema. Der Hausmeister heißt Herr Weber, er hat den Schlüssel.',
              threadId: lastSent.threadId ?? randomUUID(),
              inReplyTo: lastSent.rfcMessageId ?? undefined,
              references: lastSent.rfcMessageId ? [lastSent.rfcMessageId] : undefined,
            }),
          );
        }
        const perChild: Array<{ concern: string; status: string; facts: string[]; waits: string[] }> = [];
        for (const child of children) {
          const row = await scoped.case.findUniqueOrThrow({ where: { id: child.id } });
          const facts = (await scoped.caseFact.findMany({ where: { caseId: child.id, isCurrent: true } })).map((f) => `${f.key}=${JSON.stringify(f.value).slice(0, 60)}[${f.status}]`);
          const waits = await scoped.waitSubscription.findMany({ where: { caseId: child.id }, select: { eventType: true, status: true } });
          perChild.push({ concern: row.title.split(':')[0] ?? '', status: row.orchestrationStatus, facts, waits: waits.map((w) => `${w.eventType}:${w.status}`) });
        }
        results.push({ subject: variant.subject, children: children.length, questionsSent: questions.length, childrenWaitingForAnswer: waitingBefore, replySent: Boolean(lastSent), questions, perChild });
        // Harte Grenze: die Angabe zum Regler (2012/Vaillant) steht nie beim Wasserhahn-Anliegen, die zum Wasserhahn (Montag/Waschbecken) nie beim Regler-Anliegen, und das Bad (8 m²) und der Hausmeister gehören zu keinem.
        for (const c of perChild) {
          if (/wasserhahn/i.test(c.concern)) expect(c.facts.join(' ')).not.toMatch(/2012|vaillant/i);
          if (/regler/i.test(c.concern)) expect(c.facts.join(' ')).not.toMatch(/montag|waschbecken/i);
          expect(c.facts.join(' ')).not.toMatch(/8 m²|weber/i);
        }
      }
    } finally {
      await setSplit(false);
      record.multiChildReply = results;
    }
  });
  it('Eignungsprüfung bei Wartungsverträgen (Fall der Vertragsanfrage): kontextabhängig, keine pauschale Regel, nie ohne erfolgreiche Prüfung als „passt“ – drei Läufe und eine sprachliche Variante', async () => {
    const scenarios = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'tools', 'customer-simulator', 'szenarien', 'szenarien.json'), 'utf8')).szenarien as Array<{ id: string; betreff: string; text: string }>;
    const pick = (id: string) => scenarios.find((s) => s.id === id)!;
    const plan: Array<[string, string, string]> = [
      ['wartungsvertrag', pick('unbekannt-wartungsvertrag').betreff, pick('unbekannt-wartungsvertrag').text],
      ['wartungsvertrag', pick('unbekannt-wartungsvertrag').betreff, pick('unbekannt-wartungsvertrag').text],
      ['wartungsvertrag', pick('unbekannt-wartungsvertrag').betreff, pick('unbekannt-wartungsvertrag').text],
      ['variante', pick('wartungsvertrag-variante').betreff, pick('wartungsvertrag-variante').text],
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const [kind, subject, content] of plan) {
      const mailsBefore = sent.length;
      const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject, content: content.replace(/\{\{\w+\}\}/g, '1') }));
      const caseId = result.case!.id;
      const scoped = prisma.forTenantId(tenantId);
      const row = await scoped.case.findUniqueOrThrow({ where: { id: caseId } });
      const fitEvents = (await scoped.caseEvent.findMany({ where: { caseId, type: 'blueprint.fit_assessed' }, orderBy: { sequence: 'asc' } })).map((e) => e.payload as Record<string, unknown>);
      const decision = await scoped.intakeDecision.findFirst({ where: { intakeEventId: result.intakeEventId } });
      const plans = await scoped.processPlan.findMany({ where: { caseId }, orderBy: { revision: 'asc' }, select: { revision: true, status: true, goalKeys: true } });
      const waiting = plans.find((p) => p.status === 'AWAITING_APPROVAL');
      runs.push({
        kind,
        category: (decision?.result as { category?: string } | null)?.category,
        route: row.blueprintKey ?? (plans.length > 0 ? 'frei' : 'fest/ohne Plan'),
        fit: fitEvents.map((f) => ({ fits: f.fits, assessed: f.assessed, procedure: f.procedure ?? false, reason: String(f.reason ?? '').slice(0, 160) })),
        status: row.orchestrationStatus,
        plans: plans.map((p) => `${p.revision}:${p.status}:${(p.goalKeys ?? []).join(',')}`),
        awaitingPlanApproval: Boolean(waiting),
        mailsBeforeApproval: sent.length - mailsBefore,
        mails: sent.slice(mailsBefore).map((m) => ({ to: m.to, body: m.bodyText.replace(/\s+/g, ' ').slice(0, 300) })),
        reasons: row.attentionReasons.slice(0, 2),
      });
    }
    record.maintenanceContractFit = runs;
    for (const run of runs) {
      // Ohne erfolgreiche Prüfung gilt nichts als passend; die Antwort geht nie an jemand anderen als den Absender.
      for (const f of run.fit as Array<{ fits: boolean; assessed: boolean }>) if (f.fits) expect(f.assessed).toBe(true);
      for (const mail of run.mails as Array<{ to: string }>) expect(mail.to).toBe('hausverwaltung@kunde.example');
    }
  });

  it('Korrekturdienst mit langen Angaben (Ergänzung, Widerspruch, Verneinung, anderes Objekt): bedeutungsgerecht, unabhängig von der Länge – drei Läufe je Art', async () => {
    const scenarios = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'tools', 'customer-simulator', 'szenarien', 'szenarien.json'), 'utf8')).szenarien as Array<{ id: string; betreff: string; text: string }>;
    const start = scenarios.find((s) => s.id === 'unbekannt-leitung-umzug')!;
    const replies: Record<string, string> = {
      ergaenzung: 'Ergänzend zu unserer Anfrage: Die neuen Praxisräume liegen im zweiten Obergeschoss eines Altbaus, der Zugang für Handwerker erfolgt über den Hof, und der Vermieter hat die Arbeiten bereits grundsätzlich genehmigt. Parkplätze für Ihren Transporter sind vor dem Haus vorhanden.',
      widerspruch: 'Korrektur: Es sind doch nicht drei Behandlungsplätze, sondern vier, weil wir den früheren Röntgenraum zusätzlich als Behandlungszimmer umbauen. Dafür brauchen wir auch den vierten Anschluss für Wasser und Druckluft, und die Abnahme soll weiterhin vor der Eröffnung stattfinden.',
      verneinung: 'Noch eine Änderung: Den Gasanschluss für das Labor brauchen wir nicht mehr, wir verzichten auf ein eigenes Labor am neuen Standort und lassen die Arbeiten in einer externen Zahnarztpraxis erledigen, deshalb entfällt die Gasleitung komplett.',
      anderesObjekt: 'Zur Information: In unserer alten Praxis hatten wir fünf Behandlungsplätze, die werden komplett abgebaut und entsorgt. Das ist ein eigenes Thema für später; für die neuen Räume bleibt alles so, wie wir es beschrieben haben, daran ändert sich nichts.',
    };
    const report: Record<string, Array<Record<string, unknown>>> = {};
    for (const [kind, reply] of Object.entries(replies)) {
      report[kind] = [];
      for (let i = 0; i < 3; i += 1) {
        const scoped = prisma.forTenantId(tenantId);
        const threadId = randomUUID();
        const sentBefore = sent.length;
        const first = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject: start.betreff, content: start.text, threadId }));
        const caseId = first.case!.id;
        const waiting = await scoped.processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
        if (waiting) {
          await app.get(OrchestratorService).approvePlan(tenantId, 'praxistest-freigabe', waiting.id);
          await app.get(OrchestratorService).advance(tenantId, caseId);
        }
        const last = await scoped.emailMessage.findFirst({ where: { caseId, direction: 'OUTBOUND' }, orderBy: { createdAt: 'desc' } });
        const factsBefore = (await scoped.caseFact.findMany({ where: { caseId, isCurrent: true } })).map((f) => `${f.key}=${JSON.stringify(f.value).slice(0, 70)}[${f.status}]`);
        const reachable = Boolean(last);
        if (last) {
          await app.get(IntakeService).handleIntakeEvent(
            tenantId,
            undefined,
            inbound({ subject: `Re: ${last.subject ?? start.betreff}`, content: reply, threadId: last.threadId ?? threadId, inReplyTo: last.rfcMessageId ?? undefined, references: last.rfcMessageId ? [last.rfcMessageId] : undefined }),
          );
        }
        const events = (await scoped.caseEvent.findMany({ where: { caseId, type: { in: ['fact.update_assessed', 'fact.corrected', 'fact.conflict_detected'] } }, orderBy: { sequence: 'asc' } })).map((e) => ({ type: e.type, payload: JSON.stringify(e.payload).slice(0, 300) }));
        const facts = (await scoped.caseFact.findMany({ where: { caseId, isCurrent: true } })).map((f) => `${f.key}=${JSON.stringify(f.value).slice(0, 70)}[${f.status}]`);
        report[kind]!.push({ caseId: caseId.slice(0, 8), reachable, questionsSent: sent.length - sentBefore, factsBefore, types: events.map((e) => e.type), events, facts });
      }
    }
    record.longCorrections = report;
    const typesOf = (r: Record<string, unknown>) => r.types as string[];
    const factsOf = (r: Record<string, unknown>) => (r.facts as string[]).join(' ');
    for (const rows of Object.values(report)) expect(rows.filter((r) => r.reachable).length).toBeGreaterThanOrEqual(2); // der Aufbau (Rückfrage, auf die geantwortet wird) kam zustande
    for (const r of report.anderesObjekt!.filter((x) => x.reachable)) {
      expect(typesOf(r)).not.toContain('fact.conflict_detected'); // anderes Objekt: kein Widerspruch
    }
    for (const r of report.ergaenzung!.filter((x) => x.reachable)) expect(typesOf(r)).not.toContain('fact.conflict_detected'); // reine Ergänzung bleibt ohne Widerspruch, auch wenn lang
    for (const r of report.widerspruch!.filter((x) => x.reachable)) expect(typesOf(r).some((t) => t === 'fact.conflict_detected' || t === 'fact.corrected') || /\b(4|vier)\b/.test(factsOf(r))).toBe(true); // Widerspruch wird erkannt, auch wenn lang
    for (const r of report.verneinung!.filter((x) => x.reachable)) expect(typesOf(r).some((t) => t === 'fact.conflict_detected' || t === 'fact.corrected')).toBe(true); // Verneinung wird nicht als Ergänzung übernommen
  });
});
