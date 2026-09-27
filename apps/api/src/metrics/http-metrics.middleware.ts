import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Records `http_request_duration_seconds` for every request. Uses
 * `req.route?.path` (the parameterized pattern, e.g.
 * `/workflow-definitions/:key/runs`) rather than `req.path` (which would
 * contain real IDs) — an unbounded set of label values is a well-known
 * way to blow up a Prometheus server's memory (cardinality explosion).
 * `req.route` is only populated once Express has matched a route, which
 * has happened by the time the `finish` event fires.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      this.metrics.httpRequestDuration.observe({ method: req.method, route, status_code: String(res.statusCode) }, durationSeconds);
    });

    next();
  }
}
