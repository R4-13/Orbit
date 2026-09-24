import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { WorkflowRunnerService } from '../src/workflows/workflow-runner.service';
import type { WorkflowRunJobData } from '../src/workflows/workflow-run-queue.service';
import { WorkflowRunProcessor } from './workflow-run.processor';

describe('WorkflowRunProcessor', () => {
  let processor: WorkflowRunProcessor;
  let runner: { executeQueuedRun: jest.Mock };

  beforeEach(async () => {
    runner = { executeQueuedRun: jest.fn().mockResolvedValue({ workflowRunId: 'wfr_1', status: 'COMPLETED', steps: [] }) };

    const moduleRef = await Test.createTestingModule({
      providers: [WorkflowRunProcessor, { provide: WorkflowRunnerService, useValue: runner }],
    }).compile();

    processor = moduleRef.get(WorkflowRunProcessor);
  });

  it('calls WorkflowRunnerService.executeQueuedRun() with the job\'s tenantId/actorUserId/workflowRunId', async () => {
    const job = { data: { tenantId: 'tenant_1', actorUserId: 'user_1', workflowRunId: 'wfr_1' } } as Job<WorkflowRunJobData>;

    await processor.process(job);

    expect(runner.executeQueuedRun).toHaveBeenCalledWith('tenant_1', 'user_1', 'wfr_1');
  });

  it('propagates an error from executeQueuedRun() so BullMQ marks the job failed', async () => {
    runner.executeQueuedRun.mockRejectedValue(new Error('boom'));
    const job = { data: { tenantId: 'tenant_1', actorUserId: 'user_1', workflowRunId: 'wfr_1' } } as Job<WorkflowRunJobData>;

    await expect(processor.process(job)).rejects.toThrow('boom');
  });
});
