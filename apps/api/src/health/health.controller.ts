import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

/**
 * Liveness/readiness endpoints. `/health` is a simple liveness probe used
 * by Docker healthchecks; `/health/ready` will be extended in Phase 2/5 to
 * check DB, Redis and object storage connectivity once those clients exist.
 */
@ApiTags('health')
@Controller({ path: 'v1/health', version: '' })
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([]);
  }
}
