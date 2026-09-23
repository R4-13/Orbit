import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { findRepoRootEnvFile } from '@orbit/config';
import { AgentModule } from './agent/agent.module';
import { AgentDefinitionsModule } from './agent-definitions/agent-definitions.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { CompaniesModule } from './companies/companies.module';
import { EnvModule } from './config/env.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { ContactsModule } from './contacts/contacts.module';
import { DocumentsModule } from './documents/documents.module';
import { EmailMessagesModule } from './email-messages/email-messages.module';
import { HealthModule } from './health/health.module';
import { IntakeModule } from './intake/intake.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LeadsModule } from './leads/leads.module';
import { MeetingsModule } from './meetings/meetings.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { SecurityModule } from './security/security.module';
import { StorageModule } from './storage/storage.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TasksModule } from './tasks/tasks.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

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
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
          limit: Number(process.env.RATE_LIMIT_MAX ?? 120),
        },
      ],
    }),
    PrismaModule,
    AuditModule,
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
    AgentDefinitionsModule,
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
