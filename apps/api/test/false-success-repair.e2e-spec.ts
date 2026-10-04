import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { FalseSuccessRepairService, type FalseSuccessRepairTarget } from '../src/repair/false-success-repair.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/** Amendment 02 §24.3 / §25.2 — corrects a provably wrong COMPLETED status with audit, without deleting or restarting anything. */
describe('False-success status repair (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repair: FalseSuccessRepairService;
  let tenantsService: TenantsService;
  const tenants: string[] = [];

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({
      name: `E2E Repair ${suffix}`,
      slug: `e2e-repair-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-repair.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenants.push(tenant.id);
    return tenant.id;
  }

  /** Builds the exact shape of the reported incident in a throwaway tenant. */
  async function seedFalseSuccess(tenantId: string, options: { failedToolStatus?: 'FAILED' | 'SUCCESS' } = {}) {
    const scoped = prisma.forTenantId(tenantId);
    const completedAt = new Date('2026-10-04T13:46:02.425Z');
    const integration = await scoped.integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED' } });
    const definition = await scoped.workflowDefinition.findFirstOrThrow({ where: { key: 'sales-lead-intake' } });
    const run = await scoped.workflowRun.create({
      data: { tenantId, workflowDefinitionId: definition.id, status: 'COMPLETED', startedAt: new Date('2026-10-04T13:46:02.229Z'), completedAt },
    });
    const agentRun = await scoped.agentRun.create({ data: { tenantId, agentType: 'SALES', triggerType: 'EMAIL', status: 'FAILED' } });
    await scoped.workflowStepRun.create({
      data: { tenantId, workflowRunId: run.id, stepOrder: 1, agentRunId: agentRun.id, status: 'SUCCEEDED' },
    });
    await scoped.toolInvocation.create({
      data: { tenantId, agentRunId: agentRun.id, toolCallId: 'tc_create_lead', toolName: 'create_lead', status: options.failedToolStatus ?? 'FAILED' },
    });
    const externalEventId = `gmail-${randomUUID()}`;
    const intake = await scoped.intakeEvent.create({
      data: {
        tenantId,
        connectionId: integration.id,
        channel: 'EMAIL',
        provider: 'gmail',
        externalEventId,
        occurredAt: new Date(),
        status: 'COMPLETED',
        workflowRunId: run.id,
      },
    });
    const target: FalseSuccessRepairTarget = {
      tenantId,
      connectionId: integration.id,
      externalEventId,
      intakeEventId: intake.id,
      workflowRunId: run.id,
      agentRunId: agentRun.id,
      failedToolName: 'create_lead',
      reason: 'e2e: create_lead failed but run/intake were reported COMPLETED',
      executedBy: 'e2e test',
    };
    return { target, completedAt, run, intake };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    tenantsService = app.get(TenantsService);
    repair = new FalseSuccessRepairService(prisma);
  });

  afterAll(async () => {
    for (const tenantId of tenants) {
      await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    }
    await app.close();
  });

  it('sets IntakeEvent and WorkflowRun to FAILED, keeps timestamps and evidence, writes audit events, deletes nothing', async () => {
    const tenantId = await newTenant();
    const { target, completedAt, run, intake } = await seedFalseSuccess(tenantId);

    const result = await repair.repair(target);

    expect(result).toMatchObject({
      changed: true,
      previous: { intakeStatus: 'COMPLETED', workflowRunStatus: 'COMPLETED' },
      current: { intakeStatus: 'FAILED', workflowRunStatus: 'FAILED' },
    });
    const scoped = prisma.forTenantId(tenantId);
    const fixedIntake = await scoped.intakeEvent.findUniqueOrThrow({ where: { id: intake.id } });
    const fixedRun = await scoped.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fixedIntake.status).toBe('FAILED');
    expect(fixedIntake.errorMessage).toContain('create_lead');
    expect(fixedIntake.workflowRunId).toBe(run.id);
    expect(fixedRun.status).toBe('FAILED');
    expect(fixedRun.completedAt?.toISOString()).toBe(completedAt.toISOString()); // original timestamp preserved
    expect((fixedIntake.metadata as { statusCorrection: { previousStatus: string } }).statusCorrection.previousStatus).toBe('COMPLETED');

    const audits = await scoped.auditLog.findMany({ where: { eventType: 'STATUS_CORRECTED' } });
    expect(audits.map((a) => a.entityType).sort()).toEqual(['IntakeEvent', 'WorkflowRun']);
    expect(audits[0]?.payload).toMatchObject({ reason: target.reason, executedBy: 'e2e test', failedToolName: 'create_lead' });

    // No restart, no invented success: still exactly one run, no lead.
    expect(await scoped.workflowRun.count()).toBe(1);
    expect(await scoped.lead.count()).toBe(0);
  });

  it('is idempotent — a second run changes nothing and writes no further audit event', async () => {
    const tenantId = await newTenant();
    const { target } = await seedFalseSuccess(tenantId);
    await repair.repair(target);

    const second = await repair.repair(target);

    expect(second.changed).toBe(false);
    expect(await prisma.forTenantId(tenantId).auditLog.count({ where: { eventType: 'STATUS_CORRECTED' } })).toBe(2);
  });

  it('refuses to change anything when the persisted failure evidence is missing', async () => {
    const tenantId = await newTenant();
    const { target, intake } = await seedFalseSuccess(tenantId, { failedToolStatus: 'SUCCESS' });

    await expect(repair.repair(target)).rejects.toThrow(/No persisted failure evidence/);

    expect((await prisma.forTenantId(tenantId).intakeEvent.findUniqueOrThrow({ where: { id: intake.id } })).status).toBe('COMPLETED');
  });

  it('does not touch a record that belongs to another tenant, and a subject-only match is impossible', async () => {
    const tenantA = await newTenant();
    const tenantB = await newTenant();
    const { target } = await seedFalseSuccess(tenantA);

    await expect(repair.repair({ ...target, tenantId: tenantB })).rejects.toThrow(/does not match tenant/);
  });
});
