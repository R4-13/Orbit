'use client';

import { useState } from 'react';
import type { AIProviderKey } from '@orbit/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label, type BadgeTone } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { formatDateTime } from '../../../../lib/format';
import {
  useAiProviderStatus,
  useDisconnectAiProvider,
  useTestAiProviderConnection,
  useUpsertAiProviderConnection,
  useVerifyAiRuntime,
} from '../../../../lib/hooks/use-ai-providers';

const PROVIDER_LABELS: Record<AIProviderKey, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
};

const STATUS_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  CONNECTED: { label: 'Verbunden', tone: 'success' },
  DISCONNECTED: { label: 'Getrennt', tone: 'neutral' },
  ERROR: { label: 'Fehler', tone: 'danger' },
  NOT_CONFIGURED: { label: 'Nicht konfiguriert', tone: 'neutral' },
};

const HEALTH_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  SIMULATED: { label: 'Simuliert — kein echtes Modell', tone: 'warning' },
  NOT_VERIFIED: { label: 'Ausführbarkeit nicht geprüft', tone: 'warning' },
  VERIFIED: { label: 'Ausführbarkeit geprüft', tone: 'success' },
  ERROR: { label: 'Prüfung fehlgeschlagen', tone: 'danger' },
};

/** Amendment 02 §5.3: "Aktiv" beschreibt nur die Konfiguration — hier steht, was wirklich ausgeführt wird und ob das geprüft wurde. */
function RuntimeBox({ runtime }: { runtime: NonNullable<ReturnType<typeof useAiProviderStatus>['data']>['runtime'] }) {
  const verify = useVerifyAiRuntime();
  const [error, setError] = useState<string | null>(null);
  const health = HEALTH_LABELS[runtime.health.state] ?? HEALTH_LABELS.NOT_VERIFIED;
  const simulated = runtime.executionMode === 'SIMULATED';

  async function handleVerify() {
    setError(null);
    try {
      await verify.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Prüfung ist fehlgeschlagen.');
    }
  }

  return (
    <div
      className={`rounded-md border px-4 py-3 ${simulated ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
      data-testid="ai-runtime"
      data-execution-mode={runtime.executionMode}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">Tatsächlicher Betrieb</p>
          <p className="text-xs text-slate-600" data-testid="ai-runtime-summary">
            {simulated
              ? 'Simuliert: Es wird derzeit kein echtes KI-Modell aufgerufen. Einstufungen und Antworten stammen nicht von einer echten KI.'
              : `Live: ${runtime.provider}${runtime.model ? ` · ${runtime.model}` : ''}`}
          </p>
          {runtime.health.checkedAt ? <p className="text-xs text-slate-500">Zuletzt geprüft: {formatDateTime(runtime.health.checkedAt)}</p> : null}
          {runtime.health.detail && runtime.health.state !== 'SIMULATED' ? <p className="text-xs text-slate-500">{runtime.health.detail}</p> : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge tone={health.tone}>{health.label}</Badge>
          {!simulated ? (
            <Button variant="secondary" disabled={verify.isPending} onClick={handleVerify}>
              Ausführbarkeit prüfen
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function ByokForm({ onSaved }: { onSaved: () => void }) {
  const upsert = useUpsertAiProviderConnection();
  const [providerKey, setProviderKey] = useState<AIProviderKey>('ANTHROPIC');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await upsert.mutateAsync({ providerKey, apiKey, model: model || undefined });
      setApiKey('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Verbindung konnte nicht gespeichert werden.');
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4">
      <div>
        <Label htmlFor="byok-provider">Provider</Label>
        <select
          id="byok-provider"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          value={providerKey}
          onChange={(event) => setProviderKey(event.target.value as AIProviderKey)}
        >
          {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="byok-api-key">API-Key</Label>
        <Input
          id="byok-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-..."
        />
      </div>
      <div>
        <Label htmlFor="byok-model">Modell (optional — leer = Standardmodell des Providers)</Label>
        <Input id="byok-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="z. B. gpt-4o" />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button onClick={handleSave} disabled={upsert.isPending || !apiKey}>
        Speichern &amp; prüfen
      </Button>
      <p className="text-xs text-slate-500">
        Der Schlüssel wird sofort gegen den echten Provider geprüft und danach AES-256-verschlüsselt gespeichert —
        der Klartext wird nie zurückgegeben.
      </p>
    </div>
  );
}

export default function AdminAiProvidersPage() {
  const { data: status, isLoading, isError, error: loadError, refetch } = useAiProviderStatus();
  const testConnection = useTestAiProviderConnection();
  const disconnect = useDisconnectAiProvider();
  const [showByokForm, setShowByokForm] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  async function handleTest() {
    setTestError(null);
    try {
      await testConnection.mutateAsync();
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : 'Der Verbindungstest ist fehlgeschlagen.');
    }
  }

  async function handleDisconnect() {
    setDisconnectError(null);
    try {
      await disconnect.mutateAsync();
    } catch (err) {
      setDisconnectError(err instanceof ApiError ? err.message : 'Die Trennung ist fehlgeschlagen.');
    }
  }

  const isTenantManaged = status?.mode === 'TENANT_MANAGED';
  const connection = status?.connection;
  const statusInfo = connection ? (STATUS_LABELS[connection.status] ?? STATUS_LABELS.NOT_CONFIGURED) : null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">KI &amp; Modelle</h1>
      <p className="mt-1 text-sm text-slate-500">
        Standardmäßig verwenden alle Agenten die von ORBIT betriebene KI-Konfiguration — kein eigener API-Key nötig.
        Fortgeschrittene Kunden können stattdessen einen eigenen Provider-Zugang hinterlegen (Bring Your Own Key).
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>KI-Modus</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isError ? (
            <ErrorState message={errorMessage(loadError, 'Der KI-Provider-Status konnte nicht geladen werden.')} onRetry={() => void refetch()} />
          ) : isLoading ? (
            <p className="text-sm text-slate-500">Wird geladen …</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">ORBIT-Managed AI</p>
                  <p className="text-xs text-slate-500">Kein eigener API-Key erforderlich — von ORBIT betrieben und geprüft.</p>
                </div>
                <Badge tone={!isTenantManaged ? 'info' : 'neutral'}>{!isTenantManaged ? 'Konfiguration aktiv' : 'Inaktiv'}</Badge>
              </div>

              {status ? <RuntimeBox runtime={status.runtime} /> : null}

              <div className="rounded-md border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">Customer-Managed AI (BYOK)</p>
                    {connection ? (
                      <p className="text-xs text-slate-500">
                        {PROVIDER_LABELS[connection.providerKey]}
                        {connection.model ? ` · ${connection.model}` : ''}
                        {connection.lastTestedAt ? ` · zuletzt geprüft: ${formatDateTime(connection.lastTestedAt)}` : ''}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">Noch nicht konfiguriert.</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {statusInfo ? <Badge tone={isTenantManaged ? statusInfo.tone : 'neutral'}>{statusInfo.label}</Badge> : null}
                    {connection?.hasCredentials ? (
                      <>
                        <Button variant="ghost" disabled={testConnection.isPending} onClick={handleTest}>
                          Verbindung testen
                        </Button>
                        <Button variant="ghost" disabled={disconnect.isPending} onClick={handleDisconnect}>
                          Trennen
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onClick={() => setShowByokForm((prev) => !prev)}>
                        {showByokForm ? 'Abbrechen' : 'Einrichten'}
                      </Button>
                    )}
                  </div>
                </div>
                {testError ? <p className="mt-2 text-sm text-red-600">{testError}</p> : null}
                {disconnectError ? <p className="mt-2 text-sm text-red-600">{disconnectError}</p> : null}
                {connection?.lastTestStatus && connection.status === 'ERROR' ? (
                  <p className="mt-2 text-sm text-red-600">Letzter Fehler: {connection.lastTestStatus}</p>
                ) : null}
                {showByokForm ? (
                  <div className="mt-3">
                    <ByokForm onSaved={() => setShowByokForm(false)} />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
