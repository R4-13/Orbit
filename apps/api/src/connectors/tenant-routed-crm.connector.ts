import type { CreateLeadInput, CreateLeadResult, CrmCompanyRecord, CrmConnector, CrmContactRecord, CrmLeadRecord, LogActivityInput, ReadLeadInput, UpdateLeadInput, UpsertCompanyInput, UpsertContactInput } from '@orbit/integration-core';
import { ExternalSystemError } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { HubSpotService } from './hubspot.service';

/** HubSpot-Kennungen sind reine Zahlen; alles andere (ORBIT-Kennung, `mock-…` der Test-Ablage) stammt nicht aus HubSpot. */
const isHubSpotId = (id: string): boolean => /^\d+$/.test(id);

/**
 * Die CRM-Schnittstelle, wie ORBIT sie benutzt: **je Betrieb** entscheidet sich, wohin ein Aufruf geht. Hat der Betrieb HubSpot verbunden, gehen Kontakte, Unternehmen,
 * Anfragen (Deals) und Notizen an dessen HubSpot-Account; sonst an die eingestellte Vorgabe (heute die gekennzeichnete Test-Ablage `mock-persistent`). Ein Fehler von HubSpot wird
 * als Fehler weitergegeben – nie auf die Test-Ablage ausgewichen, sonst entstünden Datensätze, die HubSpot nie sieht.
 *
 * Kontakte und Unternehmen, die ORBIT vor der Anbindung angelegt hat, tragen eine Kennung der Test-Ablage (oder gar keine). Wird eine solche Kennung für HubSpot gebraucht, wird der
 * Datensatz einmal in HubSpot gesucht bzw. angelegt (über E-Mail bzw. Domain, ohne Bestehendes zu verändern) und die HubSpot-Kennung in ORBIT festgehalten.
 */
export class TenantRoutedCrmConnector implements CrmConnector {
  readonly providerName = 'tenant-routed';

  constructor(
    private readonly fallback: CrmConnector,
    private readonly hubspot: HubSpotService,
    private readonly prisma: PrismaService,
  ) {}

  testConnection(): Promise<boolean> {
    return this.fallback.testConnection();
  }

  private async route<T>(tenantId: string, action: (crm: CrmConnector, viaHubSpot: boolean) => Promise<T>): Promise<T> {
    if (!(await this.hubspot.isConnected(tenantId))) return action(this.fallback, false);
    try {
      return await action(this.hubspot.connector, true);
    } catch (error) {
      throw await this.hubspot.toOrbitError(tenantId, error);
    }
  }

  /** Die HubSpot-Kennung eines Kontakts (aus ORBIT-/Test-Kennung bei Bedarf einmalig ermittelt). */
  private async contactIdFor(tenantId: string, id: string): Promise<string> {
    if (isHubSpotId(id)) return id;
    const db = this.prisma.forTenantId(tenantId);
    const contact = await db.contact.findFirst({ where: { OR: [{ id }, { crmExternalId: id }] } });
    if (!contact?.email) throw new ExternalSystemError('Der Kontakt hat keine E-Mail-Adresse und kann deshalb nicht in HubSpot zugeordnet werden.', { provider: 'hubspot', retryable: false });
    const record = await this.hubspot.connector.upsertContact({ tenantId, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone ?? undefined });
    await db.contact.update({ where: { id: contact.id }, data: { crmExternalId: record.externalId } });
    return record.externalId;
  }

  /** Die HubSpot-Kennung eines Unternehmens (ebenso ermittelt, über die Domain, sonst über den Namen als neuer Datensatz). */
  private async companyIdFor(tenantId: string, id: string): Promise<string> {
    if (isHubSpotId(id)) return id;
    const db = this.prisma.forTenantId(tenantId);
    const company = await db.company.findFirst({ where: { OR: [{ id }, { crmExternalId: id }] } });
    if (!company) throw new ExternalSystemError('Das Unternehmen ist in ORBIT nicht bekannt und kann nicht in HubSpot zugeordnet werden.', { provider: 'hubspot', retryable: false });
    const record = await this.hubspot.connector.upsertCompany({ tenantId, name: company.name, domain: company.domain ?? undefined });
    await db.company.update({ where: { id: company.id }, data: { crmExternalId: record.externalId } });
    return record.externalId;
  }

  upsertContact(input: UpsertContactInput): Promise<CrmContactRecord> {
    return this.route(input.tenantId, async (crm, viaHubSpot) => crm.upsertContact(viaHubSpot && input.companyExternalId ? { ...input, companyExternalId: await this.companyIdFor(input.tenantId, input.companyExternalId) } : input));
  }

  upsertCompany(input: UpsertCompanyInput): Promise<CrmCompanyRecord> {
    return this.route(input.tenantId, (crm) => crm.upsertCompany(input));
  }

  createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    return this.route(input.tenantId, async (crm, viaHubSpot) =>
      crm.createLead(
        viaHubSpot
          ? { ...input, contactExternalId: await this.contactIdFor(input.tenantId, input.contactExternalId), companyExternalId: input.companyExternalId ? await this.companyIdFor(input.tenantId, input.companyExternalId) : undefined }
          : input,
      ),
    );
  }

  /**
   * Lesen und Ändern eines Leads gehen dorthin, wo er liegt: eine HubSpot-Kennung (reine Zahl) nach HubSpot, eine Kennung der Test-Ablage dorthin. Ist HubSpot nicht verbunden, obwohl der Lead dort liegt, ist
   * das ein Fehler – es wird nie auf die Test-Ablage ausgewichen.
   */
  private async leadRoute<T>(tenantId: string, externalId: string, action: (crm: CrmConnector) => Promise<T>): Promise<T> {
    if (!isHubSpotId(externalId)) return action(this.fallback);
    if (!(await this.hubspot.isConnected(tenantId))) throw new ExternalSystemError('Der Lead liegt in HubSpot, HubSpot ist aber nicht verbunden.', { provider: 'hubspot', retryable: true });
    try {
      return await action(this.hubspot.connector);
    } catch (error) {
      throw await this.hubspot.toOrbitError(tenantId, error);
    }
  }

  readLead(input: ReadLeadInput): Promise<CrmLeadRecord | null> {
    return this.leadRoute(input.tenantId, input.externalId, (crm) => crm.readLead(input));
  }

  updateLead(input: UpdateLeadInput): Promise<void> {
    return this.leadRoute(input.tenantId, input.externalId, (crm) => crm.updateLead(input));
  }

  logActivity(input: LogActivityInput): Promise<void> {
    return this.route(input.tenantId, async (crm, viaHubSpot) => crm.logActivity(viaHubSpot ? { ...input, contactExternalId: await this.contactIdFor(input.tenantId, input.contactExternalId) } : input));
  }
}
