import { Test } from '@nestjs/testing';
import { Prisma } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('WebhookIdempotencyService', () => {
  let service: WebhookIdempotencyService;
  let scoped: { webhookEvent: { create: jest.Mock } };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = { webhookEvent: { create: jest.fn() } };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIdempotencyService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(WebhookIdempotencyService);
  });

  it('records a new event and returns true, auditing WEBHOOK_RECEIVED', async () => {
    scoped.webhookEvent.create.mockResolvedValue({ id: 'evt_1' });

    const result = await service.recordIfNew('tenant_1', 'microsoft', 'msg-abc-123');

    expect(result).toBe(true);
    expect(scoped.webhookEvent.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant_1', source: 'microsoft', externalEventId: 'msg-abc-123' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'WEBHOOK_RECEIVED',
        payload: { source: 'microsoft', externalEventId: 'msg-abc-123' },
      }),
    );
  });

  it('returns false without auditing when the same event was already recorded (duplicate delivery)', async () => {
    scoped.webhookEvent.create.mockRejectedValue(uniqueViolation());

    const result = await service.recordIfNew('tenant_1', 'microsoft', 'msg-abc-123');

    expect(result).toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rethrows any other error unchanged', async () => {
    const boom = new Error('connection lost');
    scoped.webhookEvent.create.mockRejectedValue(boom);

    await expect(service.recordIfNew('tenant_1', 'microsoft', 'msg-abc-123')).rejects.toBe(boom);
  });
});
