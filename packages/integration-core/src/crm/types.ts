/**
 * Provider-agnostic contract for the CRM connector (HubSpot — §10). Covers
 * the Sales workflow's needs: upserting contacts/companies, creating a
 * lead/opportunity record, and logging an activity against a contact.
 */

export interface CrmContactRecord {
  externalId: string;
  email?: string;
  firstName: string;
  lastName: string;
}

export interface UpsertContactInput {
  email?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  companyExternalId?: string;
}

export interface CrmCompanyRecord {
  externalId: string;
  name: string;
}

export interface UpsertCompanyInput {
  name: string;
  domain?: string;
}

export interface CreateLeadInput {
  contactExternalId: string;
  companyExternalId?: string;
  source: string;
  notes?: string;
}

export interface CreateLeadResult {
  externalId: string;
}

export interface LogActivityInput {
  contactExternalId: string;
  activityType: string;
  summary: string;
  occurredAt: Date;
}

export interface CrmConnector {
  readonly providerName: string;

  testConnection(): Promise<boolean>;

  /** Matched by email when provided, otherwise creates a new contact. */
  upsertContact(input: UpsertContactInput): Promise<CrmContactRecord>;
  /** Matched by domain when provided, otherwise creates a new company. */
  upsertCompany(input: UpsertCompanyInput): Promise<CrmCompanyRecord>;
  createLead(input: CreateLeadInput): Promise<CreateLeadResult>;
  logActivity(input: LogActivityInput): Promise<void>;
}
