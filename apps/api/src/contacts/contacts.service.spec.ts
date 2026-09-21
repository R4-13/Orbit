import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from './contacts.service';

describe('ContactsService', () => {
  let service: ContactsService;
  let scoped: { contact: { findFirst: jest.Mock; create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock } };
  let audit: { record: jest.Mock };
  let crmConnector: { upsertContact: jest.Mock };

  beforeEach(async () => {
    scoped = {
      contact: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    crmConnector = { upsertContact: jest.fn().mockResolvedValue({ externalId: 'mock-contact-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: CRM_CONNECTOR, useValue: crmConnector },
      ],
    }).compile();

    service = moduleRef.get(ContactsService);
  });

  it('upsert() returns the existing contact by email without creating anything', async () => {
    scoped.contact.findFirst.mockResolvedValue({ id: 'c_1', email: 'kunde@example.com' });

    const result = await service.upsert('tenant_1', 'user_1', {
      email: 'kunde@example.com',
      firstName: 'Kim',
      lastName: 'Kunde',
    });

    expect(result).toEqual({ id: 'c_1', email: 'kunde@example.com' });
    expect(scoped.contact.create).not.toHaveBeenCalled();
  });

  it('upsert() creates a new contact and syncs it with the CRM connector', async () => {
    scoped.contact.create.mockResolvedValue({ id: 'c_new', email: 'neu@example.com' });

    const result = await service.upsert('tenant_1', 'user_1', {
      email: 'neu@example.com',
      firstName: 'Neu',
      lastName: 'Kontakt',
    });

    expect(crmConnector.upsertContact).toHaveBeenCalled();
    expect(scoped.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ crmExternalId: 'mock-contact-1' }),
    });
    expect(result.id).toBe('c_new');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CONTACT_CREATED' }));
  });

  it('findOne() throws NotFoundError for a missing contact', async () => {
    scoped.contact.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });
});
