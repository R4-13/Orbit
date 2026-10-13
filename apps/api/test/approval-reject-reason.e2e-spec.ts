import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** Ablehnungsgrund bei Freigaben (UI v2 §14): wird gespeichert, im Detail gezeigt und im Audit festgehalten; ohne Begründung bleibt die Ablehnung möglich. */
describe('Approval rejection reason (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `E2E Reject ${suffix}`, slug: `e2e-reject-${suffix}`, adminEmail: `admin-${suffix}@e2e-reject.example`, adminPassword: PASSWORD, adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenantId = tenant.id;
    token = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  async function pendingSupplier(name: string) {
    const supplier = await prisma.forTenantId(tenantId).supplier.create({ data: { tenantId, name, status: 'PENDING_APPROVAL' } as never });
    const approval = await prisma.forTenantId(tenantId).approval.create({ data: { tenantId, entityType: 'SUPPLIER', entityId: supplier.id, policyAction: 'supplier.create', status: 'PENDING' } });
    return { supplier, approval };
  }

  it('die Begründung wird gespeichert, im Freigabe-Detail gezeigt und im Audit festgehalten', async () => {
    const { supplier, approval } = await pendingSupplier(`Lieferant ${randomUUID().slice(0, 6)}`);
    await request(app.getHttpServer()).patch(`/api/v1/suppliers/${supplier.id}/reject`).set(auth()).send({ reason: '  Bankverbindung nicht nachvollziehbar  ' }).expect(200);

    const stored = await prisma.forTenantId(tenantId).approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(stored).toMatchObject({ status: 'REJECTED', decisionReason: 'Bankverbindung nicht nachvollziehbar' });
    const detail = (await request(app.getHttpServer()).get(`/api/v1/approvals/${approval.id}/detail`).set(auth()).expect(200)).body as { status: string; decisionReason?: string };
    expect(detail).toMatchObject({ status: 'REJECTED', decisionReason: 'Bankverbindung nicht nachvollziehbar' });
    const audit = await prisma.forTenantId(tenantId).auditLog.findFirst({ where: { tenantId, eventType: 'APPROVAL_REJECTED', entityId: supplier.id } });
    expect(audit?.payload).toMatchObject({ reason: 'Bankverbindung nicht nachvollziehbar' });
  });

  it('ohne Begründung bleibt die Ablehnung möglich (kein Körper nötig)', async () => {
    const { supplier, approval } = await pendingSupplier(`Lieferant ${randomUUID().slice(0, 6)}`);
    await request(app.getHttpServer()).patch(`/api/v1/suppliers/${supplier.id}/reject`).set(auth()).expect(200);
    const stored = await prisma.forTenantId(tenantId).approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(stored).toMatchObject({ status: 'REJECTED', decisionReason: null });
  });

  it('eine zu lange oder fremde Eingabe wird abgewiesen, ohne etwas zu verändern', async () => {
    const { supplier, approval } = await pendingSupplier(`Lieferant ${randomUUID().slice(0, 6)}`);
    await request(app.getHttpServer()).patch(`/api/v1/suppliers/${supplier.id}/reject`).set(auth()).send({ reason: 'x'.repeat(501) }).expect(400);
    await request(app.getHttpServer()).patch(`/api/v1/suppliers/${supplier.id}/reject`).set(auth()).send({ reason: 'ok', extra: true }).expect(400);
    expect((await prisma.forTenantId(tenantId).approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('PENDING');
  });
});
