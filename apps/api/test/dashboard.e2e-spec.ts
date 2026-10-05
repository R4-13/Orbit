import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { DashboardSnapshot } from '@orbit/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/** UI/UX v2 §26.2: the single, authorized dashboard projection (Home and Sonde use the same numbers). */
describe('Dashboard snapshot (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let otherToken: string;
  const tenants: string[] = [];

  async function bootstrapTenant(label: string): Promise<{ tenantId: string; token: string }> {
    const suffix = randomUUID();
    const email = `admin-${suffix}@e2e-${label}.example`;
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Musterwerk ${label} ${suffix.slice(0, 6)}`, slug: `e2e-${label}-${suffix}`, adminEmail: email, adminPassword: 'Musterwerk#2026!', adminFirstName: 'Anna', adminLastName: 'Beispiel' });
    tenants.push(tenant.id);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Musterwerk#2026!' });
    return { tenantId: tenant.id, token: login.body.accessToken as string };
  }

  const get = (path: string, t = token) => request(app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    ({ tenantId, token } = await bootstrapTenant('dash'));
    ({ token: otherToken } = await bootstrapTenant('dash-other'));

    const db = prisma.forTenantId(tenantId);
    const supplier = await db.supplier.create({ data: { tenantId, name: 'Stahl AG' } });
    await db.invoice.create({ data: { tenantId, supplierId: supplier.id, invoiceNumber: 'R-77', status: 'BANK_CHANGE_SUSPECTED' } });
    await db.case.create({ data: { tenantId, type: 'SALES', title: 'Anfrage Fenster Müller', orchestrationStatus: 'FAILED' } });
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000);
    await db.task.create({ data: { tenantId, title: 'Rückruf Kunde Meier', dueDate: yesterday } });
    await db.task.create({ data: { tenantId, title: 'Später erledigen', dueDate: new Date(Date.now() + 5 * 24 * 3600 * 1000) } });
    await db.approval.create({ data: { tenantId, entityType: 'FOLLOW_UP', entityId: randomUUID(), policyAction: 'followup.send', reason: 'Nachricht an Kunde' } });
  });

  afterAll(async () => {
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id } })).catch(() => undefined);
    await app.close();
  });

  it('rejects unauthenticated access and invalid parameters', async () => {
    await request(app.getHttpServer()).get('/api/v1/dashboard/snapshot').expect(401);
    await get('/dashboard/snapshot?period=YEAR').expect(400);
    await get('/dashboard/snapshot?view=EVERYONE').expect(400);
    await get('/dashboard/snapshot?timezone=Mars/Olympus').expect(400);
  });

  it('orders attention critical → overdue → due today → rest and links every entry to an internal route', async () => {
    const res = await get('/dashboard/snapshot?attention=10').expect(200);
    const snapshot = res.body as DashboardSnapshot;
    expect(snapshot.attentionTotal).toBe(4);
    const titles = snapshot.attentionPreview.map((item) => item.title);
    expect(titles[0]).toMatch(/Bankverbindung geändert: Stahl AG · R-77/);
    expect(snapshot.attentionPreview[0]!.priority).toBe('CRITICAL');
    expect(titles.slice(1, 3).sort()).toEqual(['Anfrage Fenster Müller', 'Rückruf Kunde Meier'].sort());
    expect(titles[3]).toMatch(/Nachricht/);
    for (const item of snapshot.attentionPreview) {
      expect(item.primaryEntity.href).toMatch(/^\//);
      expect(item.availableActions.length).toBeGreaterThan(0);
    }
    // the far-future task is not attention
    expect(titles.join('|')).not.toContain('Später erledigen');
  });

  it('limits the preview but keeps the total, and reports metrics with their basis', async () => {
    const res = await get('/dashboard/snapshot?attention=2').expect(200);
    const snapshot = res.body as DashboardSnapshot;
    expect(snapshot.attentionPreview).toHaveLength(2);
    expect(snapshot.attentionTotal).toBe(4);
    const metric = (key: string) => snapshot.metrics.find((m) => m.key === key)!;
    expect(metric('approvalsOpen')).toMatchObject({ value: 1, basis: 'CURRENT' });
    expect(metric('problems')).toMatchObject({ value: 1, basis: 'CURRENT' });
    expect(metric('automated')).toMatchObject({ value: 0, basis: 'PERIOD' });
    expect(snapshot.scope).toMatchObject({ view: 'MINE', period: 'TODAY', timezone: 'Europe/Berlin' });
    expect(snapshot.tasksTotal).toBe(2);
    expect(snapshot.finance).toMatchObject({ toReview: 1 });
    expect(snapshot.finance?.hint?.entity.type).toBe('INVOICE');
    expect(snapshot.snapshotId).toBeTruthy();
    expect(snapshot.generatedAt).toBeTruthy();
  });

  it('is tenant-isolated: another tenant sees none of these items', async () => {
    const res = await get('/dashboard/snapshot', otherToken).expect(200);
    const snapshot = res.body as DashboardSnapshot;
    expect(snapshot.attentionTotal).toBe(0);
    expect(snapshot.tasksTotal).toBe(0);
    expect(JSON.stringify(snapshot)).not.toContain('Stahl AG');
  });

  it('serves the display name for the greeting from /auth/me (not from the token, never the e-mail address)', async () => {
    const res = await get('/auth/me').expect(200);
    expect(res.body).toMatchObject({ firstName: 'Anna', lastName: 'Beispiel' });
    expect(res.body.email).toBeUndefined();
  });
});
