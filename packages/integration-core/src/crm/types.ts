/**
 * Provider-agnostic contract for the CRM connector (HubSpot — §10). Covers
 * the Sales workflow's needs: upserting contacts/companies, creating a
 * lead/opportunity record, and logging an activity against a contact.
 */

/**
 * Every call carries the owning tenant. A real CRM connection is per-tenant
 * (Amendment 01 §2.3), so the tenant is part of the call context; mocks use
 * it to keep reference lookups tenant-bound (Amendment 02 §12.5).
 */
export interface CrmCallContext {
  tenantId: string;
}

export interface CrmContactRecord {
  externalId: string;
  email?: string;
  firstName: string;
  lastName: string;
}

export interface UpsertContactInput extends CrmCallContext {
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

export interface UpsertCompanyInput extends CrmCallContext {
  name: string;
  domain?: string;
}

export interface CreateLeadInput extends CrmCallContext {
  contactExternalId: string;
  companyExternalId?: string;
  source: string;
  /** Bezeichnung der Anfrage im CRM (z. B. „Anfrage Wärmepumpe – Tom Orbit“); ohne Angabe nennt der Adapter nur den Eingangskanal. */
  title?: string;
  notes?: string;
}

export interface CreateLeadResult {
  externalId: string;
}

/** Ein Lead (Deal) so, wie das CRM ihn führt – zum Rücklesen nach einer Änderung. */
export interface CrmLeadRecord {
  externalId: string;
  title?: string;
  notes?: string;
}

export interface ReadLeadInput extends CrmCallContext {
  externalId: string;
}

/** Ergänzt/ändert den **bereits angelegten** Lead (nie einen anderen, nie einen neuen). Nur genannte Felder werden geschrieben. */
export interface UpdateLeadInput extends CrmCallContext {
  externalId: string;
  title?: string;
  notes?: string;
}

export interface LogActivityInput extends CrmCallContext {
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
  /** Liest den Lead; `null`, wenn es ihn im CRM nicht (mehr) gibt. Ein Ausfall ist ein Fehler, nie `null`. */
  readLead(input: ReadLeadInput): Promise<CrmLeadRecord | null>;
  updateLead(input: UpdateLeadInput): Promise<void>;
  logActivity(input: LogActivityInput): Promise<void>;
}
