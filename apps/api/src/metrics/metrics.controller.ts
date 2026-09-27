import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Public, like `HealthController` — Prometheus scrapers don't carry a
 * tenant JWT. In production, restrict network access to this path via
 * the reverse proxy/network policy rather than app-level auth (same
 * caveat as `/health`, see `app.module.ts`'s own comment on which
 * controllers are meant to stay public). `@ApiExcludeController()`
 * keeps the Prometheus exposition format (not JSON) out of the Swagger
 * schema, which otherwise has no way to represent it.
 */
@ApiExcludeController()
@Controller({ path: 'metrics' })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.registry.contentType);
    res.end(await this.metrics.registry.metrics());
  }
}
