import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckError, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { WORKFLOW_RUNS_QUEUE } from '../queue/queue.tokens';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness/readiness endpoints. `/health` is a simple liveness probe used
 * by Docker healthchecks (and, in a real cloud deployment, a Kubernetes
 * `livenessProbe` — no dependency checks, just "is the process up").
 * `/health/ready` is the readiness probe: it actually checks the two
 * external dependencies every request handler can hit (Postgres via
 * `PrismaHealthIndicator`, Redis via a ping against the same BullMQ
 * connection `QueueModule` wires up, docs/SCALABILITY_CONCEPT.md
 * Migrationsschritt 5) — until now a pure placeholder that always
 * returned healthy regardless of whether either dependency was actually
 * reachable, exactly as this file's own long-standing comment promised
 * ("will be extended... once those clients exist").
 *
 * Path convention: controllers declare only their resource segment
 * ("health", "auth", "cases", ...) — the "v1" prefix comes from Nest's
 * global URI versioning (defaultVersion: '1', see main.ts), never hardcoded
 * in the controller path. Combining both (as this controller used to) would
 * double up to /api/v1/v1/....
 */
@ApiTags('health')
@Controller({ path: 'health' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.pingRedis(),
    ]);
  }

  /**
   * No dedicated `@nestjs/terminus` Redis indicator exists (only
   * Postgres/Mongo/MikroORM/Sequelize/TypeORM database indicators, plus a
   * generic `MicroserviceHealthIndicator` that expects a full
   * `@nestjs/microservices` Redis transport config — a different, heavier
   * connection mechanism than the connection `bullmq` already manages for
   * `QueueModule`). Reuses that existing connection instead of opening a
   * second one just for health checks.
   *
   * `bullmq`'s `IRedisClient` interface (v5) abstracts over multiple
   * underlying Redis client libraries and deliberately doesn't expose a
   * raw `PING` command — only the adapter-agnostic `status` field
   * (`'ready'` once connected and responsive; every adapter must expose
   * at least `'ready'`/`'wait'`/`'end'`, per bullmq's own interface
   * doc-comment). That's the supported way to ask "is this connection
   * healthy right now" without reaching past the abstraction.
   */
  private async pingRedis() {
    try {
      const client = await this.queue.client;
      if (client.status !== 'ready') {
        throw new Error(`Redis client status is "${client.status}", not "ready".`);
      }
      return { redis: { status: 'up' as const } };
    } catch (error) {
      throw new HealthCheckError('Redis check failed', {
        redis: { status: 'down' as const, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
