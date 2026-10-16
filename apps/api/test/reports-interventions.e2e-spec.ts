import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** AUT-11: Bericht „Wo greifen Menschen ein?“ – zählt nur den eigenen Betrieb, liefert Vorschläge nur mit Beleg und verlangt das Leserecht. */
describe('Bericht „Wo greifen Menschen ein?“ (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenants: Array<{ id: string; token: string }> = [];
  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i += 1) {
      const suffix = randomUUID();
      const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Bericht ${suffix.slice(0, 8)}`, slug: `e2e-report-${suffix}`, adminEmail: `a-${suffix}@e2e-report.example`, adminPassword: PASSWORD, adminFirstName: 'Rita', adminLastName: 'Bericht' });
      const token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
      tenants.push({ id: tenant.id, token });
    }
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } }));
    await app.close();
  });

  it('zählt Vorgänge, Meldungen und Freigaben des Betriebs und macht belegte Vorschläge; der andere Betrieb sieht nichts davon', async () => {
    const [a, b] = tenants as [(typeof tenants)[number], (typeof tenants)[number]];
    const db = prisma.forTenantId(a.id);
    const newCase = (status: string, attentionReasons: string[] = []) => db.case.create({ data: { tenantId: a.id, type: 'GENERAL', title: 'Anfrage', orchestrationStatus: status, attentionReasons } as never });
    await newCase('COMPLETED');
    await newCase('COMPLETED');
    const reviews = [await newCase('MANUAL_REVIEW', ['Schritt 1: Eingabe "a" fehlt']), await newCase('MANUAL_REVIEW', ['Schritt 2: Eingabe "b" fehlt']), await newCase('MANUAL_REVIEW', ['Schritt 3: Eingabe "c" fehlt'])];
    const first = new Date(Date.now() - 3_600_000);
    for (const row of reviews) await db.attentionItem.create({ data: { tenantId: a.id, caseId: row.id, kind: 'MANUAL_REVIEW', responsibility: 'GENERAL', firstSeenAt: first, acknowledgedAt: new Date(first.getTime() + 30 * 60_000), state: 'ACKNOWLEDGED' } });
    for (let i = 0; i < 6; i += 1) await db.approval.create({ data: { tenantId: a.id, entityType: 'SUPPLIER', entityId: randomUUID(), policyAction: 'supplier.create', status: i < 4 ? 'REJECTED' : 'APPROVED', decidedAt: new Date() } });

    const report = (await api().get('/api/v1/reports/interventions?days=7').set(bearer(a.token)).expect(200)).body;
    expect(report.cases).toMatchObject({ total: 5, automated: 2, withHuman: 3, running: 0, automationRate: 0.4 });
    expect(report.attention).toMatchObject({ total: 3, medianReactionMinutes: 30 });
    expect(report.approvals).toMatchObject({ total: 6, approved: 2, rejected: 4 });
    expect(report.topReasons[0]).toEqual({ reason: 'Schritt #: Eingabe … fehlt', count: 3 });
    expect(report.suggestions.map((s: { kind: string }) => s.kind).sort()).toEqual(['HAEUFIGER_GRUND', 'OFT_ABGELEHNT']);
    expect(report.truncated).toBe(false);

    const other = (await api().get('/api/v1/reports/interventions').set(bearer(b.token)).expect(200)).body;
    expect(other.cases.total).toBe(0);
    expect(other.approvals.total).toBe(0);
  });

  it('ungültiger Zeitraum und fehlende Anmeldung werden abgelehnt', async () => {
    const [a] = tenants as [(typeof tenants)[number]];
    await api().get('/api/v1/reports/interventions?days=0').set(bearer(a.token)).expect(400);
    await api().get('/api/v1/reports/interventions?days=400').set(bearer(a.token)).expect(400);
    await api().get('/api/v1/reports/interventions').expect(401);
  });
});
