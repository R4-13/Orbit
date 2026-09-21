import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Contact } from '@orbit/domain';
import type { CrmConnector } from '@orbit/integration-core';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertContactInput {
  email?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  companyId?: string;
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CRM_CONNECTOR) private readonly crmConnector: CrmConnector,
  ) {}

  async upsert(tenantId: string, actorUserId: string, input: UpsertContactInput): Promise<Contact> {
    const existing = input.email
      ? await this.prisma.forTenantId(tenantId).contact.findFirst({ where: { email: input.email } })
      : null;
    if (existing) {
      return existing;
    }

    const crmContact = await this.crmConnector.upsertContact({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });

    const contact = await this.prisma.forTenantId(tenantId).contact.create({
      data: {
        tenantId,
        companyId: input.companyId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        crmExternalId: crmContact.externalId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'CONTACT_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Contact',
      entityId: contact.id,
      payload: { email: contact.email },
    });

    return contact;
  }

  findAll(tenantId: string): Promise<Contact[]> {
    return this.prisma.forTenantId(tenantId).contact.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(tenantId: string, id: string): Promise<Contact> {
    const found = await this.prisma.forTenantId(tenantId).contact.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Contact not found.', { id });
    }
    return found;
  }
}
