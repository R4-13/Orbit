import { Test } from '@nestjs/testing';
import { HealthCheckError, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { getQueueToken } from '@nestjs/bullmq';
import { WORKFLOW_RUNS_QUEUE } from '../queue/queue.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };
  let prismaIndicator: { pingCheck: jest.Mock };
  let prisma: object;
  let queue: { client: Promise<{ status: string }> };

  async function build() {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: PrismaHealthIndicator, useValue: prismaIndicator },
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(WORKFLOW_RUNS_QUEUE), useValue: queue },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  }

  beforeEach(() => {
    health = { check: jest.fn().mockResolvedValue({ status: 'ok' }) };
    prismaIndicator = { pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }) };
    prisma = {};
    queue = { client: Promise.resolve({ status: 'ready' }) };
  });

  it('check() (liveness) runs no indicators — just confirms the process is up', async () => {
    await build();
    await controller.check();
    expect(health.check).toHaveBeenCalledWith([]);
  });

  describe('ready() (readiness)', () => {
    it('passes two indicator functions to HealthCheckService.check()', async () => {
      await build();
      await controller.ready();
      expect(health.check).toHaveBeenCalledWith([expect.any(Function), expect.any(Function)]);
    });

    it('the database indicator delegates to PrismaHealthIndicator.pingCheck() with the PrismaService instance', async () => {
      await build();
      await controller.ready();
      const [dbCheck] = health.check.mock.calls[0][0] as [() => unknown, () => unknown];

      await dbCheck();

      expect(prismaIndicator.pingCheck).toHaveBeenCalledWith('database', prisma);
    });

    it('the redis indicator reports "up" when the BullMQ client status is "ready"', async () => {
      await build();
      await controller.ready();
      const [, redisCheck] = health.check.mock.calls[0][0] as [() => Promise<unknown>, () => Promise<unknown>];

      await expect(redisCheck()).resolves.toEqual({ redis: { status: 'up' } });
    });

    it('the redis indicator throws HealthCheckError when the client status is not "ready"', async () => {
      queue = { client: Promise.resolve({ status: 'connecting' }) };
      await build();
      await controller.ready();
      const [, redisCheck] = health.check.mock.calls[0][0] as [() => Promise<unknown>, () => Promise<unknown>];

      await expect(redisCheck()).rejects.toThrow(HealthCheckError);
    });

    it('the redis indicator throws HealthCheckError when reading the client itself fails', async () => {
      queue = { client: Promise.reject(new Error('ECONNREFUSED')) };
      await build();
      await controller.ready();
      const [, redisCheck] = health.check.mock.calls[0][0] as [() => Promise<unknown>, () => Promise<unknown>];

      await expect(redisCheck()).rejects.toThrow(HealthCheckError);
    });
  });
});
