import type {
  CreateLeadInput,
  CreateLeadResult,
  CrmCompanyRecord,
  CrmConnector,
  CrmContactRecord,
  CrmLeadRecord,
  LogActivityInput,
  ReadLeadInput,
  UpdateLeadInput,
  UpsertCompanyInput,
  UpsertContactInput,
} from './types';

/**
 * HubSpot-Anbindung der CRM-Schnittstelle (Service-Schlüssel eines einzelnen HubSpot-Accounts, Bearer-Token). Alle Aufrufe stammen aus der offiziellen HubSpot-Referenz
 * (https://developers.hubspot.com/docs/api-reference) und wurden gegen einen Testaccount geprüft:
 *
 * - Kontakte/Unternehmen suchen: `POST /crm/v3/objects/{contacts|companies}/search` (Filter `email` bzw. `domain`, Operator `EQ`)
 * - anlegen: `POST /crm/v3/objects/{contacts|companies|deals|notes}`
 * - verknüpfen: `PUT /crm/v4/objects/{von}/{id}/associations/default/{nach}/{id}` (Standardverknüpfung, keine selbst gewählten Typkennungen)
 * - Notiz an Kontakt: Verknüpfungstyp 202 („Note to contact“, laut Tabelle der Verknüpfungstypen)
 * - Deal-Phase: erste Phase der ersten Pipeline (`GET /crm/v3/pipelines/deals`), sofern der Betrieb nichts anderes eingestellt hat
 *
 * Grundsätze: HubSpot führt als CRM; **bestehende Datensätze werden nicht überschrieben** (ein gefundener Kontakt bleibt, wie er ist). Ein Ausfall oder eine fehlende
 * Berechtigung wird als `HubSpotApiError` gemeldet – nie als „nicht gefunden“ oder als simulierter Erfolg. Der Schlüssel kommt je Aufruf für den Betrieb (Mandanten), nie aus
 * einer globalen Einstellung.
 */

export class HubSpotApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Kategorie aus der HubSpot-Antwort, z. B. `MISSING_SCOPES`, `INVALID_AUTHENTICATION`, `RATE_LIMITS`. */
    public readonly category?: string,
    /** Lohnt sich ein späterer Versuch (Ausfall, Drosselung, Zeitüberschreitung)? */
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'HubSpotApiError';
  }
}

export interface HubSpotDealSettings {
  pipeline?: string;
  stage?: string;
}

export interface HubSpotConnectorOptions {
  /** Der Service-Schlüssel dieses Betriebs (aus dem Tresor); wirft, wenn keiner hinterlegt ist. */
  tokenFor: (tenantId: string) => Promise<string>;
  /** Optional: Pipeline und Phase für neue Deals je Betrieb. */
  dealSettingsFor?: (tenantId: string) => Promise<HubSpotDealSettings | undefined>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export type HubSpotObjectAccess = 'OK' | 'MISSING_SCOPES' | 'INVALID_KEY' | 'ERROR';

export interface HubSpotAccessReport {
  ok: boolean;
  contacts: HubSpotObjectAccess;
  companies: HubSpotObjectAccess;
  deals: HubSpotObjectAccess;
}

interface HubSpotObject {
  id: string;
  properties: Record<string, string | null | undefined>;
}

const DEFAULT_BASE_URL = 'https://api.hubapi.com';
const NOTE_TO_CONTACT = 202;
const PIPELINE_CACHE_MS = 10 * 60_000;
/** HubSpots Suchindex hinkt hinter neu angelegten Datensätzen her (gemessen: mehrere Sekunden). So lange wird ein soeben angelegter Datensatz in diesem Prozess direkt wiedergefunden. */
const RECENT_CREATE_MS = 2 * 60_000;

const nonEmpty = (value: string | undefined | null): string | undefined => (value && value.trim() ? value.trim() : undefined);

export class HubSpotCrmConnector implements CrmConnector {
  readonly providerName = 'hubspot';
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pipelineCache = new Map<string, { at: number; value: { pipeline: string; stage: string } }>();
  private readonly recentCreates = new Map<string, { at: number; record: CrmContactRecord | CrmCompanyRecord }>();

  constructor(private readonly options: HubSpotConnectorOptions) {
    // Spät gebunden: ein später ersetztes `fetch` (Tests, Messung) wird benutzt.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Die Schnittstelle kennt keinen Mandanten beim Verbindungstest; echte Prüfung: `verifyAccess`. */
  async testConnection(): Promise<boolean> {
    return true;
  }

  /** Prüft einen Schlüssel gegen die drei Bereiche, die ORBIT braucht (lesend, ändert nichts). */
  async verifyAccess(token: string): Promise<HubSpotAccessReport> {
    const check = async (object: string): Promise<HubSpotObjectAccess> => {
      try {
        await this.request(token, 'GET', `/crm/v3/objects/${object}?limit=1`, undefined, { retry: false });
        return 'OK';
      } catch (error) {
        if (error instanceof HubSpotApiError) {
          if (error.status === 401) return 'INVALID_KEY';
          if (error.status === 403) return 'MISSING_SCOPES';
        }
        return 'ERROR';
      }
    };
    const [contacts, companies, deals] = await Promise.all([check('contacts'), check('companies'), check('deals')]);
    return { ok: contacts === 'OK' && companies === 'OK' && deals === 'OK', contacts, companies, deals };
  }

  async findContactByEmail(tenantId: string, email: string): Promise<CrmContactRecord | null> {
    const token = await this.options.tokenFor(tenantId);
    const found = await this.searchOne(token, 'contacts', 'email', email.trim().toLowerCase(), ['email', 'firstname', 'lastname']);
    return found ? this.toContact(found) : null;
  }

  async createContactRecord(tenantId: string, input: { email: string; firstName: string; lastName: string; phone?: string }): Promise<CrmContactRecord> {
    const token = await this.options.tokenFor(tenantId);
    const created = await this.createContact(token, input);
    return created;
  }

  async upsertContact(input: UpsertContactInput): Promise<CrmContactRecord> {
    const token = await this.options.tokenFor(input.tenantId);
    const email = nonEmpty(input.email)?.toLowerCase();
    let record: CrmContactRecord | undefined = email ? (this.recent(input.tenantId, 'contacts', email) as CrmContactRecord | undefined) : undefined;
    if (!record && email) {
      const found = await this.searchOne(token, 'contacts', 'email', email, ['email', 'firstname', 'lastname']);
      if (found) record = this.toContact(found);
    }
    if (!record) {
      try {
        record = await this.createContact(token, { email, firstName: input.firstName, lastName: input.lastName, phone: input.phone });
        if (email) this.remember(input.tenantId, 'contacts', email, record);
      } catch (error) {
        // Zwischen Suche und Anlage hat jemand denselben Kontakt angelegt (Konflikt): erneut suchen statt zu scheitern.
        if (error instanceof HubSpotApiError && error.status === 409 && email) {
          const again = await this.searchOne(token, 'contacts', 'email', email, ['email', 'firstname', 'lastname']);
          if (!again) throw error;
          record = this.toContact(again);
        } else {
          throw error;
        }
      }
    }
    if (input.companyExternalId) await this.associate(token, 'contacts', record.externalId, 'companies', input.companyExternalId);
    return record;
  }

  async upsertCompany(input: UpsertCompanyInput): Promise<CrmCompanyRecord> {
    const token = await this.options.tokenFor(input.tenantId);
    const domain = nonEmpty(input.domain)?.toLowerCase();
    if (domain) {
      const recent = this.recent(input.tenantId, 'companies', domain) as CrmCompanyRecord | undefined;
      if (recent) return recent;
      const found = await this.searchOne(token, 'companies', 'domain', domain, ['name', 'domain']);
      if (found) return { externalId: found.id, name: nonEmpty(found.properties.name) ?? input.name };
    }
    const created = await this.request<HubSpotObject>(token, 'POST', '/crm/v3/objects/companies', { properties: { name: input.name, ...(domain ? { domain } : {}) } });
    const record = { externalId: created.id, name: input.name };
    if (domain) this.remember(input.tenantId, 'companies', domain, record);
    return record;
  }

  /**
   * Eine Anfrage wird in HubSpot ein **Deal** in der ersten Phase der ersten Pipeline (oder der eingestellten), verknüpft mit Kontakt und Unternehmen. HubSpots eigenes
   * „Leads“-Objekt gibt es nur in bestimmten Tarifen und verlangt andere Berechtigungen; Deals stehen in jedem CRM-Account zur Verfügung.
   */
  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    const token = await this.options.tokenFor(input.tenantId);
    const target = await this.dealTarget(token, input.tenantId);
    const deal = await this.request<HubSpotObject>(token, 'POST', '/crm/v3/objects/deals', {
      properties: {
        dealname: nonEmpty(input.title) ? (input.title as string).trim().slice(0, 200) : `Anfrage (${input.source})`,
        pipeline: target.pipeline,
        dealstage: target.stage,
        ...(nonEmpty(input.notes) ? { description: (input.notes as string).slice(0, 2000) } : {}),
      },
    });
    await this.associate(token, 'deals', deal.id, 'contacts', input.contactExternalId);
    if (input.companyExternalId) await this.associate(token, 'deals', deal.id, 'companies', input.companyExternalId);
    return { externalId: deal.id };
  }

  /**
   * Liest einen Deal (`GET /crm/v3/objects/deals/{id}?properties=dealname,description`, offizielle Referenz „Retrieve deals“). Ein nicht gefundener Deal (404) ist `null`; jeder andere Fehler wird gemeldet.
   */
  async readLead(input: ReadLeadInput): Promise<CrmLeadRecord | null> {
    const token = await this.options.tokenFor(input.tenantId);
    try {
      const deal = await this.request<HubSpotObject>(token, 'GET', `/crm/v3/objects/deals/${encodeURIComponent(input.externalId)}?properties=dealname,description`);
      return { externalId: deal.id, title: nonEmpty(deal.properties.dealname), notes: nonEmpty(deal.properties.description) };
    } catch (error) {
      if (error instanceof HubSpotApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Ändert genau die genannten Eigenschaften eines **vorhandenen** Deals (`PATCH /crm/v3/objects/deals/{id}`, offizielle Referenz „Update deals“; Aufruf ohne Wiederholung). Es werden nur `dealname` und
   * `description` geschrieben – nie Phase, Besitzer, Verknüpfungen oder andere Eigenschaften.
   */
  async updateLead(input: UpdateLeadInput): Promise<void> {
    const token = await this.options.tokenFor(input.tenantId);
    const properties: Record<string, string> = {};
    if (nonEmpty(input.title)) properties.dealname = (input.title as string).trim().slice(0, 200);
    if (input.notes !== undefined) properties.description = input.notes.slice(0, 2000);
    if (Object.keys(properties).length === 0) return;
    await this.request(token, 'PATCH', `/crm/v3/objects/deals/${encodeURIComponent(input.externalId)}`, { properties });
  }

  /** Eine Notiz am Kontakt (Zeitpunkt = Zeitpunkt des Ereignisses). */
  async logActivity(input: LogActivityInput): Promise<void> {
    const token = await this.options.tokenFor(input.tenantId);
    await this.request(token, 'POST', '/crm/v3/objects/notes', {
      properties: { hs_timestamp: input.occurredAt.toISOString(), hs_note_body: `${input.activityType}: ${input.summary}`.slice(0, 65_000) },
      associations: [{ to: { id: input.contactExternalId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }] }],
    });
  }

  /** Alle Unternehmen mit dieser Domain (für Aufräumarbeiten von Tests; HubSpot legt aus Adress-Domains selbst Unternehmen an). */
  async findCompanyIdsByDomain(tenantId: string, domain: string): Promise<string[]> {
    const token = await this.options.tokenFor(tenantId);
    const response = await this.request<{ results: HubSpotObject[] }>(token, 'POST', '/crm/v3/objects/companies/search', {
      filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain.toLowerCase() }] }],
      properties: ['domain'],
      limit: 20,
    });
    return response.results.map((r) => r.id);
  }

  /** Löscht (archiviert) einen Datensatz – für Aufräumarbeiten von Tests, nicht für den Betrieb. */
  async archive(tenantId: string, object: 'contacts' | 'companies' | 'deals' | 'notes', id: string): Promise<void> {
    const token = await this.options.tokenFor(tenantId);
    await this.request(token, 'DELETE', `/crm/v3/objects/${object}/${encodeURIComponent(id)}`);
  }

  // ── intern ────────────────────────────────────────────────────────────────

  private recent(tenantId: string, kind: string, key: string): CrmContactRecord | CrmCompanyRecord | undefined {
    const entry = this.recentCreates.get(`${tenantId}|${kind}|${key}`);
    return entry && Date.now() - entry.at < RECENT_CREATE_MS ? entry.record : undefined;
  }

  private remember(tenantId: string, kind: string, key: string, record: CrmContactRecord | CrmCompanyRecord): void {
    this.recentCreates.set(`${tenantId}|${kind}|${key}`, { at: Date.now(), record });
    if (this.recentCreates.size > 500) for (const [k, v] of this.recentCreates) if (Date.now() - v.at >= RECENT_CREATE_MS) this.recentCreates.delete(k);
  }

  private toContact(object: HubSpotObject): CrmContactRecord {
    return { externalId: object.id, email: nonEmpty(object.properties.email), firstName: nonEmpty(object.properties.firstname) ?? '', lastName: nonEmpty(object.properties.lastname) ?? '' };
  }

  private async createContact(token: string, input: { email?: string; firstName: string; lastName: string; phone?: string }): Promise<CrmContactRecord> {
    const created = await this.request<HubSpotObject>(token, 'POST', '/crm/v3/objects/contacts', {
      properties: { ...(input.email ? { email: input.email } : {}), firstname: input.firstName, lastname: input.lastName, ...(nonEmpty(input.phone) ? { phone: input.phone } : {}) },
    });
    return { externalId: created.id, email: input.email, firstName: input.firstName, lastName: input.lastName };
  }

  private async searchOne(token: string, object: 'contacts' | 'companies', property: string, value: string, properties: string[]): Promise<HubSpotObject | undefined> {
    const response = await this.request<{ results: HubSpotObject[] }>(token, 'POST', `/crm/v3/objects/${object}/search`, {
      filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value }] }],
      properties,
      limit: 1,
    });
    return response.results[0];
  }

  /** Standardverknüpfung zweier Datensätze (HubSpot wählt den Typ; ORBIT rät keine Typkennungen). */
  private async associate(token: string, from: string, fromId: string, to: string, toId: string): Promise<void> {
    await this.request(token, 'PUT', `/crm/v4/objects/${from}/${encodeURIComponent(fromId)}/associations/default/${to}/${encodeURIComponent(toId)}`);
  }

  private async dealTarget(token: string, tenantId: string): Promise<{ pipeline: string; stage: string }> {
    const configured = await this.options.dealSettingsFor?.(tenantId);
    if (configured?.pipeline && configured.stage) return { pipeline: configured.pipeline, stage: configured.stage };
    const cached = this.pipelineCache.get(tenantId);
    if (cached && Date.now() - cached.at < PIPELINE_CACHE_MS) return cached.value;
    const response = await this.request<{ results: Array<{ id: string; displayOrder?: number; stages?: Array<{ id: string; displayOrder?: number }> }> }>(token, 'GET', '/crm/v3/pipelines/deals');
    const byOrder = <T extends { displayOrder?: number }>(list: T[]): T[] => [...list].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const pipeline = configured?.pipeline ? response.results.find((p) => p.id === configured.pipeline) : byOrder(response.results)[0];
    const stage = pipeline ? byOrder(pipeline.stages ?? [])[0] : undefined;
    if (!pipeline || !stage) throw new HubSpotApiError('In HubSpot ist keine Deal-Pipeline mit einer Phase eingerichtet.', 422, 'NO_PIPELINE');
    const value = { pipeline: pipeline.id, stage: configured?.stage ?? stage.id };
    this.pipelineCache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  private async request<T = unknown>(token: string, method: string, path: string, body?: unknown, options: { retry?: boolean } = {}): Promise<T> {
    // Nur lesende Aufrufe (GET und die Suche) werden bei Drosselung oder Ausfall einmal wiederholt; Anlegen und Verknüpfen nie blind (kein doppelter Datensatz).
    const isRead = method === 'GET' || (method === 'POST' && path.endsWith('/search'));
    const attempts = (options.retry ?? isRead) ? 2 : 1;
    let lastError: HubSpotApiError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
        if (response.ok) {
          if (response.status === 204) return undefined as T;
          const text = await response.text();
          return (text ? JSON.parse(text) : undefined) as T;
        }
        const detail = (await response.json().catch(() => ({}))) as { category?: string; message?: string };
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new HubSpotApiError(this.describe(response.status, detail.category, detail.message), response.status, detail.category, retryable);
        if (!retryable || attempt === attempts) throw lastError;
        const wait = Math.min(Number(response.headers.get('retry-after') ?? '1') * 1000 || 1000, 5000);
        await new Promise((resolve) => setTimeout(resolve, wait));
      } catch (error) {
        if (error instanceof HubSpotApiError) throw error;
        lastError = new HubSpotApiError(error instanceof Error && error.name === 'AbortError' ? 'HubSpot hat nicht rechtzeitig geantwortet.' : 'HubSpot ist nicht erreichbar.', 0, 'NETWORK', true);
        if (attempt === attempts) throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new HubSpotApiError('HubSpot-Aufruf fehlgeschlagen.', 0, undefined, true);
  }

  private describe(status: number, category?: string, message?: string): string {
    if (status === 401) return 'HubSpot hat den Schlüssel abgelehnt (ungültig oder widerrufen).';
    if (status === 403) return 'Dem HubSpot-Schlüssel fehlt eine Berechtigung für diese Aktion (Kontakte, Unternehmen und Deals jeweils lesen und schreiben).';
    if (status === 429) return 'HubSpot drosselt gerade die Aufrufe (zu viele Anfragen).';
    if (status >= 500) return 'HubSpot hat einen Fehler gemeldet; später erneut versuchen.';
    if (status === 409) return 'In HubSpot gibt es diesen Datensatz bereits (Konflikt).';
    return `HubSpot hat die Anfrage abgelehnt (${status}${category ? `, ${category}` : ''})${message ? `: ${message.slice(0, 200)}` : ''}.`;
  }
}
