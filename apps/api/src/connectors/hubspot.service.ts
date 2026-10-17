import { Injectable, Logger } from '@nestjs/common';
import { HubSpotApiError, HubSpotCrmConnector, type HubSpotAccessReport } from '@orbit/integration-core';
import { ExternalSystemError, IntegrationUnavailableError } from '@orbit/shared';
import { CredentialVaultService } from '../security/credential-vault.service';
import { PrismaService } from '../prisma/prisma.service';

const SERVICE_KEY_FIELD = 'serviceKey';

/** Ein Satz, der benennt, was dem Schlüssel fehlt – für die Oberfläche und die Meldung beim Speichern. */
export function describeAccess(report: HubSpotAccessReport): string {
  if (report.contacts === 'INVALID_KEY' || report.companies === 'INVALID_KEY' || report.deals === 'INVALID_KEY') return 'HubSpot hat den Schlüssel abgelehnt (ungültig oder widerrufen).';
  const labels: Array<[string, string]> = [['Kontakte', report.contacts], ['Unternehmen', report.companies], ['Deals', report.deals]];
  const missing = labels.filter(([, state]) => state === 'MISSING_SCOPES').map(([label]) => label);
  if (missing.length > 0) return `Dem Schlüssel fehlt die Berechtigung für: ${missing.join(', ')} (jeweils lesen und schreiben, z. B. crm.objects.companies.read und .write).`;
  const broken = labels.filter(([, state]) => state === 'ERROR').map(([label]) => label);
  if (broken.length > 0) return `HubSpot hat für ${broken.join(', ')} nicht geantwortet. Bitte später erneut versuchen.`;
  return 'Der Schlüssel ist gültig.';
}

/**
 * HubSpot-Anbindung je Betrieb: der Service-Schlüssel liegt verschlüsselt im Tresor (`Integration.credentialReference`), nie in einer globalen Einstellung – ein Betrieb kann
 * so nie auf den HubSpot-Account eines anderen zugreifen. Dieser Dienst liefert dem Adapter den Schlüssel, prüft einen Schlüssel vor dem Speichern und hält den Verbindungsstatus
 * ehrlich (ein abgelehnter Schlüssel setzt die Verbindung auf „Anmeldung erforderlich“).
 */
@Injectable()
export class HubSpotService {
  private readonly logger = new Logger(HubSpotService.name);
  readonly connector: HubSpotCrmConnector;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: CredentialVaultService,
  ) {
    this.connector = new HubSpotCrmConnector({
      tokenFor: (tenantId) => this.tokenFor(tenantId),
      dealSettingsFor: (tenantId) => this.dealSettings(tenantId),
    });
  }

  private async integration(tenantId: string) {
    return this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'HUBSPOT' } } });
  }

  /** Ist HubSpot für diesen Betrieb eingerichtet und nutzbar? */
  async isConnected(tenantId: string): Promise<boolean> {
    const row = await this.integration(tenantId);
    return row?.status === 'CONNECTED' && row.credentialReference !== null;
  }

  async tokenFor(tenantId: string): Promise<string> {
    const row = await this.integration(tenantId);
    if (!row?.credentialReference || row.status !== 'CONNECTED') throw new IntegrationUnavailableError('HubSpot ist für diesen Betrieb nicht verbunden.');
    const secret = await this.vault.readSecret(tenantId, row.credentialReference);
    const key = secret.value[SERVICE_KEY_FIELD];
    if (typeof key !== 'string' || key.length === 0) throw new IntegrationUnavailableError('Für HubSpot ist kein Service-Schlüssel hinterlegt.');
    return key;
  }

  private async dealSettings(tenantId: string): Promise<{ pipeline?: string; stage?: string } | undefined> {
    const config = (await this.integration(tenantId))?.config as { dealPipeline?: unknown; dealStage?: unknown } | null | undefined;
    const pipeline = typeof config?.dealPipeline === 'string' ? config.dealPipeline : undefined;
    const stage = typeof config?.dealStage === 'string' ? config.dealStage : undefined;
    return pipeline || stage ? { pipeline, stage } : undefined;
  }

  /** Prüft einen noch nicht gespeicherten Schlüssel (lesend). */
  verifyKey(key: string): Promise<HubSpotAccessReport> {
    return this.connector.verifyAccess(key.trim());
  }

  /** Prüft die gespeicherte Verbindung und aktualisiert den Status; ändert in HubSpot nichts. */
  async test(tenantId: string): Promise<{ ok: boolean; message: string; access?: HubSpotAccessReport }> {
    let token: string;
    try {
      token = await this.tokenFor(tenantId);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'HubSpot ist nicht verbunden.' };
    }
    const access = await this.connector.verifyAccess(token);
    const message = describeAccess(access);
    const db = this.prisma.forTenantId(tenantId);
    const key = { tenantId_connectorType: { tenantId, connectorType: 'HUBSPOT' as const } };
    if (access.ok) await db.integration.update({ where: key, data: { status: 'CONNECTED', lastSuccessAt: new Date(), lastErrorAt: null, lastErrorCode: null } });
    else {
      const rejected = [access.contacts, access.companies, access.deals].includes('INVALID_KEY');
      await db.integration.update({ where: key, data: { ...(rejected ? { status: 'AUTH_REQUIRED' as const } : {}), lastErrorAt: new Date(), lastErrorCode: rejected ? 'KEY_REJECTED' : 'ACCESS_INCOMPLETE' } });
    }
    return { ok: access.ok, message, access };
  }

  /** Ein von HubSpot abgelehnter Schlüssel im laufenden Betrieb: Verbindung auf „Anmeldung erforderlich“, damit die Oberfläche es zeigt. */
  async noteRejected(tenantId: string): Promise<void> {
    await this.prisma
      .forTenantId(tenantId)
      .integration.updateMany({ where: { tenantId, connectorType: 'HUBSPOT', status: 'CONNECTED' }, data: { status: 'AUTH_REQUIRED', lastErrorAt: new Date(), lastErrorCode: 'KEY_REJECTED' } })
      .catch((error: unknown) => this.logger.warn(`HubSpot-Status nicht aktualisiert: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Übersetzt einen HubSpot-Fehler in den Fehler, den der Rest von ORBIT kennt (wiederholbar bei Ausfall, Drosselung, Zeitüberschreitung). */
  async toOrbitError(tenantId: string, error: unknown): Promise<unknown> {
    if (!(error instanceof HubSpotApiError)) return error;
    if (error.status === 401) await this.noteRejected(tenantId);
    return new ExternalSystemError(error.message, { provider: 'hubspot', status: error.status, category: error.category, retryable: error.retryable });
  }
}
