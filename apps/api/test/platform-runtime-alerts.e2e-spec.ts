import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { OrbitEnv } from '@orbit/config';
import { assessRuntime, type QueueSnapshot, type RuntimeHealth } from '@orbit/shared';
import type Redis from 'ioredis';
import { ORBIT_ENV } from '../src/config/env.token';
import { PlatformRuntimeMonitorService } from '../src/platform/runtime/platform-runtime-monitor.service';
import { PlatformRuntimeService } from '../src/platform/runtime/platform-runtime.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WORKFLOW_RUNS_QUEUE } from '../src/queue/queue.tokens';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Alarm bei Zustandswechsel der Hintergrundverarbeitung (Amendment 03 §22) gegen echtes Redis und die echte Audit-Tabelle. Die Messung wird mit
 * vorgegebenen Zahlen ersetzt (damit der Test nicht davon abhängt, ob gerade ein Worker läuft); Webhook-Empfänger ist ein lokaler HTTP-Server.
 */
describe('Platform runtime alerts (e2e)', () => {
  const LEADER_KEY = 'orbit:platform:runtime-monitor:leader';
  const queueName = `e2e-queue-${Date.now().toString(36)}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let monitor: PlatformRuntimeMonitorService;
  let env: OrbitEnv;
  let redis: Redis;
  let server: Server;
  const received: Array<Record<string, unknown>> = [];
  let webhookStatus = 200;
  let current: QueueSnapshot;

  const snapshot = (over: Partial<QueueSnapshot>): QueueSnapshot => ({ name: queueName, waiting: 0, active: 0, delayed: 0, failed: 0, workers: 1, oldestWaitingAgeSec: null, ...over });
  const events = () => prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_RUNTIME_STATE_CHANGED', entityId: queueName }, orderBy: { createdAt: 'asc' } }));
  const extraOf = (row: { payload: unknown }) => (row.payload as { extra: Record<string, unknown> }).extra;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    monitor = app.get(PlatformRuntimeMonitorService);
    env = app.get<OrbitEnv>(ORBIT_ENV);
    redis = (await app.get<Queue>(getQueueToken(WORKFLOW_RUNS_QUEUE)).client) as unknown as Redis;
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push(JSON.parse(body) as Record<string, unknown>);
        response.statusCode = webhookStatus;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    env.PLATFORM_ALERT_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    // Die Messung wird vorgegeben; eine Queue mit eigenem Namen, damit nichts anderes im Audit stört.
    jest.spyOn(app.get(PlatformRuntimeService), 'health').mockImplementation(async (): Promise<RuntimeHealth> => assessRuntime([current], new Date()));
    // Dieser Test hält die Leader-Sperre (eine laufende Docker-API darf in der Zeit nicht alarmieren).
    await redis.set(LEADER_KEY, monitor['instanceId'], 'EX', 120);
  });

  afterAll(async () => {
    await redis.del(LEADER_KEY);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  });

  it('erste Beobachtung in Ordnung: kein Alarm; Ausfall: genau ein Audit-Ereignis und ein Webhook; derselbe Ausfall wird nicht wiederholt; Erholung wird gemeldet', async () => {
    current = snapshot({});
    expect(await monitor.tick()).toEqual([]);
    expect(await events()).toHaveLength(0);

    current = snapshot({ workers: 0, waiting: 4, oldestWaitingAgeSec: 30 });
    const down = await monitor.tick();
    expect(down).toEqual([{ queue: queueName, from: 'OK', to: 'DOWN', note: expect.stringContaining('Kein Worker') }]);
    expect(await monitor.tick()).toEqual([]); // gleicher Zustand: kein zweiter Alarm
    const afterDown = await events();
    expect(afterDown).toHaveLength(1);
    expect(extraOf(afterDown[0]!)).toMatchObject({ from: 'OK', to: 'DOWN', workers: 0, waiting: 4, webhook: 'DELIVERED' });
    expect(afterDown[0]!.actorType).toBe('SYSTEM');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'orbit.runtime.state_changed', environment: env.ORBIT_ENVIRONMENT, queue: queueName, from: 'OK', to: 'DOWN' });
    expect(Object.keys(received[0]!).sort()).toEqual(['at', 'environment', 'from', 'note', 'queue', 'to', 'type']); // nur Namen und Zustände

    current = snapshot({});
    expect(await monitor.tick()).toEqual([{ queue: queueName, from: 'DOWN', to: 'OK', note: 'Die Warteschlange arbeitet wieder normal.' }]);
    expect(received).toHaveLength(2);
    expect(await events()).toHaveLength(2);
  });

  it('ein nicht erreichbarer oder abweisender Webhook verhindert das Audit-Ereignis nie und wird darin festgehalten', async () => {
    webhookStatus = 500;
    current = snapshot({ waiting: 3, oldestWaitingAgeSec: 1200 });
    expect(await monitor.tick()).toEqual([{ queue: queueName, from: 'OK', to: 'DEGRADED', note: expect.stringContaining('20 Minuten') }]);
    let rows = await events();
    expect(extraOf(rows[rows.length - 1]!)).toMatchObject({ to: 'DEGRADED', webhook: 'FAILED:HTTP_500' });

    env.PLATFORM_ALERT_WEBHOOK_URL = 'http://127.0.0.1:9/nicht-erreichbar';
    current = snapshot({ workers: 0 });
    await monitor.tick();
    rows = await events();
    expect(extraOf(rows[rows.length - 1]!)).toMatchObject({ from: 'DEGRADED', to: 'DOWN', webhook: 'FAILED:UNREACHABLE' });

    env.PLATFORM_ALERT_WEBHOOK_URL = undefined;
    current = snapshot({});
    await monitor.tick();
    rows = await events();
    expect(extraOf(rows[rows.length - 1]!)).toMatchObject({ to: 'OK', webhook: 'NOT_CONFIGURED' });
  });

  it('mehrere API-Instanzen: nur der Halter der Sperre alarmiert', async () => {
    await redis.set(LEADER_KEY, 'eine-andere-instanz', 'EX', 120);
    const before = (await events()).length;
    current = snapshot({ workers: 0 });
    expect(await monitor.tick()).toEqual([]);
    expect(await events()).toHaveLength(before);
    await redis.set(LEADER_KEY, monitor['instanceId'], 'EX', 120);
    expect((await monitor.tick()).map((t) => t.to)).toEqual(['DOWN']); // wieder Halter: der aufgelaufene Wechsel wird jetzt gemeldet
  });
});
