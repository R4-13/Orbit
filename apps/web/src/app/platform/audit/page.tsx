'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, ErrorState, Input, Label } from '@orbit/ui';
import { formatDateTime } from '../../../lib/format';
import { platformErrorMessage } from '../../../lib/platform/platform-client';
import { useAuditTrail } from '../../../lib/platform/use-platform-data';

/** Der Plattform-Audit ist unveränderlich (Datenbank-Trigger); diese Ansicht liest ihn nur, seitenweise und ohne Nutzdaten. */
export default function PlatformAuditPage() {
  const [eventType, setEventType] = useState('');
  const [tenantId, setTenantId] = useState('');
  // Cursor-Stapel: jede geladene Seite merkt sich ihren `before`-Wert, damit „Zurück“ möglich bleibt.
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const before = cursors[cursors.length - 1];
  const { data, isLoading, isError, error, refetch } = useAuditTrail({ eventType: eventType.trim() || undefined, targetTenantId: tenantId.trim() || undefined }, before);

  const resetPaging = () => setCursors([undefined]);

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Plattform-Audit</h1>
        <p className="text-sm text-slate-600">Unveränderliches Protokoll aller Betreiberaktionen: wer, wann, was, mit welcher Begründung.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="audit-type">Ereignistyp</Label>
          <Input id="audit-type" placeholder="z. B. PLATFORM_LOGIN" value={eventType} onChange={(e) => { setEventType(e.target.value); resetPaging(); }} />
        </div>
        <div>
          <Label htmlFor="audit-tenant">Mandanten-ID</Label>
          <Input id="audit-tenant" placeholder="Betroffener Mandant" value={tenantId} onChange={(e) => { setTenantId(e.target.value); resetPaging(); }} />
        </div>
      </div>

      {isLoading ? <p className="text-sm text-slate-600">Wird geladen …</p> : null}
      {isError ? <ErrorState message={platformErrorMessage(error, 'Das Audit konnte nicht geladen werden.')} onRetry={() => refetch()} /> : null}
      {data ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Plattform-Audit</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Zeitpunkt</th>
                  <th scope="col" className="px-4 py-2 font-medium">Ereignis</th>
                  <th scope="col" className="px-4 py-2 font-medium">Rollen</th>
                  <th scope="col" className="px-4 py-2 font-medium">Ziel</th>
                  <th scope="col" className="px-4 py-2 font-medium">Begründung</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-600">Keine Ereignisse gefunden.</td>
                  </tr>
                ) : (
                  data.items.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formatDateTime(row.at)}</td>
                      <td className="px-4 py-2">
                        <Badge tone={row.eventType.includes('DENIED') ? 'danger' : 'neutral'}>{row.eventType}</Badge>
                        {row.supportSessionId ? <span className="ml-1 text-xs text-slate-500">Support-Sitzung</span> : null}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{row.actorRoles.join(', ') || '–'}</td>
                      <td className="px-4 py-2 text-slate-700">
                        {row.targetType ?? '–'}
                        {row.targetTenantId ? <div className="text-xs text-slate-500">Mandant {row.targetTenantId}</div> : null}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{row.reason ?? '–'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>Neuere</Button>
        <Button variant="secondary" disabled={!data?.nextBefore} onClick={() => data?.nextBefore && setCursors((c) => [...c, data.nextBefore])}>Ältere</Button>
      </div>
    </>
  );
}
