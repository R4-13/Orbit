'use client';

import { useState } from 'react';
import { TENANT_LIFECYCLE_STATUSES, TENANT_SUSPENSION_SCOPES } from '@orbit/shared';
import { Button, Input, Label } from '@orbit/ui';
import { platformErrorMessage, platformFetch } from '../../lib/platform/platform-client';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { suspensionScopeLabel, tenantStatusLabel } from '../../lib/platform/tenant-labels';
import { usePlatformMutation, type PlatformTenantRow, type TenantLifecyclePreview } from '../../lib/platform/use-platform-data';
import { ReasonForm } from './reason-form';

/**
 * Mandantenzustand ändern (Amendment 03 §6): zuerst die beschriebene Wirkung ansehen, dann – gebunden an genau diese Wirkung (Bestätigungs-Token) –
 * mit Begründung und erneuter Passwortprüfung bestätigen. Ändert sich der Zielzustand nach der Vorschau, lehnt der Server die Bestätigung ab.
 */
export function TenantLifecyclePanel({ tenant, onClose }: { tenant: PlatformTenantRow; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [status, setStatus] = useState(tenant.lifecycleStatus);
  const [scopes, setScopes] = useState<string[]>(tenant.suspensionScopes);
  const [cohorts, setCohorts] = useState(tenant.featureCohorts.join(', '));
  const [preview, setPreview] = useState<TenantLifecyclePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const cohortList = () => cohorts.split(',').map((c) => c.trim()).filter(Boolean);
  const edit = () => setPreview(null); // jede Änderung am Ziel verwirft die Vorschau – bestätigt wird nur, was angezeigt wurde

  async function showPreview() {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ status, suspensionScopes: scopes.join(','), featureCohorts: cohortList().join(',') });
      setPreview(await platformFetch<TenantLifecyclePreview>(`/tenants/${encodeURIComponent(tenant.tenantId)}/lifecycle-preview?${query.toString()}`));
    } catch (err) {
      setPreview(null);
      setError(platformErrorMessage(err, 'Die Wirkung konnte nicht ermittelt werden.'));
    } finally {
      setLoading(false);
    }
  }

  const apply = usePlatformMutation(({ reason, token }: { reason: string; token: string }) =>
    withStepUp(() => platformFetch(`/tenants/${encodeURIComponent(tenant.tenantId)}/lifecycle`, { method: 'PATCH', body: JSON.stringify({ status, suspensionScopes: scopes, featureCohorts: cohortList(), reason, confirmationToken: token }) })),
  );

  const unchanged = status === tenant.lifecycleStatus && scopes.slice().sort().join() === tenant.suspensionScopes.slice().sort().join() && cohortList().join() === tenant.featureCohorts.join();

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4" aria-label={`Zustand von ${tenant.displayName} ändern`}>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor={`lc-status-${tenant.tenantId}`}>Zustand</Label>
          <select id={`lc-status-${tenant.tenantId}`} value={status} onChange={(e) => { setStatus(e.target.value); edit(); }} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            {TENANT_LIFECYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tenantStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Sperren</legend>
          <div className="mt-1 space-y-1">
            {TENANT_SUSPENSION_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => { setScopes((current) => (e.target.checked ? [...current, scope] : current.filter((s) => s !== scope))); edit(); }} />
                {suspensionScopeLabel(scope)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Label htmlFor={`lc-cohorts-${tenant.tenantId}`}>Funktionsgruppen (Kohorten)</Label>
          <Input id={`lc-cohorts-${tenant.tenantId}`} value={cohorts} placeholder="z. B. pilot, beta" onChange={(e) => { setCohorts(e.target.value); edit(); }} />
          <p className="mt-1 text-xs text-slate-500">Kleinbuchstaben, Ziffern, _ und -, durch Komma getrennt.</p>
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}

      {!preview ? (
        <div className="flex gap-2">
          <Button onClick={showPreview} disabled={loading || unchanged}>{loading ? 'Wird ermittelt …' : 'Wirkung ansehen'}</Button>
          <Button variant="secondary" onClick={onClose}>Schließen</Button>
        </div>
      ) : (
        <ReasonForm
          id={`lc-${tenant.tenantId}`}
          effect={preview.effects.length > 0 ? preview.effects.join(' ') : 'Keine Änderung der Wirkung.'}
          confirmLabel="Änderung bestätigen"
          danger={preview.target.status !== 'ACTIVE' || preview.target.suspensionScopes.length > 0}
          onCancel={onClose}
          onConfirm={async (reason) => {
            await apply.mutateAsync({ reason, token: preview.confirmationToken });
            onClose();
          }}
        >
          <p className="text-sm text-slate-700">Betroffen: {preview.activeUsers} aktive Benutzer.</p>
        </ReasonForm>
      )}
    </div>
  );
}
