import { Global, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { QueueMetricsService } from './queue-metrics.service';

/**
 * `@Global()` like `AuditModule` — every feature module that records a
 * metric (Workflows, Agent, Approvals) injects the same `MetricsService`
 * without each having to import this module explicitly.
 */
@Global()
@Module({
  imports: [QueueModule],
  controllers: [MetricsController],
  providers: [MetricsService, QueueMetricsService, HttpMetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
