import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { findRepoRootEnvFile } from '@orbit/config';
import { AuditModule } from '../src/audit/audit.module';
import { EnvModule } from '../src/config/env.module';
import { MetricsModule } from '../src/metrics/metrics.module';
import { PolicyModule } from '../src/policy/policy.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { QueueModule } from '../src/queue/queue.module';
import { SecurityModule } from '../src/security/security.module';
import { WorkflowsModule } from '../src/workflows/workflows.module';
import { WorkflowRunProcessor } from './workflow-run.processor';

const rootEnvFile = findRepoRootEnvFile(__dirname);

/**
 * docs/SCALABILITY_CONCEPT.md — this is the first time anything is
 * actually registered here; `main.ts`'s "Queue processors are
 * registered on WorkerModule as they're implemented in Phase 5 onward"
 * comment has been true and unactioned since Phase 1.
 *
 * A separate NestJS application context from `AppModule` (see
 * `main.ts` — `createApplicationContext`, no HTTP server), so every
 * `@Global()` module the imported feature modules transitively need
 * (PrismaModule/AuditModule/PolicyModule/SecurityModule) must be imported
 * here too, even though `AppModule` already does the same for the API
 * process — global-ness only spans one application context, not the
 * whole monorepo. `SecurityModule` added in Phase 4 (LLM Provider
 * Platform): `WorkflowsModule` → `AgentDefinitionsModule` →
 * `AiProvidersModule` now needs `CredentialEncryptionService` to decrypt
 * a tenant's BYOK provider credential at runtime — added proactively
 * this time instead of repeating the exact `MetricsModule` crash-loop
 * bug this same doc comment already warned about (Phase 2, see
 * docs/ASSUMPTIONS.md #212).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: rootEnvFile ? [rootEnvFile] : undefined }),
    EnvModule,
    PrismaModule,
    AuditModule,
    MetricsModule,
    PolicyModule,
    QueueModule,
    SecurityModule,
    WorkflowsModule,
  ],
  providers: [WorkflowRunProcessor],
})
export class WorkerModule {}
