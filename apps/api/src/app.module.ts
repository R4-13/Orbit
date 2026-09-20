import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';

/**
 * Root module. This starts as a lean shell (health checks only); each
 * backend module named in §7 of the master spec (AuthModule, TenantModule,
 * CaseModule, FinanceModule, SalesModule, AgentModule, ...) is added here
 * as it's implemented in its respective development phase — see
 * /docs/IMPLEMENTATION_STATUS.md for current status per module.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
          limit: Number(process.env.RATE_LIMIT_MAX ?? 120),
        },
      ],
    }),
    HealthModule,
  ],
})
export class AppModule {}
