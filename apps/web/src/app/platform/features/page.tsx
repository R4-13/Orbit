'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, ErrorState, Input, Label } from '@orbit/ui';
import { ReasonForm } from '../../../components/platform/reason-form';
import { formatDateTime } from '../../../lib/format';
import { platformErrorMessage, platformFetch } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { useFlags, usePlatformMutation, type FlagPreview, type FlagRow, type FlagValue } from '../../../lib/platform/use-platform-data';
import { useQuery } from '@tanstack/react-query';

const LIFECYCLES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'RETIRED'] as const;
const LIFECYCLE_LABELS: Record<string, string> = { DRAFT: 'Entwurf', ACTIVE: 'Aktiv', EXPIRED: 'Abgelaufen', RETIRED: 'Zurückgezogen' };
const LIFECYCLE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { ACTIVE: 'success', DRAFT: 'neutral', EXPIRED: 'warning', RETIRED: 'neutral' };

const valueLabel = (value: FlagValue): string => (typeof value === 'boolean' ? (value ? 'An' : 'Aus') : String(value));
const parseValue = (raw: string, like: FlagValue): FlagValue => (typeof like === 'boolean' ? raw === 'true' : typeof like === 'number' ? Number(raw) : raw);

/** Aktuelle Verteilung über alle Mandanten – damit vor einer Änderung sichtbar ist, wen sie betrifft. */
function Distribution({ flagKey }: { flagKey: string }) {
  const preview = useQuery({ queryKey: ['platform', 'features', flagKey, 'preview'], queryFn: () => platformFetch<FlagPreview>(`/features/${encodeURIComponent(flagKey)}/preview`) });
  if (preview.isLoading) return <p className="text-sm text-slate-600">Verteilung wird ermittelt …</p>;
  if (preview.isError || !preview.data) return <p className="text-sm text-red-700">{platformErrorMessage(preview.error, 'Die Verteilung konnte nicht ermittelt werden.')}</p>;
  return (
    <p className="text-sm text-slate-700">
      Aktuell für {preview.data.tenants} Mandanten: {preview.data.distribution.map((d) => `${valueLabel(d.value)} bei ${d.count}`).join(' · ') || '–'}
    </p>
  );
}

function FlagEditor({ flag, onClose }: { flag: FlagRow; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [value, setValue] = useState<string>(String(flag.defaultValue));
  const [lifecycle, setLifecycle] = useState(flag.lifecycle);
  const [expose, setExpose] = useState(flag.exposeToTenant);
  const unchanged = value === String(flag.defaultValue) && lifecycle === flag.lifecycle && expose === flag.exposeToTenant;
  const [confirm, setConfirm] = useState(false);

  const update = usePlatformMutation(({ reason }: { reason: string }) =>
    withStepUp(() =>
      platformFetch(`/features/${encodeURIComponent(flag.key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: flag.version, reason, lifecycle, exposeToTenant: expose, defaultValue: parseValue(value, flag.defaultValue) }),
      }),
    ),
  );

  const overrides = flag.environmentOverrides.length + flag.cohortOverrides.length + flag.tenantOverrides.length;

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4" aria-label={`Flag ${flag.key} ändern`}>
      <Distribution flagKey={flag.key} />
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor={`ff-value-${flag.key}`}>Standardwert</Label>
          {typeof flag.defaultValue === 'boolean' ? (
            <select id={`ff-value-${flag.key}`} value={value} onChange={(e) => { setValue(e.target.value); setConfirm(false); }} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="true">An</option>
              <option value="false">Aus</option>
            </select>
          ) : (
            <Input id={`ff-value-${flag.key}`} value={value} onChange={(e) => { setValue(e.target.value); setConfirm(false); }} />
          )}
        </div>
        <div>
          <Label htmlFor={`ff-life-${flag.key}`}>Lebenszyklus</Label>
          <select id={`ff-life-${flag.key}`} value={lifecycle} onChange={(e) => { setLifecycle(e.target.value); setConfirm(false); }} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            {LIFECYCLES.map((l) => (
              <option key={l} value={l}>
                {LIFECYCLE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end text-sm text-slate-700">
          <input type="checkbox" checked={expose} onChange={(e) => { setExpose(e.target.checked); setConfirm(false); }} />
          Für Mandanten sichtbar (jeder Mandant sieht nur den eigenen Wert)
        </label>
      </div>
      {overrides > 0 ? <p className="text-xs text-slate-500">Ausnahmen (Umgebung, Kohorte, Mandant) bleiben unverändert; sie lassen sich derzeit nur über die Plattform-API pflegen.</p> : null}

      {!confirm ? (
        <div className="flex gap-2">
          <Button onClick={() => setConfirm(true)} disabled={unchanged}>Änderung prüfen</Button>
          <Button variant="secondary" onClick={onClose}>Schließen</Button>
        </div>
      ) : (
        <ReasonForm
          id={`ff-${flag.key}`}
          effect={`Standardwert ${valueLabel(flag.defaultValue)} → ${valueLabel(parseValue(value, flag.defaultValue))}, Lebenszyklus ${LIFECYCLE_LABELS[flag.lifecycle] ?? flag.lifecycle} → ${LIFECYCLE_LABELS[lifecycle] ?? lifecycle}. Mandanten mit Ausnahme behalten ihren Wert.`}
          confirmLabel="Änderung bestätigen"
          onCancel={onClose}
          onConfirm={async (reason) => {
            await update.mutateAsync({ reason });
            onClose();
          }}
        />
      )}
    </div>
  );
}

function CreateFlagForm({ onDone }: { onDone: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [defaultOn, setDefaultOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = usePlatformMutation(() => withStepUp(() => platformFetch('/features', { method: 'POST', body: JSON.stringify({ key: key.trim(), description: description.trim(), owner: owner.trim(), defaultValue: defaultOn }) })));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync(undefined);
      onDone();
    } catch (err) {
      setError(platformErrorMessage(err, 'Das Flag konnte nicht angelegt werden.'));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-slate-200 bg-white p-4" aria-label="Feature-Flag anlegen">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="ff-new-key">Schlüssel</Label>
          <Input id="ff-new-key" required pattern="[a-z][a-z0-9_.\-]{2,80}" placeholder="z. B. planner.new_ranking" value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Kleinbuchstaben, Ziffern, Punkt, Unterstrich, Bindestrich. Sicherheitsschlüssel sind reserviert.</p>
        </div>
        <div>
          <Label htmlFor="ff-new-owner">Verantwortlich</Label>
          <Input id="ff-new-owner" required minLength={2} maxLength={120} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 self-end text-sm text-slate-700">
          <input type="checkbox" checked={defaultOn} onChange={(e) => setDefaultOn(e.target.checked)} />
          Standardmäßig an
        </label>
      </div>
      <div>
        <Label htmlFor="ff-new-desc">Beschreibung</Label>
        <Input id="ff-new-desc" required minLength={5} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <p className="text-xs text-slate-500">Neue Flags starten als Entwurf und wirken erst, wenn sie aktiv gesetzt werden.</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Wird angelegt …' : 'Flag anlegen'}</Button>
        <Button variant="secondary" onClick={onDone} disabled={create.isPending}>Abbrechen</Button>
      </div>
    </form>
  );
}

export default function PlatformFeaturesPage() {
  const { hasScope } = usePlatformAuth();
  const flags = useFlags();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const canWrite = hasScope(PLATFORM_SCOPES.FEATURES_WRITE);

  if (flags.isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (flags.isError || !flags.data) return <ErrorState message={platformErrorMessage(flags.error, 'Die Feature-Flags konnten nicht geladen werden.')} onRetry={() => flags.refetch()} />;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Feature-Flags</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Schrittweise Freigabe von Funktionen. Reihenfolge der Auswertung: Mandant vor Kohorte vor Umgebung vor Standard. Flags können nie eine Sicherheits- oder Freigabe-Regel lockern.
          </p>
        </div>
        {canWrite && !creating ? <Button onClick={() => setCreating(true)}>Neues Flag</Button> : null}
      </div>
      {creating ? <CreateFlagForm onDone={() => setCreating(false)} /> : null}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Feature-Flags</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Flag</th>
                <th scope="col" className="px-4 py-2 font-medium">Standard</th>
                <th scope="col" className="px-4 py-2 font-medium">Zustand</th>
                <th scope="col" className="px-4 py-2 font-medium">Ausnahmen</th>
                {canWrite ? <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Aktion</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {flags.data.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 5 : 4} className="px-4 py-6 text-center text-slate-600">Noch keine Feature-Flags angelegt.</td>
                </tr>
              ) : (
                flags.data.map((f) => (
                  <Fragment key={f.key}>
                    <tr className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{f.key}</div>
                        <div className="max-w-md text-xs text-slate-500">{f.description}</div>
                        <div className="text-xs text-slate-500">Verantwortlich: {f.owner}{f.expiresAt ? ` · läuft ab ${formatDateTime(f.expiresAt)}` : ''}{f.exposeToTenant ? ' · für Mandanten sichtbar' : ''}</div>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{valueLabel(f.defaultValue)}</td>
                      <td className="px-4 py-2"><Badge tone={LIFECYCLE_TONE[f.lifecycle] ?? 'neutral'}>{LIFECYCLE_LABELS[f.lifecycle] ?? 'Unbekannt'}</Badge></td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        {f.environmentOverrides.length} Umgebung · {f.cohortOverrides.length} Kohorten · {f.tenantOverrides.length} Mandanten
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2 text-right">
                          <Button variant="secondary" onClick={() => setEditing(editing === f.key ? null : f.key)} aria-label={`Flag ${f.key} ändern`}>Ändern</Button>
                        </td>
                      ) : null}
                    </tr>
                    {editing === f.key ? (
                      <tr className="border-b border-slate-100">
                        <td colSpan={canWrite ? 5 : 4} className="px-4 pb-4">
                          <FlagEditor flag={f} onClose={() => setEditing(null)} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
