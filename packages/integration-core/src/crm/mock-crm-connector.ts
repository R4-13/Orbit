import { randomUUID } from 'node:crypto';
import type {
  CreateLeadInput,
  CreateLeadResult,
  CrmCompanyRecord,
  CrmConnector,
  CrmContactRecord,
  LogActivityInput,
  UpsertCompanyInput,
  UpsertContactInput,
} from './types';

/**
 * Deterministic in-memory CRM connector (CRM_CONNECTOR=mock, the default —
 * see @orbit/config/env.ts). Upserts are keyed the same way the real
 * HubSpot connector will be (email for contacts, domain for companies) so
 * Sales-workflow logic written against this mock transfers unchanged.
 */
export class MockCrmConnector implements CrmConnector {
  readonly providerName = 'mock';

  private readonly contactsByEmail = new Map<string, CrmContactRecord>();
  private readonly contactsById = new Map<string, CrmContactRecord>();
  private readonly companiesByDomain = new Map<string, CrmCompanyRecord>();
  private readonly companiesById = new Map<string, CrmCompanyRecord>();
  private readonly leads: CreateLeadInput[] = [];
  private readonly activities: LogActivityInput[] = [];

  async testConnection(): Promise<boolean> {
    return true;
  }

  async upsertContact(input: UpsertContactInput): Promise<CrmContactRecord> {
    const existing = input.email ? this.contactsByEmail.get(input.email) : undefined;
    const record: CrmContactRecord = {
      externalId: existing?.externalId ?? `mock-contact-${randomUUID()}`,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    };
    this.contactsById.set(record.externalId, record);
    if (input.email) this.contactsByEmail.set(input.email, record);
    return record;
  }

  async upsertCompany(input: UpsertCompanyInput): Promise<CrmCompanyRecord> {
    const existing = input.domain ? this.companiesByDomain.get(input.domain) : undefined;
    const record: CrmCompanyRecord = {
      externalId: existing?.externalId ?? `mock-company-${randomUUID()}`,
      name: input.name,
    };
    this.companiesById.set(record.externalId, record);
    if (input.domain) this.companiesByDomain.set(input.domain, record);
    return record;
  }

  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    if (!this.contactsById.has(input.contactExternalId)) {
      throw new Error(`Mock CRM: unknown contact "${input.contactExternalId}".`);
    }
    this.leads.push(input);
    return { externalId: `mock-lead-${randomUUID()}` };
  }

  async logActivity(input: LogActivityInput): Promise<void> {
    if (!this.contactsById.has(input.contactExternalId)) {
      throw new Error(`Mock CRM: unknown contact "${input.contactExternalId}".`);
    }
    this.activities.push(input);
  }

  /** Test/dev helper — not part of the CrmConnector contract. */
  getRecordedLeads(): readonly CreateLeadInput[] {
    return this.leads;
  }

  /** Test/dev helper — not part of the CrmConnector contract. */
  getRecordedActivities(): readonly LogActivityInput[] {
    return this.activities;
  }
}
