import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { findRepoRootEnvFile, type OrbitEnv } from '@orbit/config';
import { AgentModule } from './agent/agent.module';
import { AgentDefinitionsModule } from './agent-definitions/agent-definitions.module';
import { AiProvidersModule } from './ai-providers/ai-providers.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { CompaniesModule } from './companies/companies.module';
import { EnvModule } from './config/env.module';
import { ORBIT_ENV } from './config/env.token';
import { ConnectorsModule } from './connectors/connectors.module';
import { ContactsModule } from './contacts/contacts.module';
import { DocumentsModule } from './documents/documents.module';
import { EmailMessagesModule } from './email-messages/email-messages.module';
import { FollowUpsModule } from './follow-ups/follow-ups.module';
import { HealthModule } from './health/health.module';
import { IntakeModule } from './intake/intake.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LeadsModule } from './leads/leads.module';
import { MeetingsModule } from './meetings/meetings.module';
import { MetricsModule } from './metrics/metrics.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { RetentionModule } from './retention/retention.module';
import { SecurityModule } from './security/security.module';
import { StorageModule } from './storage/storage.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TasksModule } from './tasks/tasks.module';
import { TenantsModule } from './tenants/tenants.module';
import { ThrottlerRedisStorageService } from './throttler/throttler-redis-storage.service';
import { ThrottlerStorageModule } from './throttler/throttler-storage.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WorkflowsModule } from './workflows/workflows.module';

/**
 * Root module. Each backend module named in §7 of the master spec
 * (CaseModule, FinanceModule, SalesModule, AgentModule, ...) is added here
 * as it's implemented in its respective development phase — see
 * /docs/IMPLEMENTATION_STATUS.md for current status per module.
 *
 * Route-protection convention: there is no global JwtAuthGuard. Each
 * controller/route that needs authentication or a specific permission
 * applies `@UseGuards(JwtAuthGuard, PermissionsGuard)` (+ optionally
 * `@RequirePermissions(...)`) explicitly — see auth/guards. Only
 * AuthController's own endpoints and HealthController are meant to stay
 * public.
 */
const rootEnvFile = findRepoRootEnvFile(__dirname);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: rootEnvFile ? [rootEnvFile] : undefined }),
    EnvModule,
    ThrottlerStorageModule,
    // docs/SCALABILITY_CONCEPT.md — Redis-backed storage instead of the
    // library default (an in-memory Map, correct only within a single
    // process): with multiple API replicas behind a load balancer, each
    // replica's in-memory counter would be independently wrong — a
    // client could get `RATE_LIMIT_MAX` requests *per replica* instead
    // of in total. `forRootAsync` (not `forRoot`) is required here
    // because the storage instance needs DI (ORBIT_ENV) to exist before
    // ThrottlerModule can use it; this also switches the two rate-limit
    // env vars from a raw, duplicated-default `process.env` read to the
    // same Zod-validated `OrbitEnv` every other module already uses.
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      inject: [ORBIT_ENV, ThrottlerRedisStorageService],
      useFactory: (env: OrbitEnv, storage: ThrottlerRedisStorageService) => ({
        throttlers: [{ ttl: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX }],
        storage,
      }),
    }),
    PrismaModule,
    AuditModule,
    MetricsModule,
    SecurityModule,
    StorageModule,
    ConnectorsModule,
    PolicyModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    CasesModule,
    TasksModule,
    DocumentsModule,
    EmailMessagesModule,
    ApprovalsModule,
    SuppliersModule,
    InvoicesModule,
    CompaniesModule,
    ContactsModule,
    LeadsModule,
    OpportunitiesModule,
    MeetingsModule,
    AgentModule,
    AiProvidersModule,
    AgentDefinitionsModule,
    WorkflowsModule,
    RetentionModule,
    FollowUpsModule,
    IntakeModule,
    IntegrationsModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [
    // ThrottlerModule.forRoot() above only *registers* the rate-limit
    // config — without this, no request was ever actually being throttled
    // (found while writing Phase 15's security hardening pass: no
    // controller applied ThrottlerGuard, and there was no APP_GUARD either,
    // so RATE_LIMIT_MAX/_WINDOW_MS had zero effect). Global, so every route
    // (including AuthController's public login/refresh) gets at least the
    // default limit; @Throttle() on individual routes (see
    // AuthController.login/refresh) layers a stricter one on top.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
