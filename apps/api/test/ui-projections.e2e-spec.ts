import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ActivityFeed, DashboardSnapshot, ApprovalDetail, ApprovalQueueItem, CaseListResponse, InboxDetail, InboxListResponse, LeadListResponse, TaskListResponse } from '@orbit/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/** UI/UX v2: die Lese-Projektionen der Module (Posteingang, Freigaben, Aktivitäten, Vorgänge, Aufgaben) gegen die echte Datenbank. */
describe('UI projections (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let otherToken: string;
  const tenants: string[] = [];
  const ids: Record<string, string> = {};

  async function bootstrapTenant(label: string): Promise<{ tenantId: string; token: string }> {
    const suffix = randomUUID();
    const email = `admin-${suffix}@e2e-${label}.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Musterwerk ${label} ${suffix.slice(0, 6)}`, slug: `e2e-${label}-${suffix}`, adminEmail: email, adminPassword: 'Musterwerk#2026!', adminFirstName: 'Anna', adminLastName: 'Beispiel' });
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' });
    return { tenantId: tenant.id, token: login.body.accessToken as string };
  }

  const get = (path: string, t = token) => request(app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${t}`);
  const day = 24 * 3600 * 1000;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    ({ tenantId, token } = await bootstrapTenant('proj'));
    ({ token: otherToken } = await bootstrapTenant('proj-other'));
    const db = prisma.forTenantId(tenantId);

    // Finanzen: Rechnung mit geänderter Bankverbindung + Freigabe.
    const supplier = await db.supplier.create({ data: { tenantId, name: 'Stahl AG', iban: 'DE89370400440532013000' } });
    const invoice = await db.invoice.create({ data: { tenantId, supplierId: supplier.id, invoiceNumber: 'R-77', status: 'BANK_CHANGE_SUSPECTED', amountGross: 1190, currency: 'EUR', extractedData: { supplierIban: 'DE02120300000000202051' } } });
    ids.invoice = invoice.id;
    const bankApproval = await db.approval.create({ data: { tenantId, entityType: 'INVOICE', entityId: invoice.id, policyAction: 'invoice.bank_change_review' } });
    ids.bankApproval = bankApproval.id;

    // Vertrieb: Vorgang mit Prozess, wartet auf Freigabe einer vorbereiteten Antwort.
    const waiting = await db.case.create({ data: { tenantId, type: 'SALES', title: 'Anfrage Fenster Müller', orchestrationStatus: 'WAITING_FOR_APPROVAL', blueprintKey: 'rfq' } });
    ids.waitingCase = waiting.id;
    const intent = await db.actionIntent.create({
      data: { tenantId, caseId: waiting.id, planId: randomUUID(), planRevision: 1, caseRevision: 1, nodeKey: 'send_quote', capabilityKey: 'email.send.quote_delivery', payload: {}, payloadHash: 'hash-1', idempotencyKey: randomUUID(), status: 'AWAITING_APPROVAL' },
    });
    const processApproval = await db.approval.create({ data: { tenantId, entityType: 'PROCESS_ACTION', entityId: intent.id, policyAction: 'email.send.quote_delivery' } });
    ids.processApproval = processApproval.id;
    const staleIntent = await db.actionIntent.create({
      data: { tenantId, caseId: waiting.id, planId: randomUUID(), planRevision: 1, caseRevision: 1, nodeKey: 'send_old', capabilityKey: 'email.send.quote_delivery', payload: {}, payloadHash: 'hash-0', idempotencyKey: randomUUID(), status: 'CANCELLED' },
    });
    const staleApproval = await db.approval.create({ data: { tenantId, entityType: 'PROCESS_ACTION', entityId: staleIntent.id, policyAction: 'email.send.quote_delivery' } });
    ids.staleApproval = staleApproval.id;

    // Abgeschlossener Vorgang mit bestätigtem, simuliertem Versand.
    const done = await db.case.create({ data: { tenantId, type: 'SALES', title: 'Angebot Haustür', orchestrationStatus: 'COMPLETED', status: 'DONE', completedAt: new Date(), blueprintKey: 'rfq' } });
    ids.doneCase = done.id;
    const sent = await db.actionIntent.create({
      data: { tenantId, caseId: done.id, planId: randomUUID(), planRevision: 1, caseRevision: 1, nodeKey: 'send', capabilityKey: 'email.send.quote_delivery', payload: {}, payloadHash: 'h', idempotencyKey: randomUUID(), status: 'CONFIRMED' },
    });
    await db.actionReceipt.create({ data: { tenantId, intentId: sent.id, status: 'CONFIRMED', evidence: {}, executionMode: 'SIMULATED' } });

    // Posteingang: Eingang im Vorgang, neuer Eingang, ausgefilterter Newsletter.
    const base = { tenantId, channel: 'SIMULATED' as const, provider: 'simulated', occurredAt: new Date() };
    await db.intakeEvent.create({ data: { ...base, externalEventId: randomUUID(), senderRef: { address: 'anna@kunde.example', displayName: 'Anna Kunde' }, subject: 'Anfrage Fenster', status: 'PROCESSING', relevance: 'BUSINESS_ACTIONABLE', domainCategory: 'SALES', caseId: waiting.id } });
    await db.intakeEvent.create({ data: { ...base, occurredAt: new Date(Date.now() - 60_000), externalEventId: randomUUID(), senderRef: { address: 'neu@kunde.example' }, subject: 'Frische Anfrage', status: 'RECEIVED' } });
    await db.intakeEvent.create({ data: { ...base, occurredAt: new Date(Date.now() - 120_000), externalEventId: randomUUID(), senderRef: { address: 'news@werbung.example' }, subject: 'Newsletter', status: 'SKIPPED_NON_ACTIONABLE', relevance: 'NON_ACTIONABLE' } });
    await db.intakeEvent.create({ data: { ...base, occurredAt: new Date(Date.now() - 180_000), externalEventId: randomUUID(), senderRef: { address: 'ok@kunde.example' }, subject: 'Erledigt', status: 'COMPLETED', relevance: 'BUSINESS_ACTIONABLE', domainCategory: 'FINANCE', caseId: done.id } });

    // Aufgaben: überfällig, später, erledigt.
    await db.task.create({ data: { tenantId, title: 'Rückruf Meier', description: 'Angebot nachfassen', dueDate: new Date(Date.now() - 3 * day), caseId: waiting.id } });
    await db.task.create({ data: { tenantId, title: 'Später prüfen', dueDate: new Date(Date.now() + 5 * day) } });
    await db.task.create({ data: { tenantId, title: 'Schon erledigt', status: 'DONE' } });

    // Vertrieb: Interessent im Vorgang, der auf die Antwort des Kunden wartet; zweiter, bereits gewonnener.
    const waitingReply = await db.case.create({ data: { tenantId, type: 'SALES', title: 'Rückfrage Gartentor', orchestrationStatus: 'WAITING_FOR_INFORMATION', blueprintKey: 'rfq' } });
    const contactA = await db.contact.create({ data: { tenantId, firstName: 'Petra', lastName: 'Weber', email: 'petra@weber.example' } });
    const contactB = await db.contact.create({ data: { tenantId, firstName: 'Max', lastName: 'Gewonnen', crmExternalId: 'crm-1' } });
    await db.lead.create({ data: { tenantId, contactId: contactA.id, caseId: waitingReply.id, source: 'EMAIL', status: 'NEW' } });
    await db.lead.create({ data: { tenantId, contactId: contactB.id, source: 'WEB', status: 'CONVERTED' } });
    await db.auditLog.create({ data: { tenantId, eventType: 'APPROVAL_GRANTED', actorType: 'USER', entityType: 'Case', entityId: waiting.id } });
    await db.auditLog.create({ data: { tenantId, eventType: 'TOOL_INVOKED', actorType: 'AGENT' } });
  });

  afterAll(async () => {
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } })).catch(() => undefined);
    await app.close();
  });

  describe('Posteingang', () => {
    it('hides deliberately excluded inputs by default in production-like views and lists the rest with business language', async () => {
      const res = await get('/inbox/items?excluded=false').expect(200);
      const list = res.body as InboxListResponse;
      expect(list.excludedHidden).toBe(true);
      expect(list.items.map((i) => i.subject)).not.toContain('Newsletter');
      const item = list.items.find((i) => i.subject === 'Anfrage Fenster')!;
      expect(item.senderLabel).toBe('Anna Kunde');
      expect(item.stage).toBe('ATTENTION'); // der Vorgang wartet auf eine Freigabe
      expect(item.nextActionLabel).toBe('Freigabe prüfen');
      expect(item.caseRef?.href).toBe(`/cases/${ids.waitingCase}`);
      expect(item.typeLabel).not.toMatch(/^[A-Z_]+$/); // nie ein Enum-Schlüssel
    });

    it('filters by stage and shows the excluded input with "Keine Aktion nötig" when asked for it', async () => {
      const attention = (await get('/inbox/items?filter=ATTENTION&excluded=false').expect(200)).body as InboxListResponse;
      expect(attention.items.map((i) => i.subject)).toEqual(['Anfrage Fenster']);
      const fresh = (await get('/inbox/items?filter=NEW&excluded=false').expect(200)).body as InboxListResponse;
      expect(fresh.items.map((i) => i.subject)).toEqual(['Frische Anfrage']);
      const done = (await get('/inbox/items?filter=DONE&excluded=false').expect(200)).body as InboxListResponse;
      expect(done.items.map((i) => i.subject)).toEqual(['Erledigt']);
      const all = (await get('/inbox/items?excluded=true').expect(200)).body as InboxListResponse;
      const newsletter = all.items.find((i) => i.subject === 'Newsletter')!;
      expect(newsletter.excluded).toBe(true);
      expect(newsletter.nextActionLabel).toBe('Keine Aktion nötig');
      expect(all.counts.ATTENTION).toBe(1);
      const searched = (await get('/inbox/items?q=Frische&excluded=false').expect(200)).body as InboxListResponse;
      expect(searched.items).toHaveLength(1);
    });

    it('states "Aktion: Keine" in the detail of an input that triggered no process, and rejects unknown filters', async () => {
      const all = (await get('/inbox/items?excluded=true').expect(200)).body as InboxListResponse;
      const id = all.items.find((i) => i.subject === 'Newsletter')!.id;
      const detail = (await get(`/inbox/items/${id}`).expect(200)).body as InboxDetail;
      expect(detail.actionStatement).toMatch(/Aktion: Keine/);
      await get('/inbox/items?filter=BOGUS').expect(400);
      await get(`/inbox/items/${randomUUID()}`).expect(404);
    });

    it('is tenant-isolated', async () => {
      const res = (await get('/inbox/items?excluded=true', otherToken).expect(200)).body as InboxListResponse;
      expect(res.items).toHaveLength(0);
    });
  });

  describe('Freigaben', () => {
    it('lists "Meine offenen Freigaben" with action, object, amount and risk – critical first, no policy keys', async () => {
      const queue = (await get('/approvals/queue').expect(200)).body as ApprovalQueueItem[];
      expect(queue.length).toBe(2); // die ersetzte Freigabe ist nicht mehr entscheidbar und steht nur in der Teamsicht
      expect(queue[0]!.risk).toBe('CRITICAL');
      expect(queue[0]!.actionLabel).toBe('Neue Bankverbindung bestätigen');
      expect(queue[0]!.object?.label).toBe('Stahl AG · R-77');
      expect(queue[0]!.amountText).toMatch(/1\.190,00/);
      for (const item of queue) expect(item.actionLabel).not.toMatch(/[a-z]+\.[a-z_.]+/);
      const team = (await get('/approvals/queue?scope=TEAM').expect(200)).body as ApprovalQueueItem[];
      expect(team.length).toBe(3);
    });

    it('shows what, for whom, which data, which system, why and what happens afterwards for a bank-change approval', async () => {
      const detail = (await get(`/approvals/${ids.bankApproval}/detail`).expect(200)).body as ApprovalDetail;
      expect(detail.fields.find((f) => f.label === 'Hinterlegte Bankverbindung')?.value).toBe('DE89370400440532013000');
      expect(detail.fields.find((f) => f.label === 'Bankverbindung laut Rechnung')).toMatchObject({ value: 'DE02120300000000202051', emphasis: true });
      expect(detail.whyRequired).toBeTruthy();
      expect(detail.afterwards).toMatch(/Es wird nichts bezahlt/);
      expect(detail.targetSystem).toBeTruthy();
      expect(detail.decision).toMatchObject({ mode: 'ENTITY', approveLabel: 'Neue Bankverbindung bestätigen' });
      expect(detail.canDecide).toBe(true);
    });

    it('binds a process approval to its case node and reports a replaced approval as stale (AC-15)', async () => {
      const live = (await get(`/approvals/${ids.processApproval}/detail`).expect(200)).body as ApprovalDetail;
      expect(live.processAction).toEqual({ caseId: ids.waitingCase, nodeId: 'send_quote' });
      expect(live.decision.mode).toBe('PROCESS_ACTION');
      expect(live.stale).toBe(false);
      expect(live.canDecide).toBe(true);

      const stale = (await get(`/approvals/${ids.staleApproval}/detail`).expect(200)).body as ApprovalDetail;
      expect(stale.stale).toBe(true);
      expect(stale.canDecide).toBe(false);
      expect(stale.cannotDecideReason).toMatch(/durch eine Änderung ersetzt/);
    });

    it('is tenant-isolated', async () => {
      await get(`/approvals/${ids.bankApproval}/detail`, otherToken).expect(404);
    });
  });

  describe('Vorgänge', () => {
    it('lists open cases by default with status, next step and counts; the finished one only under "Abgeschlossen"', async () => {
      const open = (await get('/cases/overview').expect(200)).body as CaseListResponse;
      expect(open.items.map((i) => i.title).sort()).toEqual(['Anfrage Fenster Müller', 'Rückfrage Gartentor']);
      expect(open.items.find((i) => i.title === 'Anfrage Fenster Müller')).toMatchObject({ statusLabel: 'Freigabe erforderlich', needsAttention: true, nextStep: 'Ihre Freigabe ist erforderlich', typeLabel: 'Vertrieb' });
      expect(open.counts).toMatchObject({ OPEN: 2, ATTENTION: 1, DONE: 1, ALL: 3 });
      const done = (await get('/cases/overview?filter=DONE').expect(200)).body as CaseListResponse;
      expect(done.items.map((i) => i.title)).toEqual(['Angebot Haustür']);
      await get('/cases/overview?filter=BOGUS').expect(400);
    });
  });

  describe('Aufgaben', () => {
    it('groups "Meine Aufgaben" into overdue / later and keeps done tasks out unless asked', async () => {
      const res = (await get('/tasks/overview').expect(200)).body as TaskListResponse;
      expect(res.items.map((i) => [i.title, i.section])).toEqual([
        ['Rückruf Meier', 'OVERDUE'],
        ['Später prüfen', 'LATER'],
      ]);
      expect(res.items[0]).toMatchObject({ expectedResult: 'Angebot nachfassen', caseHasProcess: true, areaLabel: 'Vertrieb' });
      expect(res.items[0]!.relatedCase?.href).toBe(`/cases/${ids.waitingCase}`);
      const withDone = (await get('/tasks/overview?done=true').expect(200)).body as TaskListResponse;
      expect(withDone.counts.DONE).toBe(1);
    });
  });

  describe('Aktivitäten', () => {
    it('shows readable results with their evidence and leaves technical events out', async () => {
      const feed = (await get('/activity/feed').expect(200)).body as ActivityFeed;
      const titles = feed.entries.map((e) => e.title);
      expect(titles).toContain('Freigabe erteilt');
      expect(titles).toContain('Angebot versandt (simuliert)');
      expect(titles.join(' ')).not.toMatch(/TOOL_INVOKED|Tool/);
      const sent = feed.entries.find((e) => e.title.startsWith('Angebot versandt'))!;
      expect(sent.evidence).toMatchObject({ confirmed: true, executionMode: 'SIMULATED' });
      expect(sent.entity?.href).toBe(`/cases/${ids.doneCase}`);
      const forCase = (await get(`/activity/feed?caseId=${ids.doneCase}`).expect(200)).body as ActivityFeed;
      expect(forCase.entries.every((e) => e.entity?.id === ids.doneCase)).toBe(true);
      await get('/activity/feed?area=BOGUS').expect(400);
    });
  });
  describe('Vertrieb und Verbindungen', () => {
    it('lists open inquiries with the next step; "Antwort fehlt" and "Abgeschlossen" are separate filters; CRM state is only confirmed when it is', async () => {
      const open = (await get('/leads/overview').expect(200)).body as LeadListResponse;
      expect(open.items.map((i) => i.contactLabel)).toEqual(['Petra Weber']);
      expect(open.items[0]).toMatchObject({ statusLabel: 'Neu', replyMissing: true, nextStep: 'Wartet auf die Antwort des Kunden', crmLabel: 'Noch nicht mit dem CRM abgeglichen' });
      expect(open.counts).toMatchObject({ OPEN: 1, REPLY_MISSING: 1, DONE: 1, ALL: 2 });
      const done = (await get('/leads/overview?filter=DONE').expect(200)).body as LeadListResponse;
      expect(done.items[0]).toMatchObject({ contactLabel: 'Max Gewonnen', statusLabel: 'Konvertiert', crmLabel: 'Im CRM bestätigt' });
      const searched = (await get('/leads/overview?filter=ALL&q=weber').expect(200)).body as LeadListResponse;
      expect(searched.items).toHaveLength(1);
      await get('/leads/overview?filter=BOGUS').expect(400);
    });

    it('records a request for an unsupported system as audit event and admin task – never as an invented connector', async () => {
      await request(app.getHttpServer()).post('/api/v1/integrations/requests').set('Authorization', `Bearer ${token}`).send({ systemName: 'Lexoffice', note: 'Rechnungen' }).expect(201);
      const events = await prisma.forTenantId(tenantId).auditLog.findMany({ where: { eventType: 'CONNECTOR_REQUESTED' } });
      expect(events).toHaveLength(1);
      const tasks = await prisma.forTenantId(tenantId).task.findMany({ where: { title: 'Systemanbindung prüfen: Lexoffice' } });
      expect(tasks).toHaveLength(1);
      await request(app.getHttpServer()).post('/api/v1/integrations/requests').set('Authorization', `Bearer ${token}`).send({ systemName: 'x' }).expect(400);
    });
  });
  describe('Eine Zahl für Home, Liste und Sonde (AC-10, DATA-01)', () => {
    it('„Freigaben offen“ auf Home ist genau die Länge von „Meine offenen Freigaben“ – die ersetzte Freigabe zählt in keiner der beiden', async () => {
      const snapshot = (await get('/dashboard/snapshot?attention=50').expect(200)).body as DashboardSnapshot;
      const queue = (await get('/approvals/queue').expect(200)).body as ApprovalQueueItem[];
      const open = snapshot.metrics.find((metric) => metric.key === 'approvalsOpen')!;
      expect(open).toMatchObject({ basis: 'CURRENT', value: queue.length });
      // Die Aufmerksamkeit führt dieselben Freigaben (Rechnung und Vorgang bündeln mit ihrem Risikohinweis bzw. ihrer Aufgabe).
      const approvalsInAttention = snapshot.attentionPreview.filter((item) => item.primaryEntity.type === 'APPROVAL' || item.relatedEntities.some((e) => e.type === 'APPROVAL'));
      expect(approvalsInAttention.length).toBeGreaterThan(0);
      expect(snapshot.generatedAt).toBeTruthy();
    });
  });
});
