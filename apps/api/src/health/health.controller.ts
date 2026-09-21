import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

/**
 * Liveness/readiness endpoints. `/health` is a simple liveness probe used
 * by Docker healthchecks; `/health/ready` will be extended in Phase 2/5 to
 * check DB, Redis and object storage connectivity once those clients exist.
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
