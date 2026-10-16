'use client';

import { useState } from 'react';
import { Badge, Card, ErrorState } from '@orbit/ui';
import { errorMessage } from '../../../../lib/api-client';
import { useInterventionReport, type InterventionReport } from '../../../../lib/hooks/use-interventions';

const PERIODS = [
  { days: 7, label: '7 Tage' },
  { days: 30, label: '30 Tage' },
  { days: 90, label: '90 Tage' },
];

const KIND_LABELS: Record<string, string> = {
  MANUAL_REVIEW: 'Prüfung nötig',
  WAITING_FOR_APPROVAL: 'Freigabe nötig',
  FAILED: 'Fehlgeschlagen',
  EMERGENCY: 'Notfall',
};

const SUGGESTION_LABELS: Record<InterventionReport['suggestions'][number]['kind'], string> = {
  OFT_ABGELEHNT: 'Oft abgelehnt',
  IMMER_FREIGEGEBEN: 'Immer freigegeben',
  HAEUFIGER_GRUND: 'Häufiger Grund',
  LANGSAME_REAKTION: 'Langsame Übernahme',
};

const percent = (value: number | null): string => (value === null ? '–' : `${Math.round(value * 100)} %`);
const duration = (minutes: number | null): string => (minutes === null ? '–' : minutes < 90 ? `${Math.round(minutes)} Min.` : `${(minutes / 60).toFixed(1).replace('.', ',')} Std.`);

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
    </Card>
  );
}

export default function InterventionsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, error, refetch } = useInterventionReport(days);

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Wo greifen Menschen ein?</h1>
        <p className="mt-1 text-sm text-slate-600">
          Zeigt, welche Vorgänge ORBIT allein erledigt hat und wo eine Person nötig war – mit Hinweisen, wo sich eine Einstellung oder Pflege lohnt. Die Hinweise ändern nichts selbst.
        </p>
      </div>

      <div className="flex gap-2" role="group" aria-label="Zeitraum">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            type="button"
            aria-pressed={days === p.days}
            onClick={() => setDays(p.days)}
            className={`rounded-md border px-3 py-1.5 text-sm ${days === p.days ? 'border-brand bg-brand/10 font-medium text-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Der Bericht konnte nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <p className="text-sm text-slate-600">Wird geladen …</p>
      ) : (
        <>
          {data.truncated ? <p className="text-sm text-amber-700">Sehr viele Einträge: der Bericht umfasst nur die neuesten.</p> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Figure label="Vorgänge" value={String(data.cases.total)} hint={`in den letzten ${data.days} Tagen`} />
            <Figure label="Ganz automatisch erledigt" value={percent(data.cases.automationRate)} hint={`${data.cases.automated} von ${data.cases.automated + data.cases.withHuman} entschiedenen Vorgängen`} />
            <Figure label="Mit Person" value={String(data.cases.withHuman)} hint={`Prüfung, Freigabe, Fehler oder Meldung; ${data.cases.running} laufen noch`} />
            <Figure label="Übernahme einer Meldung" value={duration(data.attention.medianReactionMinutes)} hint={`Median, ${data.attention.open} noch offen`} />
          </div>

          <Card className="p-4">
            <h2 className="text-base font-semibold text-slate-900">Hinweise</h2>
            {data.suggestions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Im Zeitraum gibt es keine auffälligen Muster (oder zu wenige Vorgänge für einen belegten Hinweis).</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {data.suggestions.map((s) => (
                  <li key={`${s.kind}:${s.subject}`} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{SUGGESTION_LABELS[s.kind]}</Badge>
                      <span className="font-medium text-slate-900">{s.subject}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{s.message}</p>
                    <p className="text-xs text-slate-600">{s.evidence}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="overflow-hidden">
              <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Freigaben nach Aktion</h2>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-medium">Aktion</th>
                    <th className="px-2 py-2 font-medium">Frei</th>
                    <th className="px-2 py-2 font-medium">Abgel.</th>
                    <th className="px-2 py-2 font-medium">Offen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.approvals.byAction.length === 0 ? (
                    <tr>
                      <td className="px-4 py-3 text-slate-600" colSpan={4}>
                        Keine Freigaben im Zeitraum.
                      </td>
                    </tr>
                  ) : (
                    data.approvals.byAction.map((row) => (
                      <tr key={row.action}>
                        <td className="px-4 py-2 text-slate-900">{row.action}</td>
                        <td className="px-2 py-2">{row.approved}</td>
                        <td className="px-2 py-2">{row.rejected}</td>
                        <td className="px-2 py-2">{row.pending}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>

            <Card className="overflow-hidden">
              <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Häufigste Gründe für Handarbeit</h2>
              <table className="mt-2 w-full text-left text-sm">
                <tbody className="divide-y divide-slate-100">
                  {data.topReasons.length === 0 ? (
                    <tr>
                      <td className="px-4 py-3 text-slate-600">Keine Gründe im Zeitraum.</td>
                    </tr>
                  ) : (
                    data.topReasons.map((row) => (
                      <tr key={row.reason}>
                        <td className="px-4 py-2 text-slate-900">{row.reason}</td>
                        <td className="px-4 py-2 text-right">{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Meldungen nach Art</h2>
            <table className="mt-2 w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {data.attention.byKind.length === 0 ? (
                  <tr>
                    <td className="px-4 py-3 text-slate-600">Keine Meldungen im Zeitraum.</td>
                  </tr>
                ) : (
                  data.attention.byKind.map((row) => (
                    <tr key={row.kind}>
                      <td className="px-4 py-2 text-slate-900">{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td className="px-4 py-2 text-right">{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
