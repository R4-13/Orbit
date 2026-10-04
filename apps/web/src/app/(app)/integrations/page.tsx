'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectorMetadata } from '@orbit/integration-core';
import type { ConnectorOperationalStatus } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label, type BadgeTone } from '@orbit/ui';
import { Calendar, Mail, Phone, Plug, Receipt, Users } from 'lucide-react';
import { ApiError, errorMessage } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import {
  useConnectorOperationalStatus,
  useConnectors,
  useDisconnectIntegration,
  useIntegrations,
  useStartConnect,
  useTestConnection,
  useUpsertIntegrationCredentials,
  type IntegrationSummary,
} from '../../../lib/hooks/use-integrations';

const CONNECTOR_ICONS: Record<string, typeof Mail> = {
  mail: Mail,
  calendar: Calendar,
  receipt: Receipt,
  users: Users,
  phone: Phone,
};

/** Googles eigene OAuth-Fehlercodes (z. B. `access_denied`) landen hier unübersetzt neben den drei Codes, die der Callback-Controller selbst vergibt — beides sind technische Codes, keine Freitexte, daher dieselbe generische Übersetzungstabelle statt eines Versuchs, jeden möglichen Google-Code zu erraten. */
const CALLBACK_ERROR_LABELS: Record<string, string> = {
  unsupported_connector: 'Dieser Connector unterstützt noch keine OAuth-Verbindung.',
  missing_code_or_state: 'Die Rückmeldung von Google war unvollständig. Bitte erneut versuchen.',
  connection_failed: 'Die Verbindung konnte nicht abgeschlossen werden.',
  access_denied: 'Die Berechtigung wurde im Google-Dialog abgelehnt.',
};

const STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'Nicht konfiguriert',
  CONNECTING: 'Verbindung wird aufgebaut …',
  CONNECTED: 'Verbunden',
  DEGRADED: 'Eingeschränkt',
  AUTH_REQUIRED: 'Erneute Autorisierung nötig',
  DISCONNECTED: 'Getrennt',
  ERROR: 'Fehler',
};

const STATUS_TONES: Record<string, BadgeTone> = {
  NOT_CONFIGURED: 'neutral',
  CONNECTING: 'info',
  CONNECTED: 'success',
  DEGRADED: 'warning',
  AUTH_REQUIRED: 'warning',
  DISCONNECTED: 'neutral',
  ERROR: 'danger',
};

function CallbackBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const connected = searchParams.get('connected');
  const callbackError = searchParams.get('error');

  useEffect(() => {
    if (!connected && !callbackError) return;
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    const timeout = setTimeout(() => router.replace('/integrations'), 8000);
    return () => clearTimeout(timeout);
  }, [connected, callbackError, queryClient, router]);

  if (connected) {
    return (
      <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {connected} wurde erfolgreich verbunden.
      </div>
    );
  }
  if (callbackError) {
    return (
      <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {CALLBACK_ERROR_LABELS[callbackError] ?? `Verbindung fehlgeschlagen (${callbackError}).`}
      </div>
    );
  }
  return null;
}

function ConnectedDetails({ integration }: { integration: IntegrationSummary }) {
  return (
    <div className="mt-2 space-y-0.5 text-xs text-slate-500">
      {integration.externalAccountDisplayName ? <p>Konto: {integration.externalAccountDisplayName}</p> : null}
      {integration.lastTestedAt ? <p>Zuletzt getestet: {formatDateTime(integration.lastTestedAt)}</p> : null}
      {integration.status === 'ERROR' && integration.lastErrorCode ? (
        <p className="text-red-600">Letzter Fehler: {integration.lastErrorCode}</p>
      ) : null}
    </div>
  );
}

/**
 * docs/CHANNEL_EVENT_RUNTIME_PLAN.md §8 und Amendment 02 §19.4: "Ein erfolgreicher OAuth-Connect allein ist niemals
 * gleichbedeutend mit einem funktionierenden automatischen Intake-Kanal." — daher drei getrennte, aus echten Nachweisen
 * berechnete Aussagen statt eines einzelnen "Verbunden"-Badges. Der aktuelle Betriebszustand steht bewusst separat von
 * den historischen Nachweisen. Jede Aussage trägt Text + Symbol, nie nur Farbe.
 */
const OPERATIONAL_CHECKS: Array<{ level: ConnectorOperationalStatus; label: string }> = [
  { level: 'AUTHENTICATION_CONNECTED', label: 'Verbindung geprüft' },
  { level: 'INTAKE_PIPELINE_ACTIVE', label: 'Echter Eingang empfangen' },
  { level: 'LIVE_END_TO_END_TESTED', label: 'Fachlicher Prozess erfolgreich getestet' },
];

function OperationalStatusRow({ connectorId, enabled }: { connectorId: ConnectorMetadata['id']; enabled: boolean }) {
  const { data } = useConnectorOperationalStatus(connectorId, enabled);
  if (!enabled) return null;
  if (!data) return <p className="mt-1.5 text-xs text-slate-400">Betriebsstatus wird geladen …</p>;

  const health = data.health;
  const hasCurrentProblem = Boolean(health && (health.latestRunFailed || health.lastErrorCode || health.syncLastErrorCode));
  return (
    <div className="mt-1.5 space-y-1 text-xs" data-testid="operational-status">
      <ul className="space-y-0.5" aria-label="Betriebsnachweise">
        {OPERATIONAL_CHECKS.map(({ level, label }) => {
          const reached = data.levels[level].reached;
          return (
            <li key={level} className="flex items-center gap-1.5" data-level={level} data-reached={reached}>
              <span aria-hidden="true" className={reached ? 'text-emerald-600' : 'text-slate-400'}>
                {reached ? '✓' : '○'}
              </span>
              <span className={reached ? 'text-slate-700' : 'text-slate-500'}>
                {label}
                <span className="sr-only">{reached ? ': nachgewiesen' : ': noch nicht nachgewiesen'}</span>
                {reached && data.levels[level].at ? <span className="text-slate-400"> · {formatDateTime(data.levels[level].at)}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {data.verifiedRun ? (
        <p className="text-slate-500" data-testid="execution-summary">
          Nachweis-Umfang: {data.verifiedRun.executionSummary}
          {data.verifiedRun.execution?.buildCommit ? ` · Build ${data.verifiedRun.execution.buildCommit}` : ' · Build nicht erfasst'}
        </p>
      ) : null}
      {hasCurrentProblem ? (
        <p className="text-amber-700" role="status">
          Aktuell: {health?.latestRunFailed ? 'der letzte echte Lauf ist fehlgeschlagen' : 'Betriebsfehler'}
          {health?.lastErrorCode || health?.syncLastErrorCode ? ` (${health.lastErrorCode ?? health.syncLastErrorCode})` : ''}
        </p>
      ) : null}
    </div>
  );
}

function OAuthConnectorRow({ connector, integration }: { connector: ConnectorMetadata; integration?: IntegrationSummary }) {
  const startConnect = useStartConnect();
  const testConnection = useTestConnection();
  const disconnect = useDisconnectIntegration();
  const [error, setError] = useState<string | null>(null);

  const Icon = CONNECTOR_ICONS[connector.icon] ?? Plug;
  const status = integration?.status ?? 'NOT_CONFIGURED';
  const isConnected = integration?.hasCredentials ?? false;

  const grantedSend = Array.isArray(integration?.grantedCapabilities) && (integration?.grantedCapabilities as unknown[]).includes('email.send');

  async function handleConnect(send = false) {
    setError(null);
    try {
      const { authorizationUrl } = await startConnect.mutateAsync({ connectorType: connector.id, send });
      window.location.href = authorizationUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Der Verbindungsvorgang konnte nicht gestartet werden.');
    }
  }

  async function handleTest() {
    setError(null);
    try {
      const result = await testConnection.mutateAsync(connector.id);
      if (!result.ok) {
        setError('Der Verbindungstest war nicht erfolgreich — die Autorisierung ist vermutlich abgelaufen.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Der Verbindungstest ist fehlgeschlagen.');
    }
  }

  async function handleDisconnect() {
    setError(null);
    try {
      await disconnect.mutateAsync(connector.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Trennung ist fehlgeschlagen.');
    }
  }

  return (
    <div className="border-b border-slate-100 px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" aria-hidden="true" />
          <div>
            <p className="font-medium text-slate-900">{connector.name}</p>
            <p className="text-xs text-slate-500">{connector.description}</p>
            {isConnected ? <ConnectedDetails integration={integration!} /> : null}
            <OperationalStatusRow connectorId={connector.id} enabled={isConnected && connector.liveConnectSupported} />
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
          {!connector.liveConnectSupported ? (
            <Button variant="secondary" disabled title="Für diesen Connector ist die OAuth-Anbindung noch nicht implementiert.">
              Noch nicht verfügbar
            </Button>
          ) : isConnected ? (
            <>
              {connector.id === 'GMAIL' && !grantedSend ? (
                <Button variant="secondary" disabled={startConnect.isPending} onClick={() => void handleConnect(true)} title="Erlaubt ORBIT, freigegebene Nachrichten über dieses Postfach zu senden. Ohne diese Berechtigung wird nie etwas gesendet.">
                  Sendeberechtigung erteilen
                </Button>
              ) : null}
              <Button variant="secondary" disabled={testConnection.isPending} onClick={handleTest}>
                Testen
              </Button>
              <Button variant="ghost" disabled={disconnect.isPending} onClick={handleDisconnect}>
                Trennen
              </Button>
            </>
          ) : (
            <Button disabled={startConnect.isPending} onClick={() => void handleConnect()}>
              Mit {connector.provider} verbinden
            </Button>
          )}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function ApiKeyConnectorRow({ connector, integration }: { connector: ConnectorMetadata; integration?: IntegrationSummary }) {
  const upsert = useUpsertIntegrationCredentials();
  const disconnect = useDisconnectIntegration();
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const Icon = CONNECTOR_ICONS[connector.icon] ?? Plug;
  const status = integration?.status ?? 'NOT_CONFIGURED';
  const isConnected = integration?.hasCredentials ?? false;

  async function handleSave() {
    setError(null);
    const missing = connector.requiredFields.filter((field) => field.required && !values[field.key]?.trim());
    if (missing.length > 0) {
      setError(`Bitte ausfüllen: ${missing.map((field) => field.label).join(', ')}.`);
      return;
    }
    try {
      await upsert.mutateAsync({ connectorType: connector.id, credentials: values });
      setExpanded(false);
      setValues({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Zugangsdaten konnten nicht gespeichert werden.');
    }
  }

  async function handleDisconnect() {
    setError(null);
    try {
      await disconnect.mutateAsync(connector.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Trennung ist fehlgeschlagen.');
    }
  }

  return (
    <div className="border-b border-slate-100 px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" aria-hidden="true" />
          <div>
            <p className="font-medium text-slate-900">{connector.name}</p>
            <p className="text-xs text-slate-500">{connector.description}</p>
            {isConnected ? <ConnectedDetails integration={integration!} /> : null}
            <OperationalStatusRow connectorId={connector.id} enabled={isConnected} />
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
          {isConnected ? (
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
        <div className="mt-3 space-y-3">
          {connector.requiredFields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`${connector.id}-${field.key}`}>{field.label}</Label>
              <Input
                id={`${connector.id}-${field.key}`}
                type={field.type === 'secret' ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
              />
            </div>
          ))}
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
  const {
    data: connectors,
    isLoading: connectorsLoading,
    isError: connectorsIsError,
    error: connectorsError,
    refetch: refetchConnectors,
  } = useConnectors();
  const {
    data: integrations,
    isLoading: integrationsLoading,
    isError: integrationsIsError,
    error: integrationsError,
    refetch: refetchIntegrations,
  } = useIntegrations();
  const isLoading = connectorsLoading || integrationsLoading;
  const isError = connectorsIsError || integrationsIsError;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Integrationen</h1>
      <p className="mt-1 text-sm text-slate-500">
        Zugangsdaten werden AES-256-verschlüsselt gespeichert und nie im Klartext zurückgegeben. Für Gmail steht eine
        echte OAuth-Verbindung bereit; alle anderen Connectoren sind aktuell als Mock implementiert und noch nicht
        verbindbar (siehe docs/INTEGRATIONS.md).
      </p>

      <CallbackBanner />

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(connectorsError ?? integrationsError, 'Die Integrationen konnten nicht geladen werden.')}
          onRetry={() => {
            void refetchConnectors();
            void refetchIntegrations();
          }}
        />
      ) : (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Connectoren</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="px-5 py-6 text-sm text-slate-400">Wird geladen …</p>
            ) : (
              connectors?.map((connector) => {
                const integration = integrations?.find((i) => i.connectorType === connector.id);
                return connector.authentication.type === 'api_key' ? (
                  <ApiKeyConnectorRow key={connector.id} connector={connector} integration={integration} />
                ) : (
                  <OAuthConnectorRow key={connector.id} connector={connector} integration={integration} />
                );
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
