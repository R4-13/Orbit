import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { WORKFLOW_RUNS_QUEUE } from '../queue/queue.tokens';
import { WorkflowRunnerService } from './workflow-runner.service';
import { WorkflowRunQueueService } from './workflow-run-queue.service';

describe('WorkflowRunQueueService', () => {
  let service: WorkflowRunQueueService;
  let queue: { add: jest.Mock };
  let runner: { createQueuedRun: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'job_1' }) };
    runner = { createQueuedRun: jest.fn().mockResolvedValue({ workflowRunId: 'wfr_1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowRunQueueService,
        { provide: getQueueToken(WORKFLOW_RUNS_QUEUE), useValue: queue },
        { provide: WorkflowRunnerService, useValue: runner },
      ],
    }).compile();

    service = moduleRef.get(WorkflowRunQueueService);
  });

  it('creates the WorkflowRun row via the runner before enqueuing anything', async () => {
    const callOrder: string[] = [];
    runner.createQueuedRun.mockImplementation(async () => {
      callOrder.push('createQueuedRun');
      return { workflowRunId: 'wfr_1' };
    });
    queue.add.mockImplementation(async () => {
      callOrder.push('queue.add');
      return { id: 'job_1' };
    });

    await service.enqueueTrigger('tenant_1', 'user_1', 'wf-1', { subject: 'x' });

    expect(callOrder).toEqual(['createQueuedRun', 'queue.add']);
  });

  it('enqueues a job carrying tenantId/actorUserId/workflowRunId, with no automatic retry', async () => {
    const result = await service.enqueueTrigger('tenant_1', 'user_1', 'wf-1', { subject: 'x' });

    expect(runner.createQueuedRun).toHaveBeenCalledWith('tenant_1', 'wf-1', { subject: 'x' });
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      { tenantId: 'tenant_1', actorUserId: 'user_1', workflowRunId: 'wfr_1' },
      { attempts: 1 },
    );
    expect(result).toEqual({ workflowRunId: 'wfr_1' });
  });

  it('propagates a NotFoundError from createQueuedRun() without ever enqueuing a job', async () => {
    runner.createQueuedRun.mockRejectedValue(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }));

    await expect(service.enqueueTrigger('tenant_1', 'user_1', 'does-not-exist', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
