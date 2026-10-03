'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import { formatDateTime } from '../../../../lib/format';
import {
  useCancelTenantDeletion,
  useConfirmTenantDeletion,
  useExportTenantData,
  useOwnTenant,
  useRequestTenantDeletion,
} from '../../../../lib/hooks/use-tenant';

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AdminSettingsPage() {
  const { data: tenant, isLoading, isError, error: tenantError, refetch } = useOwnTenant();
  const exportData = useExportTenantData();
  const requestDeletion = useRequestTenantDeletion();
  const cancelDeletion = useCancelTenantDeletion();
  const confirmDeletion = useConfirmTenantDeletion();

  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deletionResult, setDeletionResult] = useState<string | null>(null);

  function describeError(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Die Aktion ist fehlgeschlagen.';
  }

  async function handleExport() {
    setError(null);
    try {
      const data = await exportData.mutateAsync();
      downloadJson(`orbit-datenexport-${new Date().toISOString().slice(0, 10)}.json`, data);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRequestDeletion() {
    setError(null);
    try {
      await requestDeletion.mutateAsync();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleCancelDeletion() {
    setError(null);
    setConfirmText('');
    try {
      await cancelDeletion.mutateAsync();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleConfirmDeletion() {
    setError(null);
    try {
      const result = await confirmDeletion.mutateAsync();
      setDeletionResult(`Mandant endgültig gelöscht am ${formatDateTime(result.deletedAt)}.`);
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (isLoading) {
    return <p className="text-sm text-slate-500">Wird geladen …</p>;
  }
  if (isError) {
    return <ErrorState message={describeError(tenantError)} onRetry={() => void refetch()} />;
  }
  if (!tenant) {
    return <p className="text-sm text-slate-500">Mandant nicht gefunden.</p>;
  }

  if (deletionResult) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-red-200">
          <CardContent className="text-sm text-red-800">{deletionResult}</CardContent>
        </Card>
      </div>
    );
  }

  const deletionPending = Boolean(tenant.deletionRequestedAt);
  const canConfirmDeletion = confirmText.trim() === tenant.name;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Mandanteneinstellungen</h1>
        <p className="mt-1 text-sm text-slate-500">Stammdaten sowie DSGVO-Funktionen für Ihren Mandanten.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Stammdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd>{tenant.name}</dd>
            <dt className="text-slate-500">Slug</dt>
            <dd>{tenant.slug}</dd>
            <dt className="text-slate-500">Status</dt>
            <dd>
              <Badge tone={tenant.status === 'ACTIVE' ? 'success' : 'warning'}>{tenant.status}</Badge>
            </dd>
            <dt className="text-slate-500">Sprache</dt>
            <dd>{tenant.locale}</dd>
            <dt className="text-slate-500">Zeitzone</dt>
            <dd>{tenant.timezone}</dd>
            <dt className="text-slate-500">Angelegt am</dt>
            <dd>{formatDateTime(tenant.createdAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datenexport (DSGVO)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-slate-600">
            Lädt ein vollständiges JSON-Archiv aller Daten dieses Mandanten herunter (ohne Passwörter oder
            Connector-Zugangsdaten).
          </p>
          <Button onClick={handleExport} disabled={exportData.isPending} variant="secondary">
            Daten exportieren
          </Button>
        </CardContent>
      </Card>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-800">Mandant löschen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-red-800">
            Löscht diesen Mandanten und sämtliche zugehörigen Daten unwiderruflich. Zweistufiger Ablauf als Schutz
            vor versehentlicher Löschung.
          </p>

          {!deletionPending ? (
            <Button onClick={handleRequestDeletion} disabled={requestDeletion.isPending} variant="ghost">
              Löschung beantragen
            </Button>
          ) : (
            <div className="space-y-4">
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Löschung beantragt am {formatDateTime(tenant.deletionRequestedAt)}. Noch nicht ausgeführt.
              </p>
              <Button onClick={handleCancelDeletion} disabled={cancelDeletion.isPending} variant="secondary">
                Anfrage zurückziehen
              </Button>

              <div className="border-t border-red-100 pt-4">
                <Label htmlFor="confirmName">
                  Zur endgültigen Bestätigung bitte den Mandantennamen „{tenant.name}“ eingeben:
                </Label>
                <Input
                  id="confirmName"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={tenant.name}
                />
                <Button
                  className="mt-2"
                  onClick={handleConfirmDeletion}
                  disabled={!canConfirmDeletion || confirmDeletion.isPending}
                >
                  Endgültig und unwiderruflich löschen
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
