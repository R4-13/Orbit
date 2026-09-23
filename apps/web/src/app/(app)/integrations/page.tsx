'use client';

import { useState } from 'react';
import type { IntegrationConnectorType } from '@orbit/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@orbit/ui';
import { ApiError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import {
  useDisconnectIntegration,
  useIntegrations,
  useUpsertIntegrationCredentials,
  type IntegrationSummary,
} from '../../../lib/hooks/use-integrations';

const CONNECTOR_TYPES: IntegrationConnectorType[] = [
  'DATEV',
  'LEXWARE',
  'MICROSOFT',
  'GMAIL',
  'GOOGLE_CALENDAR',
  'HUBSPOT',
  'TWILIO',
];

const CONNECTOR_LABELS: Record<IntegrationConnectorType, string> = {
  DATEV: 'DATEV (Finance)',
  LEXWARE: 'Lexware (Finance)',
  MICROSOFT: 'Microsoft 365 (Mail)',
  GMAIL: 'Gmail (Mail)',
  GOOGLE_CALENDAR: 'Google Calendar',
  HUBSPOT: 'HubSpot (CRM)',
  TWILIO: 'Twilio (Telefonie)',
};

function ConnectorRow({ connectorType, integration }: { connectorType: IntegrationConnectorType; integration?: IntegrationSummary }) {
  const upsert = useUpsertIntegrationCredentials();
  const disconnect = useDisconnectIntegration();
  const [credentialsJson, setCredentialsJson] = useState('{}');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = integration?.status ?? 'NOT_CONFIGURED';
  const tone = status === 'CONNECTED' ? 'success' : status === 'ERROR' ? 'danger' : 'neutral';
  const statusLabel =
    status === 'CONNECTED' ? 'Verbunden' : status === 'DISCONNECTED' ? 'Getrennt' : status === 'ERROR' ? 'Fehler' : 'Nicht konfiguriert';

  async function handleSave() {
    setError(null);
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      setError('Zugangsdaten müssen gültiges JSON sein, z. B. {"clientId": "...", "clientSecret": "..."}.');
      return;
    }
    try {
      await upsert.mutateAsync({ connectorType, credentials });
      setExpanded(false);
      setCredentialsJson('{}');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Zugangsdaten konnten nicht gespeichert werden.');
    }
  }

  async function handleDisconnect() {
    setError(null);
    try {
      await disconnect.mutateAsync(connectorType);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Trennung ist fehlgeschlagen.');
    }
  }

  return (
    <div className="border-b border-slate-100 px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{CONNECTOR_LABELS[connectorType]}</p>
          {integration?.lastTestedAt ? (
            <p className="text-xs text-slate-400">Zuletzt getestet: {formatDateTime(integration.lastTestedAt)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{statusLabel}</Badge>
          {integration?.hasCredentials ? (
            <Button variant="ghost" disabled={disconnect.isPending} onClick={handleDisconnect}>
              Trennen
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setExpanded((prev) => !prev)}>
              {expanded ? 'Abbrechen' : 'Verbinden'}
            </Button>
          )}
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-slate-500" htmlFor={`creds-${connectorType}`}>
            Zugangsdaten (JSON) — nur für diesen Demo-MVP als Freitext, jeder echte Provider-Adapter würde eigene
            Felder vorgeben (siehe docs/INTEGRATIONS.md)
          </label>
          <textarea
            id={`creds-${connectorType}`}
            rows={3}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            value={credentialsJson}
            onChange={(event) => setCredentialsJson(event.target.value)}
          />
          <Button onClick={handleSave} disabled={upsert.isPending}>
            Speichern (verschlüsselt)
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

export default function IntegrationsPage() {
  const { data: integrations, isLoading } = useIntegrations();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Integrationen</h1>
      <p className="mt-1 text-sm text-slate-500">
        Zugangsdaten werden AES-256-verschlüsselt gespeichert und nie im Klartext zurückgegeben. Jeder Connector
        ist aktuell als Mock implementiert — eine echte Anbindung braucht offizielle Provider-Credentials (siehe
        docs/INTEGRATIONS.md).
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Connectoren</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="px-5 py-6 text-sm text-slate-400">Wird geladen …</p>
          ) : (
            CONNECTOR_TYPES.map((connectorType) => (
              <ConnectorRow
                key={connectorType}
                connectorType={connectorType}
                integration={integrations?.find((i) => i.connectorType === connectorType)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
