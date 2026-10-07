import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PLATFORM_ROLES, assessQueue, type PlatformRole, type RuntimeHealth } from '@orbit/shared';
import request from 'supertest';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Betriebszustand der Hintergrundverarbeitung (Amendment 03 §22) gegen echtes Redis/BullMQ. Ob zum Testzeitpunkt ein Worker läuft, hängt von der Umgebung ab
 * (der Docker-Worker wird für E2E-Läufe angehalten, kann aber laufen) – deshalb prüft der Test, dass Bewertung und Messwerte **zueinander passen**, nicht einen
 * bestimmten Zustand. Auf keinen Fall startet er einen eigenen Worker: der würde echte Aufträge der Entwicklungs-Queue verbrauchen.
 */
describe('Platform runtime health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const users: string[] = [];

  async function token(role: PlatformRole, tag: string): Promise<string> {
    const email = `rt-${suffix}-${tag}@platform-test.example`;
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName: tag, password, roles: [role] });
    users.push(created.id);
    return (await app.get(PlatformAuthService).login(email, password)).accessToken;
  }
  const get = (path: string, bearer: string) => request(app.getHttpServer()).get(`/api/v1/platform${path}`).set({ Authorization: `Bearer ${bearer}` });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.withPlatformScope((tx) => tx.platformUser.deleteMany({ where: { id: { in: users } } }));
    await app.close();
  });

  it('liefert für beide Queues echte Zähler; Bewertung und Messwerte passen zueinander; der Gesamtzustand ist der schlechteste', async () => {
    const response = await get('/runtime', await token(PLATFORM_ROLES.PLATFORM_OWNER, 'owner')).expect(200);
    const health = response.body as RuntimeHealth;
    expect(health.queues.map((q) => q.name).sort()).toEqual(['channel-sync', 'workflow-runs']);
    for (const q of health.queues) {
      for (const key of ['waiting', 'active', 'delayed', 'failed', 'workers'] as const) expect(q[key]).toEqual(expect.any(Number));
      expect(q.status).toBe(assessQueue(q).status); // dieselbe Regel wie in der Oberfläche
      if (q.workers === 0) expect(q).toMatchObject({ status: 'DOWN', note: expect.stringContaining('Kein Worker') });
      if (q.waiting === 0) expect(q.oldestWaitingAgeSec).toBeNull();
    }
    const order = { OK: 0, DEGRADED: 1, DOWN: 2 } as const;
    expect(order[health.status]).toBe(Math.max(...health.queues.map((q) => order[q.status])));
    expect(Date.now() - new Date(health.checkedAt).getTime()).toBeLessThan(60_000);
  });

  it('enthält nur Zahlen und Namen – keine Mandanten- oder Auftragsinhalte', async () => {
    const response = await get('/runtime', await token(PLATFORM_ROLES.PLATFORM_SUPPORT, 'support')).expect(200);
    const keys = new Set(Object.keys(response.body as object));
    expect([...keys].sort()).toEqual(['checkedAt', 'queues', 'status']);
    for (const q of (response.body as RuntimeHealth).queues) expect(Object.keys(q).sort()).toEqual(['active', 'delayed', 'failed', 'name', 'note', 'oldestWaitingAgeSec', 'status', 'waiting', 'workers']);
  });

  it('wer die Laufzeit nicht lesen darf (FinOps) oder gar keine Plattformidentität hat, bekommt sie nicht', async () => {
    await get('/runtime', await token(PLATFORM_ROLES.PLATFORM_FINOPS, 'finops')).expect(403);
    await request(app.getHttpServer()).get('/api/v1/platform/runtime').expect(401);
    const tenantLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' });
    await get('/runtime', tenantLogin.body.accessToken as string).expect(401);
  });
});
