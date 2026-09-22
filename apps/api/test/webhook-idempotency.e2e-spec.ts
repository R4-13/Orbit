import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookIdempotencyService } from '../src/webhooks/webhook-idempotency.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * §31/§59 — no real webhook receiver exists yet to call this through HTTP
 * (see docs/INTEGRATIONS.md), so this exercises the service directly via
 * `app.get()`, the same pattern used for other not-yet-endpoint-wrapped
 * services in this suite (e.g. TenantsService in tenant-admin.e2e-spec.ts).
 * Live against real Postgres — the whole point is proving the *database's*
 * unique constraint, not a mocked one, actually enforces idempotency,
 * including under real concurrent delivery.
 */
describe('WebhookIdempotencyService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: WebhookIdempotencyService;
  let tenantId: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    service = app.get(WebhookIdempotencyService);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    tenantId = login.body.user.tenantId as string;
  });

  afterEach(async () => {
    await prisma.forTenantId(tenantId).webhookEvent.deleteMany({ where: { source: 'e2e-test' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns true for a new event and false for a repeat delivery of the same event', async () => {
    const externalEventId = `evt-${randomUUID()}`;

    const first = await service.recordIfNew(tenantId, 'e2e-test', externalEventId);
    const second = await service.recordIfNew(tenantId, 'e2e-test', externalEventId);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await prisma.forTenantId(tenantId).webhookEvent.findMany({ where: { externalEventId } });
    expect(rows).toHaveLength(1); // the duplicate delivery never created a second row
  });

  it('stays idempotent under real concurrent delivery of the same event (race condition)', async () => {
    const externalEventId = `evt-concurrent-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.recordIfNew(tenantId, 'e2e-test', externalEventId)),
    );

    expect(results.filter((wasNew) => wasNew)).toHaveLength(1); // exactly one of the five "won"

    const rows = await prisma.forTenantId(tenantId).webhookEvent.findMany({ where: { externalEventId } });
    expect(rows).toHaveLength(1);
  });

  it('treats the same externalEventId from a different source as a distinct event', async () => {
    const externalEventId = `evt-${randomUUID()}`;

    const fromMicrosoft = await service.recordIfNew(tenantId, 'e2e-test', externalEventId);
    const fromHubspot = await service.recordIfNew(tenantId, 'e2e-test-other-source', externalEventId);

    expect(fromMicrosoft).toBe(true);
    expect(fromHubspot).toBe(true);

    await prisma.forTenantId(tenantId).webhookEvent.deleteMany({ where: { source: 'e2e-test-other-source' } });
  });
});
