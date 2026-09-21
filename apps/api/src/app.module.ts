import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { findRepoRootEnvFile } from '@orbit/config';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { CompaniesModule } from './companies/companies.module';
import { EnvModule } from './config/env.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { ContactsModule } from './contacts/contacts.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LeadsModule } from './leads/leads.module';
import { MeetingsModule } from './meetings/meetings.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TasksModule } from './tasks/tasks.module';
import { TenantsModule } from './tenants/tenants.module';

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
    StorageModule,
    ConnectorsModule,
    PolicyModule,
    TenantsModule,
    AuthModule,
    CasesModule,
    TasksModule,
    DocumentsModule,
    ApprovalsModule,
    SuppliersModule,
    InvoicesModule,
    CompaniesModule,
    ContactsModule,
    LeadsModule,
    OpportunitiesModule,
    MeetingsModule,
    HealthModule,
  ],
})
export class AppModule {}
