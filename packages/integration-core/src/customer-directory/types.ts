/**
 * Provider-agnostic contract for "is this person already a customer?" – answered by whatever system leads the customer master of a business: ORBIT's own contacts,
 * a CRM (larger firms, e.g. HubSpot) or an ERP/bookkeeping system (smaller firms, e.g. Lexware). Concrete adapters are added only against official vendor
 * documentation (docs/INTEGRATIONS.md); nothing here guesses a provider API.
 *
 * The result is deliberately three-valued. A system that could not be asked is `UNAVAILABLE`, never `NOT_FOUND`: treating an outage as "unknown customer" would create
 * duplicates in the leading system as soon as it is reachable again.
 */
export type CustomerLookupOutcome = 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface CustomerMatch {
  /** The system's own identifier for the customer. */
  externalId: string;
  displayName: string;
  email?: string;
}

export interface CustomerLookupQuery {
  tenantId: string;
  email: string;
}

export interface CustomerLookupResult {
  outcome: CustomerLookupOutcome;
  matches: CustomerMatch[];
  /** Why the system could not answer (only with `UNAVAILABLE`). */
  reason?: string;
}

export interface CreateCustomerInput {
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface CustomerDirectory {
  /** Stable key of the system, e.g. `ORBIT_CONTACTS`, `HUBSPOT`, `LEXWARE`. */
  readonly systemKey: string;
  /** Human-readable name shown in the UI and in notifications. */
  readonly label: string;
  /** Whether ORBIT may write a new customer into this system by itself (otherwise a human is asked to create it there). */
  readonly canCreate: boolean;
  /** Gilt dieses Verzeichnis für den Betrieb (z. B. nur mit eingerichteter Anbindung)? Fehlt die Methode, gilt es für alle. */
  appliesTo?(tenantId: string): Promise<boolean>;
  lookup(query: CustomerLookupQuery): Promise<CustomerLookupResult>;
  create?(input: CreateCustomerInput): Promise<CustomerMatch>;
}
