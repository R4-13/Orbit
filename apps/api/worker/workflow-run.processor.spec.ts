import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../src/config/env.token';
import { TenantConcurrencyService } from '../src/queue/tenant-concurrency.service';
import { WORKFLOW_RUNS_QUEUE } from '../src/queue/queue.tokens';
import { WorkflowRunnerService } from '../src/workflows/workflow-runner.service';
import type { WorkflowRunJobData } from '../src/workflows/workflow-run-queue.service';
import { WorkflowRunProcessor } from './workflow-run.processor';

describe('WorkflowRunProcessor', () => {
  let processor: WorkflowRunProcessor;
  let runner: { executeQueuedRun: jest.Mock };
  let concurrency: { acquireSlot: jest.Mock; releaseSlot: jest.Mock };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    runner = { executeQueuedRun: jest.fn().mockResolvedValue({ workflowRunId: 'wfr_1', status: 'COMPLETED', steps: [] }) };
    concurrency = {
      acquireSlot: jest.fn().mockResolvedValue(true),
      releaseSlot: jest.fn().mockResolvedValue(undefined),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowRunProcessor,
        { provide: WorkflowRunnerService, useValue: runner },
        { provide: TenantConcurrencyService, useValue: concurrency },
        { provide: getQueueToken(WORKFLOW_RUNS_QUEUE), useValue: queue },
        { provide: ORBIT_ENV, useValue: { TENANT_MAX_CONCURRENT_WORKFLOW_RUNS: 5 } as OrbitEnv },
      ],
    }).compile();

    processor = moduleRef.get(WorkflowRunProcessor);
  });

  it('acquires a tenant concurrency slot, calls executeQueuedRun(), then releases the slot', async () => {
    const job = { data: { tenantId: 'tenant_1', actorUserId: 'user_1', workflowRunId: 'wfr_1' } } as Job<WorkflowRunJobData>;

    await processor.process(job);

    expect(concurrency.acquireSlot).toHaveBeenCalledWith('workflow-runs', 'tenant_1', 'wfr_1', 5);
    expect(runner.executeQueuedRun).toHaveBeenCalledWith('tenant_1', 'user_1', 'wfr_1');
    expect(concurrency.releaseSlot).toHaveBeenCalledWith('workflow-runs', 'tenant_1', 'wfr_1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('releases the slot even when executeQueuedRun() throws', async () => {
    runner.executeQueuedRun.mockRejectedValue(new Error('boom'));
    const job = { data: { tenantId: 'tenant_1', actorUserId: 'user_1', workflowRunId: 'wfr_1' } } as Job<WorkflowRunJobData>;

    await expect(processor.process(job)).rejects.toThrow('boom');

    expect(concurrency.releaseSlot).toHaveBeenCalledWith('workflow-runs', 'tenant_1', 'wfr_1');
  });

  it('self-requeues (does not execute, does not throw) when the tenant is at its concurrency limit', async () => {
    concurrency.acquireSlot.mockResolvedValue(false);
    const job = { data: { tenantId: 'tenant_1', actorUserId: 'user_1', workflowRunId: 'wfr_1' } } as Job<WorkflowRunJobData>;

    await processor.process(job);

    expect(runner.executeQueuedRun).not.toHaveBeenCalled();
    expect(concurrency.releaseSlot).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('run', job.data, { attempts: 1, delay: 2000 });
  });
});
