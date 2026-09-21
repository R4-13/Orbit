import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let scoped: {
    contact: { findUnique: jest.Mock };
    lead: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let tasks: { create: jest.Mock };
  let crmConnector: { createLead: jest.Mock };

  beforeEach(async () => {
    scoped = {
      contact: { findUnique: jest.fn() },
      lead: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    tasks = { create: jest.fn().mockResolvedValue({ id: 'task_1' }) };
    crmConnector = { createLead: jest.fn().mockResolvedValue({ externalId: 'mock-lead-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: TasksService, useValue: tasks },
        { provide: CRM_CONNECTOR, useValue: crmConnector },
      ],
    }).compile();

    service = moduleRef.get(LeadsService);
  });

  it('create() throws NotFoundError for an unknown contact', async () => {
    scoped.contact.findUnique.mockResolvedValue(null);
    await expect(
      service.create('tenant_1', 'user_1', { contactId: 'missing', source: 'EMAIL' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('create() registers the lead with the CRM connector and creates a follow-up task', async () => {
    scoped.contact.findUnique.mockResolvedValue({
      id: 'c_1',
      firstName: 'Kim',
      lastName: 'Kunde',
      crmExternalId: 'mock-contact-1',
    });
    scoped.lead.create.mockResolvedValue({ id: 'lead_1', source: 'EMAIL' });

    const result = await service.create('tenant_1', 'user_1', { contactId: 'c_1', source: 'EMAIL' });

    expect(crmConnector.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ contactExternalId: 'mock-contact-1', source: 'EMAIL' }),
    );
    expect(result.id).toBe('lead_1');
    expect(tasks.create).toHaveBeenCalledWith(
      'tenant_1',
      'user_1',
      expect.objectContaining({ title: expect.stringContaining('Kim Kunde') }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LEAD_CREATED' }));
  });

  it('updateStatus() throws for an unknown lead, updates otherwise', async () => {
    scoped.lead.findUnique.mockResolvedValueOnce(null);
    await expect(service.updateStatus('tenant_1', 'missing', 'QUALIFIED')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    scoped.lead.findUnique.mockResolvedValueOnce({ id: 'lead_1', status: 'NEW' });
    scoped.lead.update.mockResolvedValue({ id: 'lead_1', status: 'QUALIFIED' });
    const result = await service.updateStatus('tenant_1', 'lead_1', 'QUALIFIED');
    expect(result.status).toBe('QUALIFIED');
  });
});
