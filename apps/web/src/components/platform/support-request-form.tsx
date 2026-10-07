'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { SUPPORT_MODE_SCOPES, SUPPORT_REASON_CODES, SUPPORT_SENSITIVE_SCOPES, type SupportMode } from '@orbit/shared';
import { Button, Input, Label } from '@orbit/ui';
import { PlatformApiError, platformErrorMessage, platformFetch } from '../../lib/platform/platform-client';
import { supportModeLabel, supportReasonLabel, supportScopeLabel } from '../../lib/platform/support-labels';
import { usePlatformMutation, usePlatformTenants } from '../../lib/platform/use-platform-data';

const SELECTABLE_MODES: SupportMode[] = ['READ_DIAGNOSTICS', 'READ_TENANT_CONTEXT'];

/** Die Server-Prüfung nennt jede Beanstandung einzeln; sie wird in dieser Form angezeigt, nicht als pauschaler Fehler. */
function issueMessages(error: unknown): string[] {
  if (error instanceof PlatformApiError) {
    const issues = (error.details as { issues?: Array<{ message?: string }> } | undefined)?.issues;
    if (issues && issues.length > 0) return issues.map((i) => i.message ?? 'Die Anforderung ist nicht zulässig.');
  }
  return [platformErrorMessage(error, 'Die Support-Session konnte nicht angefordert werden.')];
}

/**
 * Support-Session anfordern (Amendment 03 §18): begründet, befristet, mit ausdrücklichen Zugriffsarten. Es gibt keine Anmeldung „als Kunde“; wer Inhalte
 * sehen will, braucht zusätzlich die Freigabe einer zweiten Person.
 */
export function SupportRequestForm({ onDone }: { onDone: () => void }) {
  const tenants = usePlatformTenants();
  const [tenantId, setTenantId] = useState('');
  const [mode, setMode] = useState<SupportMode>('READ_DIAGNOSTICS');
  const [scopes, setScopes] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(30);
  const [reasonCode, setReasonCode] = useState<string>('INCIDENT');
  const [freeTextReason, setFreeTextReason] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const allowedScopes = useMemo(() => SUPPORT_MODE_SCOPES[mode] as readonly string[], [mode]);
  const needsApproval = scopes.some((s) => (SUPPORT_SENSITIVE_SCOPES as readonly string[]).includes(s));

  const create = usePlatformMutation(() =>
    platformFetch('/support-sessions', { method: 'POST', body: JSON.stringify({ tenantId, mode, scopes, minutes, reasonCode, freeTextReason: freeTextReason.trim(), ...(ticketRef.trim() ? { ticketRef: ticketRef.trim() } : {}) }) }),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors([]);
    try {
      await create.mutateAsync(undefined);
      onDone();
    } catch (err) {
      setErrors(issueMessages(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-slate-200 bg-white p-4" aria-label="Support-Session anfordern">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="ss-tenant">Mandant</Label>
          <select id="ss-tenant" required value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Bitte wählen</option>
            {(tenants.data ?? []).map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.displayName} ({t.slug})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ss-mode">Zugriffsart</Label>
          <select
            id="ss-mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as SupportMode);
              setScopes([]);
            }}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {SELECTABLE_MODES.map((m) => (
              <option key={m} value={m}>
                {supportModeLabel(m)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Unterstützte Aktionen im Mandanten gibt es in dieser Version nicht.</p>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Zugriffe</legend>
        <div className="mt-1 grid gap-1 md:grid-cols-2">
          {allowedScopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, scope] : cur.filter((s) => s !== scope)))} />
              {supportScopeLabel(scope)}
            </label>
          ))}
        </div>
        {needsApproval ? <p className="mt-2 text-sm text-amber-800" role="status">Für den Zugriff auf Inhalte muss eine zweite Person die Sitzung freigeben. Bis dahin ist sie nicht aktiv.</p> : null}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="ss-minutes">Dauer in Minuten</Label>
          <Input id="ss-minutes" type="number" min={5} max={1440} required value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          <p className="mt-1 text-xs text-slate-500">Die Plattformrichtlinie begrenzt die Dauer; eine Sitzung lässt sich nicht verlängern.</p>
        </div>
        <div>
          <Label htmlFor="ss-reason-code">Anlass</Label>
          <select id="ss-reason-code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            {SUPPORT_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {supportReasonLabel(code)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ss-ticket">Ticket (optional)</Label>
          <Input id="ss-ticket" maxLength={80} value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} />
        </div>
      </div>

      <div>
        <Label htmlFor="ss-reason">Begründung (mindestens 10 Zeichen, wird im Audit festgehalten)</Label>
        <Input id="ss-reason" required minLength={10} maxLength={500} value={freeTextReason} onChange={(e) => setFreeTextReason(e.target.value)} />
      </div>

      {errors.length > 0 ? (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || !tenantId || scopes.length === 0 || freeTextReason.trim().length < 10}>
          {create.isPending ? 'Wird angefordert …' : 'Sitzung anfordern'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={create.isPending}>Abbrechen</Button>
      </div>
    </form>
  );
}
