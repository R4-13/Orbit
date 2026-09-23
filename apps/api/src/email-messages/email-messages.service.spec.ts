import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { EmailMessagesService } from './email-messages.service';

describe('EmailMessagesService', () => {
  let service: EmailMessagesService;
  let scoped: { emailMessage: { findMany: jest.Mock; findUnique: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };

  beforeEach(async () => {
    scoped = { emailMessage: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() } };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };

    const moduleRef = await Test.createTestingModule({
      providers: [EmailMessagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(EmailMessagesService);
  });

  it('lists the tenant’s email messages, newest first', async () => {
    scoped.emailMessage.findMany.mockResolvedValue([{ id: 'email_1' }]);
    const result = await service.findAll('tenant_1');
    expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
    expect(scoped.emailMessage.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 100 });
    expect(result).toEqual([{ id: 'email_1' }]);
  });

  it('findOne() throws NotFoundError for a missing message', async () => {
    scoped.emailMessage.findUnique.mockResolvedValue(null);
    await expect(service.findOne('tenant_1', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
