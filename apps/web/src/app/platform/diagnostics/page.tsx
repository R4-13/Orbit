'use client';

import { useState, type FormEvent } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { platformDownload, platformErrorMessage, platformFetch } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { usePlatformTenants, type DiagnosticProjectionView } from '../../../lib/platform/use-platform-data';

const NODE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  SUCCEEDED: 'success',
  RUNNING: 'info',
  PLANNED: 'neutral',
  WAITING: 'warning',
  AWAITING_APPROVAL: 'warning',
  BLOCKED: 'danger',
  FAILED: 'danger',
  OUTCOME_UNKNOWN: 'danger',
};

/**
 * Technische Diagnose eines Vorgangs (Amendment 03 §17): nur Metadaten, nie Fachinhalte; pro Aufruf mandantenscharf, begründet und auditiert. Der Export
 * (Datei) verlässt das System und verlangt deshalb eine erneute Passwortprüfung.
 */
export default function PlatformDiagnosticsPage() {
  const { hasScope, withStepUp } = usePlatformAuth();
  const tenants = usePlatformTenants();
  const [tenantId, setTenantId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'load' | 'export' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projection, setProjection] = useState<DiagnosticProjectionView | null>(null);

  if (!hasScope(PLATFORM_SCOPES.DIAGNOSTICS_READ)) return <p className="text-sm text-slate-600">Für die Diagnose fehlt die Berechtigung.</p>;

  const query = () => new URLSearchParams({ tenantId, reason: reason.trim() }).toString();
  const path = (suffix = '') => `/diagnostics/cases/${encodeURIComponent(caseId.trim())}${suffix}?${query()}`;

  async function load(event: FormEvent) {
    event.preventDefault();
    setBusy('load');
    setError(null);
    setNotice(null);
    setProjection(null);
    try {
      setProjection(await platformFetch<DiagnosticProjectionView>(path()));
    } catch (err) {
      setError(platformErrorMessage(err, 'Die Diagnose konnte nicht geladen werden.'));
    } finally {
      setBusy(null);
    }
  }

  async function exportFile() {
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const file = await withStepUp(() => platformDownload(path('/export')));
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`Exportiert als ${file.filename}. Der Export ist im Audit mit Prüfsumme festgehalten.`);
    } catch (err) {
      setError(platformErrorMessage(err, 'Der Export ist fehlgeschlagen.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Diagnose</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Technische Sicht auf einen Vorgang: Plan, Schritte, Aktionen und Belege, Läufe. Es werden nie Mailtexte, Entwürfe oder Nutzdaten gezeigt; Fehlermeldungen sind geschwärzt. Jeder Aufruf wird mit Ihrer Begründung im Audit festgehalten.
        </p>
      </div>

      <form onSubmit={load} className="space-y-4 rounded-md border border-slate-200 bg-white p-4" aria-label="Diagnose abrufen">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="dg-tenant">Mandant</Label>
            <select id="dg-tenant" required value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Bitte wählen</option>
              {(tenants.data ?? []).map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.displayName} ({t.slug})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="dg-case">Vorgangs-ID</Label>
            <Input id="dg-case" required minLength={8} maxLength={64} value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="dg-reason">Begründung (mindestens 5 Zeichen, wird im Audit festgehalten)</Label>
          <Input id="dg-reason" required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-emerald-700">{notice}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy !== null || !tenantId || caseId.trim().length < 8 || reason.trim().length < 5}>{busy === 'load' ? 'Wird geladen …' : 'Diagnose laden'}</Button>
        </div>
      </form>

      {projection ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Vorgang {projection.caseStatus} <span className="text-sm font-normal text-slate-500">Revision {projection.caseRevision}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              <p>
                {projection.planRevisions.length} Planrevisionen · {projection.nodes.length} Schritte · {projection.actions.length} Aktionen · {projection.agentRuns.length} Läufe · {projection.correlations.length} Zuordnungen
              </p>
              <Button variant="secondary" onClick={exportFile} disabled={busy !== null}>{busy === 'export' ? 'Wird exportiert …' : 'Als Datei exportieren (JSON)'}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schritte</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Schritte des Vorgangs</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Rev.</th>
                    <th scope="col" className="px-4 py-2 font-medium">Schritt</th>
                    <th scope="col" className="px-4 py-2 font-medium">Zustand</th>
                    <th scope="col" className="px-4 py-2 font-medium">Versuche</th>
                    <th scope="col" className="px-4 py-2 font-medium">Fehler</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.nodes.map((n) => (
                    <tr key={`${n.planRevision}-${n.nodeKey}`} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-4 py-2 text-slate-700">{n.planRevision}</td>
                      <td className="px-4 py-2 font-medium text-slate-900">{n.nodeKey}<span className="ml-2 text-xs font-normal text-slate-500">{n.type}</span></td>
                      <td className="px-4 py-2"><Badge tone={NODE_TONE[n.state] ?? 'neutral'}>{n.state}</Badge></td>
                      <td className="px-4 py-2 text-slate-700">{n.attempts}</td>
                      <td className="px-4 py-2 text-xs text-slate-700">{n.errorCode ? `${n.errorCode}${n.errorMessage ? `: ${n.errorMessage}` : ''}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Aktionen und Belege</CardTitle>
            </CardHeader>
            <CardContent>
              {projection.actions.length === 0 ? (
                <p className="text-sm text-slate-600">Keine Aktionen mit Wirkung.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {projection.actions.map((a) => (
                    <li key={a.intentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium text-slate-900">{a.capabilityKey}</span>
                        <span className="ml-2 text-xs text-slate-500">{a.purpose ?? ''} · Schritt {a.nodeKey}{a.errorCode ? ` · ${a.errorCode}` : ''}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {a.receipts.map((r, index) => (
                          <span key={index} className="text-xs text-slate-500">
                            Beleg {r.status} ({r.executionMode})
                          </span>
                        ))}
                        <Badge tone={a.status === 'CONFIRMED' ? 'success' : a.status === 'FAILED' || a.status === 'OUTCOME_UNKNOWN' ? 'danger' : 'neutral'}>{a.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}
