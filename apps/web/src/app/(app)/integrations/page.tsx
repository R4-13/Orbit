'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, CheckCircle2, Mail, Phone, Plug, Receipt, Users } from 'lucide-react';
import type { ConnectorMetadata } from '@orbit/integration-core';
import { PERMISSIONS, connectorLabel, integrationErrorLabel, type ConnectorOperationalStatus } from '@orbit/shared';
import { Button, ErrorState, Input, Label } from '@orbit/ui';
import { Modal } from '../../../components/common/modal';
import { LastUpdated, Notice, PageHeader, StatusBadge, type StatusTone } from '../../../components/common/primitives';
import { ApiError, apiFetch, errorMessage } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { formatDateTime } from '../../../lib/format';
import {
  useConnectorOperationalStatus,
  useConnectors,
  useDisconnectIntegration,
  useIntegrations,
  useStartConnect,
  useUpdateCalendars,
  useTestConnection,
  useUpsertIntegrationCredentials,
  type IntegrationSummary,
} from '../../../lib/hooks/use-integrations';

const CONNECTOR_ICONS: Record<string, typeof Mail> = { mail: Mail, calendar: Calendar, receipt: Receipt, users: Users, phone: Phone };

/** Googles eigene OAuth-Fehlercodes landen unübersetzt neben den Codes des Callback-Controllers – eine Übersetzungstabelle statt Raten. */
const CALLBACK_ERROR_LABELS: Record<string, string> = {
  unsupported_connector: 'Dieses System unterstützt noch keine Anmeldung über diesen Weg.',
  missing_code_or_state: 'Die Rückmeldung des Anbieters war unvollständig. Bitte versuchen Sie es erneut.',
  connection_failed: 'Die Verbindung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.',
  access_denied: 'Die Berechtigung wurde im Anmeldedialog abgelehnt. Es wurde nichts verbunden.',
};

/** Zustand in Klartext mit konkreter nächster Aktion (UI v2 §3.2: ein Fehler nennt Problem und nächsten Schritt). */
const STATUS_VIEW: Record<string, { label: string; tone: StatusTone; next: string }> = {
  NOT_CONFIGURED: { label: 'Nicht verbunden', tone: 'neutral', next: 'Verbinden' },
  CONNECTING: { label: 'Verbindung wird aufgebaut …', tone: 'info', next: 'Bitte einen Moment warten' },
  CONNECTED: { label: 'Verbunden', tone: 'success', next: 'Keine Aktion nötig' },
  DEGRADED: { label: 'Eingeschränkt', tone: 'warning', next: 'Verbindung testen' },
  AUTH_REQUIRED: { label: 'Anmeldung abgelaufen', tone: 'warning', next: 'Verbindung erneuern' },
  DISCONNECTED: { label: 'Getrennt', tone: 'neutral', next: 'Erneut verbinden' },
  ERROR: { label: 'Verbindung gestört', tone: 'danger', next: 'Verbindung prüfen' },
};

/** Die Fähigkeiten eines Systems in Worten, die Nicht-Techniker verstehen (Zweck und Folge, §18.2). */
const CAPABILITY_TEXT: Record<string, string> = {
  'email.read': 'Eingehende Nachrichten lesen – damit ORBIT Anfragen und Rechnungen erkennt.',
  'email.send': 'Nachrichten in Ihrem Namen versenden – je nach Ihren Regeln mit oder ohne vorherige Freigabe.',
  'calendar.freebusy': 'Verfügbarkeit lesen (nur frei/belegt, keine Termininhalte) – damit ORBIT Vor-Ort- und Telefontermine zu Ihren freien Zeiten vorschlagen kann.',
  'calendar.read': 'Termine lesen – damit Terminvorschläge zu Ihrer Verfügbarkeit passen.',
  'calendar.write': 'Termine anlegen – nur nach Ihrer Freigabe.',
};
const describeCapability = (capability: string): string => CAPABILITY_TEXT[capability] ?? `Funktion „${capability}“`;

function OperationalChecks({ connectorId, enabled }: { connectorId: ConnectorMetadata['id']; enabled: boolean }) {
  const { data } = useConnectorOperationalStatus(connectorId, enabled);
  if (!enabled) return null;
  if (!data) return <p className="mt-2 text-xs text-slate-600">Betriebsstatus wird geladen …</p>;
  const checks: Array<{ level: ConnectorOperationalStatus; label: string }> = [
    { level: 'AUTHENTICATION_CONNECTED', label: 'Verbindung geprüft' },
    { level: 'INTAKE_PIPELINE_ACTIVE', label: 'Echter Eingang empfangen' },
    { level: 'LIVE_END_TO_END_TESTED', label: 'Fachlicher Prozess erfolgreich getestet' },
  ];
  const health = data.health;
  const hasCurrentProblem = Boolean(health && (health.latestRunFailed || health.lastErrorCode || health.syncLastErrorCode));
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-testid="operational-status">
      <ul className="space-y-1" aria-label="Betriebsnachweise">
        {checks.map(({ level, label }) => {
          const reached = data.levels[level].reached;
          return (
            <li key={level} className="flex items-center gap-1.5" data-level={level} data-reached={reached}>
              <span aria-hidden="true" className={reached ? 'text-emerald-700' : 'text-slate-600'}>
                {reached ? '✓' : '○'}
              </span>
              <span className={reached ? 'text-slate-800' : 'text-slate-600'}>
                {label}
                <span className="sr-only">{reached ? ': nachgewiesen' : ': noch nicht nachgewiesen'}</span>
                {reached && data.levels[level].at ? <span className="text-slate-600"> · {formatDateTime(data.levels[level].at)}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {data.verifiedRun ? (
        <p className="text-slate-600" data-testid="execution-summary">
          Nachweis-Umfang: {data.verifiedRun.executionSummary}
          {data.verifiedRun.execution?.buildCommit ? ` · Build ${data.verifiedRun.execution.buildCommit}` : ' · Build nicht erfasst'}
        </p>
      ) : null}
      {hasCurrentProblem ? (
        <p className="text-amber-800" role="status">
          Aktuell: {health?.latestRunFailed ? 'Der letzte echte Lauf ist fehlgeschlagen' : 'Betriebsfehler'}
          {health?.lastErrorCode || health?.syncLastErrorCode ? ` (${integrationErrorLabel(health.lastErrorCode ?? health.syncLastErrorCode)})` : ''}
        </p>
      ) : null}
    </div>
  );
}

function CallbackBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const connected = searchParams.get('connected');
  const callbackError = searchParams.get('error');

  useEffect(() => {
    if (!connected && !callbackError) return;
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    const timeout = setTimeout(() => router.replace('/integrations'), 10_000);
    return () => clearTimeout(timeout);
  }, [connected, callbackError, queryClient, router]);

  if (connected) return <Notice tone="info">{connectorLabel(connected) === 'Noch nicht zugeordnet' ? connected : connectorLabel(connected)} wurde verbunden. Prüfen Sie die Verbindung unten, bevor Sie sich darauf verlassen.</Notice>;
  if (callbackError) return <Notice tone="danger">{CALLBACK_ERROR_LABELS[callbackError] ?? `Die Verbindung ist fehlgeschlagen (${callbackError}). Bitte versuchen Sie es erneut.`}</Notice>;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geführte Einrichtung (UI v2 §18.2): System → Anmeldung/sichere Eingaben → Berechtigungen erklären → prüfen → Ergebnis
// ---------------------------------------------------------------------------------------------------------------------

function SetupWizard({ connector, onClose, canSend }: { connector: ConnectorMetadata; onClose: () => void; canSend: boolean }) {
  const startConnect = useStartConnect();
  const upsert = useUpsertIntegrationCredentials();
  const test = useTestConnection();
  const { hasPermission } = useAuth();
  const [step, setStep] = useState<'permissions' | 'credentials' | 'result'>(connector.authentication.type === 'api_key' ? 'credentials' : 'permissions');
  const [values, setValues] = useState<Record<string, string>>({});
  const [withSend, setWithSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'ok' | 'failed' | null>(null);
  const isAdmin = hasPermission(PERMISSIONS.TENANT_MANAGE);

  const readCapabilities = connector.capabilities.filter((c) => !c.endsWith('.send') && !c.endsWith('.write'));
  const writeCapabilities = connector.capabilities.filter((c) => c.endsWith('.send') || c.endsWith('.write'));

  async function startOAuth() {
    setError(null);
    try {
      const { authorizationUrl } = await startConnect.mutateAsync({ connectorType: connector.id, send: withSend });
      window.location.href = authorizationUrl;
    } catch (err) {
      // Plattformseitig fehlende OAuth-Konfiguration: Endnutzer erhalten eine verständliche Antwort, Admins zusätzlich den Hinweis (§18.2).
      setError(
        err instanceof ApiError && err.status >= 500
          ? 'Die Verbindung kann derzeit nicht eingerichtet werden. Ihre Administration muss sie freischalten.'
          : err instanceof ApiError
            ? err.message
            : 'Der Verbindungsvorgang konnte nicht gestartet werden.',
      );
    }
  }

  async function saveCredentials() {
    setError(null);
    const missing = connector.requiredFields.filter((field) => field.required && !values[field.key]?.trim());
    if (missing.length > 0) {
      setError(`Bitte ausfüllen: ${missing.map((field) => field.label).join(', ')}.`);
      return;
    }
    try {
      await upsert.mutateAsync({ connectorType: connector.id, credentials: values });
      const check = await test.mutateAsync(connector.id).catch(() => ({ ok: false }));
      setResult(check.ok ? 'ok' : 'failed');
      setValues({});
      setStep('result');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Zugangsdaten konnten nicht gespeichert werden.');
    }
  }

  return (
    <Modal
      title={`${connector.name} verbinden`}
      description={`Schritt ${step === 'permissions' ? '1 von 2: Berechtigungen verstehen' : step === 'credentials' ? '1 von 2: Sichere Eingaben' : '2 von 2: Ergebnis'}`}
      onClose={onClose}
      footer={
        step === 'result' ? (
          <Button onClick={onClose}>Fertig</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            {step === 'permissions' ? (
              <Button onClick={() => void startOAuth()} disabled={startConnect.isPending}>
                Mit {connector.provider} verbinden
              </Button>
            ) : (
              <Button onClick={() => void saveCredentials()} disabled={upsert.isPending || test.isPending}>
                Speichern und prüfen
              </Button>
            )}
          </>
        )
      }
    >
      {step === 'permissions' ? (
        <div className="space-y-4 text-sm text-slate-800">
          <p>Sie werden gleich bei {connector.provider} angemeldet. ORBIT sieht Ihr Passwort nie. Folgendes erlauben Sie:</p>
          <ul className="space-y-2">
            {readCapabilities.map((capability) => (
              <li key={capability} className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" /> {describeCapability(capability)}
              </li>
            ))}
          </ul>
          {writeCapabilities.length > 0 && connector.id === 'GMAIL' ? (
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={withSend} onChange={(event) => setWithSend(event.target.checked)} />
              <span>
                <span className="block font-medium text-slate-900">Zusätzlich: Senden erlauben{canSend ? ' (bereits erteilt)' : ''}</span>
                <span className="block text-slate-700">{writeCapabilities.map(describeCapability).join(' ')} Ohne diese Berechtigung wird nie etwas gesendet.</span>
              </span>
            </label>
          ) : null}
          <p className="text-slate-700">Sie können die Verbindung jederzeit trennen. Bereits bearbeitete Vorgänge bleiben nachvollziehbar.</p>
          {error ? <Notice tone="danger">{error}{isAdmin ? ' (Hinweis für Administratoren: Die Plattform-Zugangsdaten des Anbieters sind nicht hinterlegt – siehe docs/GOOGLE_INTEGRATION.md.)' : ''}</Notice> : null}
        </div>
      ) : null}
      {step === 'credentials' ? (
        <div className="space-y-3 text-sm text-slate-800">
          <p>Diese Angaben werden verschlüsselt gespeichert und nie wieder angezeigt. Geben Sie sie nur hier ein – nie im Chat mit Sonde.</p>
          {connector.requiredFields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`${connector.id}-${field.key}`}>{field.label}</Label>
              <Input id={`${connector.id}-${field.key}`} type={field.type === 'secret' ? 'password' : 'text'} autoComplete="off" value={values[field.key] ?? ''} onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))} />
            </div>
          ))}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      ) : null}
      {step === 'result' ? (
        result === 'ok' ? (
          <Notice tone="info">Die Verbindung zu {connector.name} wurde gespeichert und erfolgreich geprüft. Ob ein echter Eingang ankommt, sehen Sie danach im Betriebsstatus der Verbindung.</Notice>
        ) : (
          <Notice tone="warning">Die Zugangsdaten wurden gespeichert, aber die Prüfung war nicht erfolgreich. Bitte kontrollieren Sie die Angaben und testen Sie die Verbindung erneut.</Notice>
        )
      ) : null}
    </Modal>
  );
}

function DisconnectDialog({ connector, onClose }: { connector: ConnectorMetadata; onClose: () => void }) {
  const disconnect = useDisconnectIntegration();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={`${connector.name} trennen?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            disabled={disconnect.isPending}
            onClick={() =>
              void disconnect.mutateAsync(connector.id).then(onClose, (err) => setError(err instanceof ApiError ? err.message : 'Die Trennung ist fehlgeschlagen.'))
            }
          >
            Verbindung trennen
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-800">
        <p>Danach liest ORBIT keine neuen Nachrichten mehr aus diesem Konto und kann darüber nichts senden. Neue Anfragen werden nicht mehr automatisch erkannt.</p>
        <p>Bereits angelegte Vorgänge, Entwürfe und Nachweise bleiben erhalten und nachvollziehbar.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

/** Aus welchen Kalendern Terminvorschläge entstehen: der Hauptkalender oder die freigegebenen Kalender der Monteure/Installateure. */
function CalendarChoice({ integration }: { integration: IntegrationSummary }) {
  const update = useUpdateCalendars();
  const configured = ((integration.config ?? {}) as { calendarIds?: unknown }).calendarIds;
  const saved = Array.isArray(configured) && configured.length > 0 ? (configured as string[]) : ['primary'];
  const [text, setText] = useState(saved.join(', '));
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  async function save() {
    setMessage(null);
    const ids = text.split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) {
      setMessage({ tone: 'danger', text: 'Bitte mindestens einen Kalender angeben („primary“ ist Ihr Hauptkalender).' });
      return;
    }
    try {
      await update.mutateAsync(ids);
      setMessage({ tone: 'info', text: `Gespeichert: Terminvorschläge berücksichtigen ${ids.length === 1 ? 'diesen Kalender' : `diese ${ids.length} Kalender`}.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Die Kalender konnten nicht gespeichert werden.' });
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="calendar-choice">
      <label htmlFor="calendar-ids" className="text-sm font-medium text-slate-900">
        Kalender für Terminvorschläge
      </label>
      <p className="text-xs text-slate-700">„primary“ ist Ihr Hauptkalender. Für die Monteure geben Sie deren Kalender-IDs an (meist deren E-Mail-Adresse); die Kalender müssen für dieses Konto freigegeben sein. Ein Termin wird vorgeschlagen, sobald mindestens einer der genannten Kalender frei ist.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input id="calendar-ids" value={text} onChange={(event) => setText(event.target.value)} className="h-9 min-w-0 flex-1 basis-64 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900" />
        <Button variant="secondary" disabled={update.isPending} onClick={() => void save()}>
          Speichern
        </Button>
      </div>
      {message ? <div className="mt-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
    </div>
  );
}

function ConnectionCard({ connector, integration, onDisconnect, onRenew }: { connector: ConnectorMetadata; integration: IntegrationSummary; onDisconnect: () => void; onRenew: () => void }) {
  const test = useTestConnection();
  const startConnect = useStartConnect();
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const Icon = CONNECTOR_ICONS[connector.icon] ?? Plug;
  const view = STATUS_VIEW[integration.status] ?? STATUS_VIEW.CONNECTED!;
  const grantedSend = Array.isArray(integration.grantedCapabilities) && (integration.grantedCapabilities as unknown[]).includes('email.send');
  const grantedCalendar = Array.isArray(integration.grantedCapabilities) && (integration.grantedCapabilities as unknown[]).includes('calendar.freebusy');
  const lastOk = integration.lastSuccessAt ?? integration.lastTestedAt;

  async function handleTest() {
    setMessage(null);
    try {
      const result = await test.mutateAsync(connector.id);
      setMessage(result.ok ? { tone: 'info', text: 'Die Verbindung wurde geprüft und funktioniert.' } : { tone: 'danger', text: 'Der Test war nicht erfolgreich – die Anmeldung ist vermutlich abgelaufen. Bitte erneuern Sie die Verbindung.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Der Test ist fehlgeschlagen.' });
    }
  }

  async function grant(what: 'send' | 'calendar') {
    setMessage(null);
    try {
      // Bereits erteilte Berechtigungen bleiben erhalten (das Backend übernimmt sie bei jeder Zustimmung).
      const { authorizationUrl } = await startConnect.mutateAsync({ connectorType: connector.id, send: what === 'send', calendar: what === 'calendar' });
      window.location.href = authorizationUrl;
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : 'Der Vorgang konnte nicht gestartet werden.' });
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-connector={connector.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-6 w-6 shrink-0 text-slate-600" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{connector.name}</h3>
            <p className="text-sm text-slate-700">{connector.description}</p>
            <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-slate-600">Konto</dt>
              <dd className="min-w-0 break-all text-slate-900">{integration.externalAccountDisplayName ?? 'Wird beim nächsten Test ermittelt'}</dd>
              <dt className="text-slate-600">Letzte erfolgreiche Prüfung</dt>
              <dd className="text-slate-900">{lastOk ? formatDateTime(lastOk) : 'Noch keine'}</dd>
              <dt className="text-slate-600">Nächste Aktion</dt>
              <dd className="font-medium text-slate-900">{view.next}</dd>
            </dl>
            {integration.status === 'ERROR' && integration.lastErrorCode ? <p className="mt-1 text-sm text-red-800">Aktuell: {integrationErrorLabel(integration.lastErrorCode)}</p> : null}
            <OperationalChecks connectorId={connector.id} enabled={connector.liveConnectSupported || connector.authentication.type === 'api_key'} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
          <div className="flex flex-wrap justify-end gap-2">
            {integration.status === 'AUTH_REQUIRED' ? <Button onClick={onRenew}>Verbindung erneuern</Button> : null}
            {connector.id === 'GMAIL' && !grantedSend ? (
              <Button variant="secondary" disabled={startConnect.isPending} onClick={() => void grant('send')} title="Erlaubt ORBIT, freigegebene Nachrichten über dieses Postfach zu senden. Ohne diese Berechtigung wird nie etwas gesendet.">
                Sendeberechtigung erteilen
              </Button>
            ) : null}
            {connector.id === 'GMAIL' && !grantedCalendar ? (
              <Button variant="secondary" disabled={startConnect.isPending} onClick={() => void grant('calendar')} title="Erlaubt ORBIT zu sehen, wann Sie frei oder belegt sind – nur frei/belegt, keine Termininhalte. Damit schlägt ORBIT Vor-Ort- und Telefontermine zu Ihren freien Zeiten vor.">
                Kalender-Verfügbarkeit erlauben
              </Button>
            ) : null}
            <Button variant="secondary" disabled={test.isPending} onClick={() => void handleTest()}>
              Verbindung testen
            </Button>
            <Button variant="ghost" onClick={onDisconnect}>
              Trennen
            </Button>
          </div>
        </div>
      </div>
      {message ? <div className="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      {connector.id === 'GMAIL' && grantedCalendar ? <CalendarChoice integration={integration} /> : null}
    </li>
  );
}

function RequestSystem() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const request = useMutation({
    mutationFn: () => apiFetch<{ recorded: true }>('/v1/integrations/requests', { method: 'POST', body: JSON.stringify({ systemName: name.trim(), note: note.trim() || undefined }) }),
    onSuccess: () => {
      setDone(true);
      setName('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  return (
    <section aria-label="System anfragen" className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <h2 className="text-[15px] font-semibold text-slate-900">Ihr System ist nicht dabei?</h2>
      <p className="mt-1 text-sm text-slate-700">Nicht unterstützte Systeme bieten wir nicht vor, sondern erfassen sie als Anfrage. Ihre Administration sieht sie als Aufgabe.</p>
      {done ? <div className="mt-3"><Notice tone="info">Die Anfrage wurde erfasst. Ihre Administration wurde per Aufgabe informiert.</Notice></div> : null}
      {open ? (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setDone(false);
            request.mutate();
          }}
        >
          <div>
            <Label htmlFor="request-name">Name des Systems</Label>
            <Input id="request-name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Lexoffice" />
          </div>
          <div>
            <Label htmlFor="request-note">Wofür brauchen Sie es? (optional)</Label>
            <Input id="request-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          {request.isError ? <div className="sm:col-span-2"><Notice tone="danger">{errorMessage(request.error, 'Die Anfrage konnte nicht erfasst werden.')}</Notice></div> : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={request.isPending}>
              Anfrage erfassen
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
          </div>
        </form>
      ) : (
        <Button className="mt-3" variant="secondary" onClick={() => setOpen(true)}>
          System anfragen
        </Button>
      )}
    </section>
  );
}

function Integrations() {
  const connectorsQuery = useConnectors();
  const integrationsQuery = useIntegrations();
  const [wizard, setWizard] = useState<ConnectorMetadata | null>(null);
  const [disconnecting, setDisconnecting] = useState<ConnectorMetadata | null>(null);

  const connectors = connectorsQuery.data;
  const integrations = integrationsQuery.data;
  const isLoading = connectorsQuery.isLoading || integrationsQuery.isLoading;
  const isError = connectorsQuery.isError || integrationsQuery.isError;
  const connectedFor = (connector: ConnectorMetadata) => integrations?.find((i) => i.connectorType === connector.id && i.hasCredentials);
  const connected = connectors?.filter((connector) => connectedFor(connector)) ?? [];
  const available = connectors?.filter((connector) => !connectedFor(connector)) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Systeme & Verbindungen" description="Welche Ihrer Systeme mit ORBIT verbunden sind – und was davon wirklich nachgewiesen funktioniert.">
        <LastUpdated at={integrationsQuery.dataUpdatedAt ? new Date(integrationsQuery.dataUpdatedAt).toISOString() : null} fetching={integrationsQuery.isFetching} />
      </PageHeader>
      <CallbackBanner />

      {isError ? (
        <ErrorState
          message={errorMessage(connectorsQuery.error ?? integrationsQuery.error, 'Die Verbindungen konnten nicht geladen werden.')}
          onRetry={() => {
            void connectorsQuery.refetch();
            void integrationsQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <p className="text-sm text-slate-600">Wird geladen …</p>
      ) : (
        <>
          <section aria-labelledby="connected-heading" className="space-y-3">
            <h2 id="connected-heading" className="text-lg font-semibold text-slate-900">
              Ihre verbundenen Systeme
            </h2>
            {connected.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Noch kein System verbunden. Verbinden Sie unten zuerst Ihr Postfach – dann erkennt ORBIT eingehende Anfragen und Rechnungen.</p>
            ) : (
              <ul className="space-y-3">
                {connected.map((connector) => (
                  <ConnectionCard key={connector.id} connector={connector} integration={connectedFor(connector) as IntegrationSummary} onDisconnect={() => setDisconnecting(connector)} onRenew={() => setWizard(connector)} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="available-heading" className="space-y-3">
            <h2 id="available-heading" className="text-lg font-semibold text-slate-900">
              Weiteres System verbinden
            </h2>
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {available.map((connector) => {
                const Icon = CONNECTOR_ICONS[connector.icon] ?? Plug;
                const ready = connector.liveConnectSupported || connector.authentication.type === 'api_key';
                return (
                  <li key={connector.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-6 w-6 shrink-0 text-slate-600" aria-hidden="true" />
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{connector.name}</h3>
                        <p className="text-sm text-slate-700">{connector.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge tone={ready ? 'neutral' : 'warning'}>{ready ? 'Nicht verbunden' : 'Noch nicht verfügbar'}</StatusBadge>
                      {ready ? (
                        <Button onClick={() => setWizard(connector)}>Verbinden</Button>
                      ) : (
                        <Button variant="secondary" disabled title="Für dieses System ist die Anbindung noch nicht umgesetzt. Sie können es unten anfragen.">
                          Noch nicht verfügbar
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <RequestSystem />
        </>
      )}

      {wizard ? <SetupWizard connector={wizard} canSend={false} onClose={() => setWizard(null)} /> : null}
      {disconnecting ? <DisconnectDialog connector={disconnecting} onClose={() => setDisconnecting(null)} /> : null}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Wird geladen …</p>}>
      <Integrations />
    </Suspense>
  );
}
