'use client';

import { useState, type FormEvent } from 'react';
import { AI_PROFILE_KEYS, COST_STATE_LABELS, PLATFORM_SCOPES, type CostLimitScope, type CostLimitState } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { platformErrorMessage, PlatformApiError, platformFetch } from '../../lib/platform/platform-client';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { useCostAnomalies, useCostLimits, usePlatformMutation, usePlatformTenants, type CostLimitRow } from '../../lib/platform/use-platform-data';
import { ReasonForm } from './reason-form';

const STATE_TONE: Record<CostLimitState, 'success' | 'warning' | 'danger' | 'neutral'> = { OK: 'success', WARNING: 'warning', SOFT_EXCEEDED: 'warning', HARD_EXCEEDED: 'danger' };
const SCOPE_LABELS: Record<CostLimitScope, string> = { GLOBAL: 'Gesamte Plattform', TENANT: 'Mandant', PROFILE: 'KI-Profil' };

const money = (value: number | null, currency: string) => (value === null ? '–' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${currency}`);

/** Füllstand gegen die höchste gesetzte Schwelle; die Farbe folgt dem Zustand, nicht dem Prozentwert. */
function Gauge({ row }: { row: CostLimitRow }) {
  const top = row.hardAmount ?? row.softAmount ?? row.warnAmount ?? 1;
  const percent = Math.min(100, Math.round((row.spent / top) * 100));
  const bar = row.state === 'HARD_EXCEEDED' ? 'bg-red-500' : row.state === 'OK' ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <div className="mt-2" aria-label={`${percent} Prozent der höchsten Schwelle`}>
      <div className="h-2 w-full rounded bg-slate-100">
        <div className={`h-2 rounded ${bar}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function LimitForm({ existing, onDone }: { existing?: CostLimitRow; onDone: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const tenants = usePlatformTenants();
  const [scope, setScope] = useState<CostLimitScope>(existing?.scope ?? 'TENANT');
  const [tenantId, setTenantId] = useState(existing?.targetTenantId ?? '');
  const [profileKey, setProfileKey] = useState(existing?.profileKey ?? AI_PROFILE_KEYS[0]);
  const [warn, setWarn] = useState(existing?.warnAmount?.toString() ?? '');
  const [soft, setSoft] = useState(existing?.softAmount?.toString() ?? '');
  const [hard, setHard] = useState(existing?.hardAmount?.toString() ?? '');
  const [enforced, setEnforced] = useState(existing?.hardEnforced ?? false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const amount = (value: string) => (value.trim() === '' ? undefined : Number(value.replace(',', '.')));

  const save = usePlatformMutation(() =>
    withStepUp(() =>
      platformFetch('/ai/cost-limits', {
        method: 'PUT',
        body: JSON.stringify({
          scope,
          ...(scope === 'TENANT' ? { targetTenantId: tenantId } : {}),
          ...(scope === 'PROFILE' ? { profileKey } : {}),
          warnAmount: amount(warn),
          softAmount: amount(soft),
          hardAmount: amount(hard),
          hardEnforced: enforced,
          ...(existing ? { expectedVersion: existing.version } : {}),
          reason: reason.trim(),
        }),
      }),
    ),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors([]);
    try {
      await save.mutateAsync(undefined);
      onDone();
    } catch (err) {
      const issues = err instanceof PlatformApiError ? (err.details as { issues?: string[] } | undefined)?.issues : undefined;
      setErrors(issues && issues.length > 0 ? issues : [platformErrorMessage(err, 'Das Limit konnte nicht gespeichert werden.')]);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-slate-200 bg-white p-4" aria-label={existing ? 'Kostenlimit ändern' : 'Kostenlimit anlegen'}>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="cl-scope">Gilt für</Label>
          <select id="cl-scope" disabled={Boolean(existing)} value={scope} onChange={(e) => setScope(e.target.value as CostLimitScope)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">
            {(['TENANT', 'PROFILE', 'GLOBAL'] as const).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {scope === 'TENANT' ? (
          <div>
            <Label htmlFor="cl-tenant">Mandant</Label>
            <select id="cl-tenant" disabled={Boolean(existing)} required value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">Bitte wählen</option>
              {(tenants.data ?? []).map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.displayName} ({t.slug})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {scope === 'PROFILE' ? (
          <div>
            <Label htmlFor="cl-profile">KI-Profil</Label>
            <select id="cl-profile" disabled={Boolean(existing)} value={profileKey} onChange={(e) => setProfileKey(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">
              {AI_PROFILE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="cl-warn">Warnschwelle (USD je Monat)</Label>
          <Input id="cl-warn" inputMode="decimal" value={warn} onChange={(e) => setWarn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cl-soft">Soft-Limit</Label>
          <Input id="cl-soft" inputMode="decimal" value={soft} onChange={(e) => setSoft(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cl-hard">Hard-Limit</Label>
          <Input id="cl-hard" inputMode="decimal" value={hard} onChange={(e) => setHard(e.target.value)} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={enforced} onChange={(e) => setEnforced(e.target.checked)} />
        <span>
          Hard-Limit durchsetzen
          <span className="block text-xs text-slate-500">Ist es erreicht, werden neue KI-Aufrufe ehrlich abgewiesen („vorübergehend nicht verfügbar“); Vorgänge warten, nichts gilt als erledigt. Eigene Schlüssel der Mandanten sind ausgenommen. Ohne Haken wird nur gemeldet.</span>
        </span>
      </label>
      <div>
        <Label htmlFor="cl-reason">Begründung (wird im Audit festgehalten)</Label>
        <Input id="cl-reason" required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {errors.length > 0 ? (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || reason.trim().length < 5}>{save.isPending ? 'Wird gespeichert …' : existing ? 'Limit ändern' : 'Limit anlegen'}</Button>
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>Abbrechen</Button>
      </div>
    </form>
  );
}

function RemoveLimit({ row, onClose }: { row: CostLimitRow; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const remove = usePlatformMutation(({ reason }: { reason: string }) => withStepUp(() => platformFetch(`/ai/cost-limits/${encodeURIComponent(row.id)}/remove`, { method: 'POST', body: JSON.stringify({ expectedVersion: row.version, reason }) })));
  return (
    <ReasonForm
      id={`cl-remove-${row.id}`}
      effect={row.hardEnforced ? 'Das Limit entfällt, und ein bestehender Block für neue KI-Aufrufe endet sofort.' : 'Das Limit entfällt; es gibt für diesen Bereich keine Meldungen mehr.'}
      confirmLabel="Limit entfernen"
      danger
      onCancel={onClose}
      onConfirm={async (reason) => {
        await remove.mutateAsync({ reason });
        onClose();
      }}
    />
  );
}

/** Kosten-Leitplanken (Amendment 03 §12.3): Limits mit aufgelaufenen Kosten des Monats, Zustand und ungewöhnliche Nutzung. */
export function AiCostPanel() {
  const { hasScope } = usePlatformAuth();
  const canRead = hasScope(PLATFORM_SCOPES.AI_COST_READ);
  const canWrite = hasScope(PLATFORM_SCOPES.AI_WRITE) && canRead;
  const limits = useCostLimits(canRead);
  const anomalies = useCostAnomalies(canRead);
  const tenants = usePlatformTenants();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; action: 'edit' | 'remove' } | null>(null);
  if (!canRead) return null;

  const name = (id: string | null) => tenants.data?.find((t) => t.tenantId === id)?.displayName ?? 'Unbekannter Mandant';
  const target = (row: CostLimitRow) => (row.scope === 'GLOBAL' ? 'Gesamte Plattform' : row.scope === 'TENANT' ? `Mandant ${name(row.targetTenantId)}` : `Profil ${row.profileKey}`);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Kosten und Limits</CardTitle>
          {canWrite && !creating ? <Button variant="secondary" onClick={() => setCreating(true)}>Neues Limit</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Monatliche Schwellen je Plattform, Mandant oder Profil auf den echten Messwerten des laufenden Monats (nur Aufrufe mit Kostenprofil, nur von ORBIT bezahlte Nutzung). Jeder Wechsel wird im Audit festgehalten und optional per Webhook gemeldet.
        </p>
        {creating ? <LimitForm onDone={() => setCreating(false)} /> : null}
        {limits.isError ? <p role="alert" className="text-sm text-red-700">{platformErrorMessage(limits.error, 'Die Limits konnten nicht geladen werden.')}</p> : null}
        {limits.data && limits.data.length === 0 ? <p className="text-sm text-slate-600">Noch keine Limits festgelegt.</p> : null}
        <ul className="divide-y divide-slate-100 text-sm">
          {limits.data?.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{target(row)}</div>
                  <div className="text-xs text-slate-500">
                    Warnung {money(row.warnAmount, row.currency)} · Soft {money(row.softAmount, row.currency)} · Hard {money(row.hardAmount, row.currency)}
                    {row.hardEnforced ? ' · Hard-Limit wird durchgesetzt' : ' · nur Meldung'}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">Bisher in diesem Monat: <strong>{money(row.spent, row.currency)}</strong>{row.unmeasuredRequests > 0 ? ` (zusätzlich ${row.unmeasuredRequests} Aufrufe ohne Kostenprofil, Betrag unbekannt)` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATE_TONE[row.state]}>{COST_STATE_LABELS[row.state]}</Badge>
                  {canWrite ? (
                    <>
                      <Button variant="secondary" onClick={() => setOpen({ id: row.id, action: 'edit' })} aria-label={`Limit für ${target(row)} ändern`}>Ändern</Button>
                      <Button variant="danger" onClick={() => setOpen({ id: row.id, action: 'remove' })} aria-label={`Limit für ${target(row)} entfernen`}>Entfernen</Button>
                    </>
                  ) : null}
                </div>
              </div>
              <Gauge row={row} />
              {open?.id === row.id ? <div className="mt-3">{open.action === 'edit' ? <LimitForm existing={row} onDone={() => setOpen(null)} /> : <RemoveLimit row={row} onClose={() => setOpen(null)} />}</div> : null}
            </li>
          ))}
        </ul>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Ungewöhnliche Nutzung (letzte 24 Stunden)</h3>
          {anomalies.data && anomalies.data.length === 0 ? <p className="mt-1 text-sm text-slate-600">Keine Auffälligkeiten: kein Mandant liegt deutlich über seinem üblichen Tagesvolumen.</p> : null}
          <ul className="mt-1 divide-y divide-slate-100 text-sm">
            {anomalies.data?.map((a) => (
              <li key={a.tenantId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium text-slate-900">{name(a.tenantId)}</span>
                <span className="text-xs text-slate-600">
                  {a.requestsLast24h} Aufrufe · das {a.factor.toLocaleString('de-DE')}-Fache des üblichen Tageswerts ({a.baselineDailyRequests.toLocaleString('de-DE')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
