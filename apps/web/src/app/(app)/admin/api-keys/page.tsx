'use client';

import { useState } from 'react';
import { API_KEY_SCOPES, API_KEY_SCOPE_LABELS, type ApiKeyScope } from '@orbit/shared';
import { Badge, Button, Card, ErrorState, Input, Label } from '@orbit/ui';
import { errorMessage } from '../../../../lib/api-client';
import { formatListDateTime } from '../../../../lib/home-format';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '../../../../lib/hooks/use-api-keys';

export default function ApiKeysPage() {
  const { data, isLoading, isError, error, refetch } = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiKeyScope>('staff.sync');
  const [formError, setFormError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setFormError(null);
    setCopied(false);
    try {
      const created = await create.mutateAsync({ name, scopes: [scope] });
      setShown({ name: created.name, key: created.key });
      setName('');
    } catch (e) {
      setFormError(errorMessage(e, 'Der Zugriffsschlüssel konnte nicht angelegt werden.'));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (isError) return <ErrorState message={errorMessage(error, 'Die Zugriffsschlüssel konnten nicht geladen werden.')} onRetry={() => void refetch()} />;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Zugriffsschlüssel</h1>
        <p className="mt-1 text-sm text-slate-600">
          Schlüssel für Systeme statt Menschen, z. B. damit Ihre Personalverwaltung das Mitarbeiterverzeichnis automatisch abgleicht. Ein Schlüssel darf nur das, was sein Bereich erlaubt –
          sonst nichts – und lässt sich jederzeit widerrufen.
        </p>
      </div>

      {shown ? (
        <Card className="space-y-2 border-amber-300 bg-amber-50 p-5" data-testid="new-api-key">
          <h2 className="text-base font-semibold text-slate-900">Schlüssel „{shown.name}“ – jetzt kopieren</h2>
          <p className="text-sm text-slate-700">Dieser Schlüssel wird nur einmal angezeigt. Bewahren Sie ihn wie ein Passwort auf; ORBIT speichert nur einen Fingerabdruck davon.</p>
          <code className="block break-all rounded-md bg-white px-3 py-2 text-sm text-slate-900" data-testid="api-key-value">
            {shown.key}
          </code>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => void copy(shown.key)}>
              {copied ? 'Kopiert' : 'In die Zwischenablage kopieren'}
            </Button>
            <Button variant="ghost" onClick={() => setShown(null)}>
              Verstanden, ausblenden
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">Neuen Schlüssel anlegen</h2>
        <div className="grid gap-3 md:grid-cols-3 md:items-end">
          <div>
            <Label htmlFor="key-name">Name (wofür?)</Label>
            <Input id="key-name" value={name} maxLength={80} placeholder="z. B. Personalverwaltung" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="key-scope">Bereich</Label>
            <select
              id="key-scope"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={scope}
              onChange={(e) => setScope(e.target.value as ApiKeyScope)}
            >
              {API_KEY_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {API_KEY_SCOPE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <Button disabled={create.isPending || name.trim().length < 3} onClick={() => void submit()}>
            {create.isPending ? 'Wird angelegt …' : 'Schlüssel anlegen'}
          </Button>
        </div>
        {formError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Kennung</th>
              <th className="px-4 py-3 font-medium">Bereich</th>
              <th className="px-4 py-3 font-medium">Zuletzt benutzt</th>
              <th className="px-4 py-3 font-medium">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={5}>
                  Wird geladen …
                </td>
              </tr>
            ) : data && data.length > 0 ? (
              data.map((key) => (
                <tr key={key.id} className={key.revokedAt ? 'bg-slate-50 text-slate-500' : undefined} data-testid="api-key-row">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {key.name}
                    {key.revokedAt ? (
                      <Badge tone="neutral" className="ml-2">
                        Widerrufen
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">osk_{key.prefix}_…</td>
                  <td className="px-4 py-3">{key.scopes.map((s) => API_KEY_SCOPE_LABELS[s as ApiKeyScope] ?? s).join(', ')}</td>
                  <td className="px-4 py-3 text-slate-600">{key.lastUsedAt ? formatListDateTime(key.lastUsedAt) : 'noch nie'}</td>
                  <td className="px-4 py-3">
                    {key.revokedAt ? null : (
                      <Button variant="ghost" disabled={revoke.isPending} onClick={() => void revoke.mutateAsync(key.id)}>
                        Widerrufen
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={5}>
                  Noch keine Zugriffsschlüssel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-2 p-5 text-sm text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">So wird ein Schlüssel verwendet</h2>
        <p>
          Das Zielsystem sendet den Schlüssel im Header <code>Authorization: Bearer osk_…</code> (oder <code>X-Api-Key</code>) an <code>PUT /api/v1/staff/sync</code> mit der Mitarbeiterliste als JSON. Mit{' '}
          <code>&quot;dryRun&quot;: true</code> prüft ORBIT nur, ohne zu schreiben.
        </p>
      </Card>
    </div>
  );
}
