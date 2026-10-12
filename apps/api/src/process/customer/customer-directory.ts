import { Injectable } from '@nestjs/common';
import type { CreateCustomerInput, CustomerDirectory, CustomerLookupQuery, CustomerLookupResult, CustomerMatch } from '@orbit/integration-core';
import type { ContactsService } from '../../contacts/contacts.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Multi-Provider-Token: alle angebundenen Kundenverzeichnisse eines Betriebs (heute ORBITs eigene Kontakte; CRM/ERP-Adapter kommen mit ihren Zugangsdaten dazu). */
export const CUSTOMER_DIRECTORIES = Symbol('CUSTOMER_DIRECTORIES');

/**
 * ORBITs eigene Kontakte als Kundenverzeichnis: bei kleinen Betrieben ohne CRM/ERP-Anbindung der Kundenstamm. Immer erreichbar (eigene Datenbank), ORBIT darf hier
 * selbstständig anlegen. Die Anlage läuft über den ContactsService (mit Audit und CRM-Abgleich), nicht an ihm vorbei.
 */
@Injectable()
export class OrbitContactsDirectory implements CustomerDirectory {
  readonly systemKey = 'ORBIT_CONTACTS';
  readonly label = 'Kontakte in ORBIT';
  readonly canCreate = true;
  private contacts?: ContactsService;

  constructor(private readonly prisma: PrismaService) {}

  /** Wird vom CustomerRecordService gesetzt (vermeidet eine Konstruktor-Abhängigkeit in beide Richtungen). */
  useContacts(contacts: ContactsService): void {
    this.contacts = contacts;
  }

  async lookup(query: CustomerLookupQuery): Promise<CustomerLookupResult> {
    try {
      const found = await this.prisma.forTenantId(query.tenantId).contact.findMany({ where: { tenantId: query.tenantId, email: { equals: query.email, mode: 'insensitive' } }, take: 5 });
      return {
        outcome: found.length > 0 ? 'FOUND' : 'NOT_FOUND',
        matches: found.map((c): CustomerMatch => ({ externalId: c.id, displayName: `${c.firstName} ${c.lastName}`.trim(), email: c.email ?? undefined })),
      };
    } catch (error) {
      return { outcome: 'UNAVAILABLE', matches: [], reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async create(input: CreateCustomerInput): Promise<CustomerMatch> {
    if (!this.contacts) throw new Error('Kontaktverwaltung nicht verfügbar.');
    const contact = await this.contacts.upsert(input.tenantId, undefined, { email: input.email, firstName: input.firstName, lastName: input.lastName }, 'AGENT');
    return { externalId: contact.id, displayName: `${contact.firstName} ${contact.lastName}`.trim(), email: contact.email ?? undefined };
  }
}
