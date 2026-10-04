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
 * Deterministic in-memory CRM connector for unit tests. The running API's
 * `CRM_CONNECTOR=mock` uses the Postgres-backed `PersistentMockCrmConnector`
 * (apps/api) instead, so stored `crmExternalId` references survive restarts
 * (Amendment 02 §12.5) — this class deliberately does not try to fake that
 * by accepting "formally similar" ids. Upserts are keyed the same way the
 * real HubSpot connector will be (email for contacts, domain for companies).
 */
export class MockCrmConnector implements CrmConnector {
  readonly providerName = 'mock';

  // Every map is keyed by `${tenantId}|…`, so a reference issued to one tenant can never resolve for another.
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
    const existing = input.email ? this.contactsByEmail.get(`${input.tenantId}|${input.email}`) : undefined;
    const record: CrmContactRecord = {
      externalId: existing?.externalId ?? `mock-contact-${randomUUID()}`,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    };
    this.contactsById.set(`${input.tenantId}|${record.externalId}`, record);
    if (input.email) this.contactsByEmail.set(`${input.tenantId}|${input.email}`, record);
    return record;
  }

  async upsertCompany(input: UpsertCompanyInput): Promise<CrmCompanyRecord> {
    const existing = input.domain ? this.companiesByDomain.get(`${input.tenantId}|${input.domain}`) : undefined;
    const record: CrmCompanyRecord = {
      externalId: existing?.externalId ?? `mock-company-${randomUUID()}`,
      name: input.name,
    };
    this.companiesById.set(`${input.tenantId}|${record.externalId}`, record);
    if (input.domain) this.companiesByDomain.set(`${input.tenantId}|${input.domain}`, record);
    return record;
  }

  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    if (!this.contactsById.has(`${input.tenantId}|${input.contactExternalId}`)) {
      throw new Error(`Mock CRM: unknown contact "${input.contactExternalId}".`);
    }
    this.leads.push(input);
    return { externalId: `mock-lead-${randomUUID()}` };
  }

  async logActivity(input: LogActivityInput): Promise<void> {
    if (!this.contactsById.has(`${input.tenantId}|${input.contactExternalId}`)) {
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
