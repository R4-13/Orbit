'use client';

import { Fragment, useState } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, ErrorState } from '@orbit/ui';
import { ReasonForm } from '../../../components/platform/reason-form';
import { SupportRequestForm } from '../../../components/platform/support-request-form';
import { formatDateTime } from '../../../lib/format';
import { platformErrorMessage, platformFetch } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { supportModeLabel, supportReasonLabel, supportScopeLabel, supportStatusLabel } from '../../../lib/platform/support-labels';
import { usePlatformMutation, usePlatformTenants, useSupportSessions, type SupportSessionRow, type SupportTenantContextView } from '../../../lib/platform/use-platform-data';
import { suspensionScopeLabel, tenantStatusLabel } from '../../../lib/platform/tenant-labels';
import { useQuery } from '@tanstack/react-query';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { ACTIVE: 'success', REQUESTED: 'warning', EXPIRED: 'neutral', CLOSED: 'neutral', REVOKED: 'danger' };

/** Lesender Einblick innerhalb einer aktiven Sitzung: Mandantenkontext ohne Geschäftsinhalte. Inhalte von Vorgängen bleiben der API vorbehalten. */
function SessionContext({ session }: { session: SupportSessionRow }) {
  const canSeeConfig = session.scopes.includes('tenant.config.read');
  const context = useQuery({ queryKey: ['platform', 'support-context', session.id], queryFn: () => platformFetch<SupportTenantContextView>(`/support-sessions/${encodeURIComponent(session.id)}/tenant`), enabled: canSeeConfig });
  if (!canSeeConfig) return <p className="text-sm text-slate-600">Diese Sitzung erlaubt keinen Einblick in die Konfiguration des Mandanten.</p>;
  if (context.isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (context.isError || !context.data) return <ErrorState message={platformErrorMessage(context.error, 'Der Mandantenkontext konnte nicht geladen werden.')} onRetry={() => context.refetch()} />;
  const c = context.data;
  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      <div>
        <dt className="font-medium text-slate-700">Zustand</dt>
        <dd className="text-slate-600">
          {tenantStatusLabel(c.status)}
          {c.suspensionScopes.length > 0 ? ` · gesperrt: ${c.suspensionScopes.map(suspensionScopeLabel).join(', ')}` : ''}
        </dd>
      </div>
      <div>
        <dt className="font-medium text-slate-700">Funktionsgruppen</dt>
        <dd className="text-slate-600">{c.featureCohorts.join(', ') || '–'}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-700">Anbindungen</dt>
        <dd className="text-slate-600">{c.integrations.length === 0 ? '–' : c.integrations.map((i) => `${i.connectorType} (${i.status})`).join(', ')}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-700">Freigabe-Richtlinien</dt>
        <dd className="text-slate-600">{c.policies.length} Richtlinien hinterlegt</dd>
      </div>
    </dl>
  );
}

type RowAction = 'approve' | 'close' | 'revoke' | 'context';

export default function PlatformSupportPage() {
  const { principal, hasScope, withStepUp } = usePlatformAuth();
  const sessions = useSupportSessions();
  const tenants = usePlatformTenants();
  const [requesting, setRequesting] = useState(false);
  const [open, setOpen] = useState<{ id: string; action: RowAction } | null>(null);

  const tenantName = (id: string) => tenants.data?.find((t) => t.tenantId === id)?.displayName ?? 'Unbekannter Mandant';
  const canRequest = hasScope(PLATFORM_SCOPES.SUPPORT_SESSION_REQUEST);
  const canApprove = hasScope(PLATFORM_SCOPES.SUPPORT_SESSION_APPROVE);

  const act = usePlatformMutation(({ session, action, reason }: { session: SupportSessionRow; action: 'approve' | 'close' | 'revoke'; reason: string }) =>
    withStepUp(() =>
      platformFetch(`/support-sessions/${encodeURIComponent(session.id)}/${action}`, { method: 'POST', body: JSON.stringify(action === 'approve' ? { reason, expectedVersion: session.version } : { reason }) }),
    ),
  );

  if (sessions.isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (sessions.isError || !sessions.data) return <ErrorState message={platformErrorMessage(sessions.error, 'Die Support-Sitzungen konnten nicht geladen werden.')} onRetry={() => sessions.refetch()} />;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Support-Sitzungen</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Zugriff auf Mandanten gibt es nur über eine begründete, befristete Sitzung mit ausdrücklichen Zugriffsarten. Es gibt keine Anmeldung als Kunde. Der Zugriff auf Inhalte von Vorgängen verlangt die
            Freigabe einer zweiten Person.
          </p>
        </div>
        {canRequest && !requesting ? <Button onClick={() => setRequesting(true)}>Sitzung anfordern</Button> : null}
      </div>

      {requesting ? <SupportRequestForm onDone={() => setRequesting(false)} /> : null}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Support-Sitzungen</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Mandant</th>
                <th scope="col" className="px-4 py-2 font-medium">Zugriff</th>
                <th scope="col" className="px-4 py-2 font-medium">Anlass</th>
                <th scope="col" className="px-4 py-2 font-medium">Zustand</th>
                <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">Keine Support-Sitzungen.</td>
                </tr>
              ) : (
                sessions.data.map((s) => {
                  const own = s.operatorUserId === principal?.userId;
                  const active = s.status === 'ACTIVE';
                  const pending = s.status === 'REQUESTED';
                  const canClose = (active || pending) && (own || canApprove);
                  const isOpen = open?.id === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr className="border-b border-slate-100 align-top last:border-0">
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{tenantName(s.targetTenantId)}</div>
                          <div className="text-xs text-slate-500">{own ? 'Angefordert von Ihnen' : 'Angefordert von einer anderen Person'} · {formatDateTime(s.createdAt)}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          <div>{supportModeLabel(s.mode)}</div>
                          <div className="text-xs text-slate-500">{s.scopes.map(supportScopeLabel).join(' · ')}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          <div>{supportReasonLabel(s.reasonCode)}{s.ticketRef ? ` · ${s.ticketRef}` : ''}</div>
                          <div className="max-w-xs text-xs text-slate-500">{s.freeTextReason}</div>
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{supportStatusLabel(s.status)}</Badge>
                          {active && s.expiresAt ? <div className="mt-1 text-xs text-slate-500">bis {formatDateTime(s.expiresAt)}</div> : null}
                          {pending && s.requiresApproval ? <div className="mt-1 text-xs text-slate-500">wartet auf Freigabe einer zweiten Person</div> : null}
                          {s.closeReason ? <div className="mt-1 text-xs text-slate-500">{s.closeReason}</div> : null}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            {active && own ? <Button variant="secondary" onClick={() => setOpen(isOpen && open?.action === 'context' ? null : { id: s.id, action: 'context' })} aria-label="Mandantenkontext ansehen">Kontext</Button> : null}
                            {pending && s.requiresApproval && canApprove && !own ? <Button onClick={() => setOpen({ id: s.id, action: 'approve' })}>Freigeben</Button> : null}
                            {canClose ? <Button variant="secondary" onClick={() => setOpen({ id: s.id, action: 'close' })}>Beenden</Button> : null}
                            {(active || pending) && canApprove && !own ? <Button variant="danger" onClick={() => setOpen({ id: s.id, action: 'revoke' })}>Widerrufen</Button> : null}
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-b border-slate-100">
                          <td colSpan={5} className="px-4 pb-4">
                            {open?.action === 'context' ? (
                              <SessionContext session={s} />
                            ) : (
                              <ReasonForm
                                id={`ss-${s.id}-${open?.action}`}
                                effect={
                                  open?.action === 'approve'
                                    ? 'Die Sitzung wird aktiv und läuft für die angeforderte Dauer; danach endet sie von selbst und lässt sich nicht verlängern.'
                                    : open?.action === 'revoke'
                                      ? 'Die Sitzung endet sofort; jeder weitere Zugriff über sie wird abgewiesen.'
                                      : 'Die Sitzung endet; für weiteren Zugriff ist eine neue Anforderung nötig.'
                                }
                                confirmLabel={open?.action === 'approve' ? 'Freigabe bestätigen' : open?.action === 'revoke' ? 'Widerruf bestätigen' : 'Beenden bestätigen'}
                                danger={open?.action === 'revoke'}
                                onCancel={() => setOpen(null)}
                                onConfirm={async (reason) => {
                                  await act.mutateAsync({ session: s, action: open?.action as 'approve' | 'close' | 'revoke', reason });
                                  setOpen(null);
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
