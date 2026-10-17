import { Injectable } from '@nestjs/common';
import type { CreateCustomerInput, CustomerDirectory, CustomerLookupQuery, CustomerLookupResult, CustomerMatch } from '@orbit/integration-core';
import { HubSpotApiError } from '@orbit/integration-core';
import type { ContactsService } from '../../contacts/contacts.service';
import { HubSpotService } from '../../connectors/hubspot.service';
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
      const db = this.prisma.forTenantId(query.tenantId);
      const email = query.email.trim();
      // Erst der Treffer über den Index (Adresse wie angegeben bzw. klein geschrieben); nur wenn nichts gefunden wird, die groß/klein-unabhängige Suche.
      let found = await db.contact.findMany({ where: { tenantId: query.tenantId, email: { in: [...new Set([email, email.toLowerCase()])] } }, take: 5 });
      if (found.length === 0) found = await db.contact.findMany({ where: { tenantId: query.tenantId, email: { equals: email, mode: 'insensitive' } }, take: 5 });
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

/**
 * HubSpot als Kundenverzeichnis: nur für Betriebe, die HubSpot verbunden haben (`appliesTo`). Eine Suche, die HubSpot nicht beantworten kann (Ausfall, Drosselung, abgelehnter
 * Schlüssel), ist `UNAVAILABLE` – nie `NOT_FOUND`, sonst würde ORBIT einen Kunden doppelt anlegen, sobald HubSpot wieder antwortet.
 */
@Injectable()
export class HubSpotCustomerDirectory implements CustomerDirectory {
  readonly systemKey = 'HUBSPOT';
  readonly label = 'HubSpot';
  readonly canCreate = true;

  constructor(private readonly hubspot: HubSpotService) {}

  appliesTo(tenantId: string): Promise<boolean> {
    return this.hubspot.isConnected(tenantId);
  }

  async lookup(query: CustomerLookupQuery): Promise<CustomerLookupResult> {
    try {
      const found = await this.hubspot.connector.findContactByEmail(query.tenantId, query.email);
      if (!found) return { outcome: 'NOT_FOUND', matches: [] };
      return { outcome: 'FOUND', matches: [{ externalId: found.externalId, displayName: `${found.firstName} ${found.lastName}`.trim() || (found.email ?? query.email), email: found.email }] };
    } catch (error) {
      if (error instanceof HubSpotApiError && error.status === 401) await this.hubspot.noteRejected(query.tenantId);
      return { outcome: 'UNAVAILABLE', matches: [], reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async create(input: CreateCustomerInput): Promise<CustomerMatch> {
    const record = await this.hubspot.connector.createContactRecord(input.tenantId, { email: input.email.trim().toLowerCase(), firstName: input.firstName, lastName: input.lastName });
    return { externalId: record.externalId, displayName: `${record.firstName} ${record.lastName}`.trim(), email: record.email };
  }
}
