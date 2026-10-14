import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** Allgemeine Idempotenzschlüssel (MST-08): eine wiederholte schreibende Anfrage mit demselben Schlüssel wird nicht zweimal ausgeführt. */
describe('Idempotency-Key (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let tokenA: string;
  let tokenB: string;
  let tenantB: string;
  const api = () => request(app.getHttpServer());
  const post = (token: string, key: string | undefined, body: Record<string, unknown>) => {
    const r = api().post('/api/v1/tasks').set({ Authorization: `Bearer ${token}` });
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const taskCount = (tenant: string, title: string) => prisma.forTenantId(tenant).task.count({ where: { title } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const make = async () => {
      const suffix = randomUUID();
      const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Idem ${suffix.slice(0, 8)}`, slug: `e2e-idem-${suffix}`, adminEmail: `a-${suffix}@e2e-idem.example`, adminPassword: PASSWORD, adminFirstName: 'A', adminLastName: 'B' });
      const token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
      return { id: tenant.id, token };
    };
    const a = await make();
    const b = await make();
    tenantId = a.id;
    tokenA = a.token;
    tenantB = b.id;
    tokenB = b.token;
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: [tenantId, tenantB] } } }));
    await app.close();
  });

  it('dieselbe Anfrage mit demselben Schlüssel wird einmal ausgeführt und liefert danach dieselbe Antwort', async () => {
    const key = `key-${randomUUID()}`;
    const first = await post(tokenA, key, { title: 'Einmalig' }).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await post(tokenA, key, { title: 'Einmalig' }).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await taskCount(tenantId, 'Einmalig')).toBe(1);
  });

  it('ohne Schlüssel gibt es keine Wiederholungssicherheit (zwei Ausführungen), Lesezugriffe sind unberührt', async () => {
    await post(tokenA, undefined, { title: 'Ohne Schlüssel' }).expect(201);
    await post(tokenA, undefined, { title: 'Ohne Schlüssel' }).expect(201);
    expect(await taskCount(tenantId, 'Ohne Schlüssel')).toBe(2);
    await api().get('/api/v1/tasks').set({ Authorization: `Bearer ${tokenA}` }).set('Idempotency-Key', `key-${randomUUID()}`).expect(200);
  });

  it('derselbe Schlüssel mit anderem Inhalt ist ein Fehler (422) und führt nichts aus', async () => {
    const key = `key-${randomUUID()}`;
    await post(tokenA, key, { title: 'Original' }).expect(201);
    const clash = await post(tokenA, key, { title: 'Anderer Inhalt' }).expect(422);
    expect(clash.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await taskCount(tenantId, 'Anderer Inhalt')).toBe(0);
  });

  it('ein fehlgeschlagener Versuch gibt den Schlüssel frei: nach der Korrektur läuft dieselbe Wiederholung', async () => {
    const key = `key-${randomUUID()}`;
    await post(tokenA, key, { title: '' }).expect(400);
    await post(tokenA, key, { title: 'Nach Korrektur' }).expect(201);
    expect(await taskCount(tenantId, 'Nach Korrektur')).toBe(1);
  });

  it('ungültige Schlüssel werden abgewiesen; Schlüssel gelten je Mandant', async () => {
    await post(tokenA, 'kurz', { title: 'X' }).expect(400);
    const key = `key-${randomUUID()}`;
    await post(tokenA, key, { title: 'Mandant A' }).expect(201);
    const other = await post(tokenB, key, { title: 'Mandant B' }).expect(201); // gleicher Schlüssel, anderer Mandant: keine Kollision, kein Zugriff auf fremde Antwort
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(await taskCount(tenantB, 'Mandant B')).toBe(1);
    expect(await taskCount(tenantId, 'Mandant B')).toBe(0);
  });

  it('zwei gleichzeitige Anfragen mit demselben Schlüssel werden nur einmal ausgeführt (die zweite: Antwort oder 409)', async () => {
    const real = `key-${randomUUID()}`;
    const first = post(tokenA, real, { title: 'Parallel' });
    const second = post(tokenA, real, { title: 'Parallel' });
    const [a, b] = await Promise.all([first, second]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    expect(await taskCount(tenantId, 'Parallel')).toBe(1);
  });
});
