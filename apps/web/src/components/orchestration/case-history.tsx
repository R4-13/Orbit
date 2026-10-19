'use client';

import { describeCompletionEvaluation, describeResolutionAttempt, type ResolutionResult, type ResolutionStrategy } from '@orbit/shared';
import { ErrorState } from '@orbit/ui';
import { errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { useCaseEventHistory, type CaseEventRow } from '../../lib/hooks/use-case-orchestration';

function describe(event: CaseEventRow): string {
  const p = event.payload;
  switch (event.type) {
    case 'case.status_changed':
      return `Status geändert: ${String(p.from ?? '–')} → ${String(p.to ?? '–')}`;
    case 'context.resolution_attempted':
      return describeResolutionAttempt({
        requirementKey: String(p.requirementKey),
        strategy: p.strategy as ResolutionStrategy,
        result: p.result as ResolutionResult,
        nextAllowedStrategies: (p.nextAllowedStrategies as ResolutionStrategy[] | undefined) ?? [],
      });
    case 'shadow.plan_proposed':
      return p.available === false ? 'Schattenplan nicht verfügbar (nur Vergleich, nichts ausgeführt)' : 'Schattenplan erstellt (nur Vergleich, nichts ausgeführt)';
    case 'completion.evaluated':
      return describeCompletionEvaluation({ met: p.met === true, goals: (p.goals as Parameters<typeof describeCompletionEvaluation>[0]['goals'] | undefined) ?? [] });
    case 'case.completed':
      return 'Vorgang abgeschlossen (Abschlusskriterien erfüllt)';
    case 'plan.created':
      return `Plan Revision ${String(p.revision)} erstellt`;
    case 'plan.activated':
      return `Plan Revision ${String(p.revision)} aktiviert`;
    case 'plan.superseded':
      return `Plan Revision ${String(p.revision)} durch Revision ${String(p.by)} ersetzt`;
    case 'node.state_changed':
      return p.outputChanged ? `Ergebnis von „${String(p.nodeKey)}“ geändert` : `Schritt „${String(p.nodeKey)}“: ${String(p.state)}`;
    case 'action.prepared':
      return `Aktion vorbereitet: ${String(p.capability)}${p.purpose ? ` (${String(p.purpose)})` : ''}`;
    case 'action.confirmed':
      return `Aktion bestätigt: ${String(p.capability)}${p.purpose ? ` (${String(p.purpose)})` : ''} · ${p.executionMode === 'SIMULATED' ? 'simuliert' : 'live'}`;
    case 'action.outcome_unknown':
      return `Ergebnis einer Aktion ungewiss: ${String(p.capability)}`;
    case 'wait.started':
      return `Wartet auf Antwort (Schritt „${String(p.nodeKey)}“)`;
    case 'wait.satisfied':
      return 'Antwort eingegangen';
    case 'wait.timed_out':
      return 'Frist für die Antwort abgelaufen';
    case 'node.retry_scheduled':
      return `System nicht erreichbar – Schritt „${String(p.nodeKey)}“ wird automatisch wiederholt (Versuch ${String(p.attempt)})`;
    case 'communication.received':
      return 'Nachricht eingegangen';
    case 'case.referenced': {
      const candidates = Array.isArray(p.candidates) ? (p.candidates as Array<{ title?: string }>) : [];
      return p.ambiguous === true
        ? `Bezieht sich vermutlich auf einen früheren Vorgang – ${candidates.length} kommen infrage, bitte zuordnen`
        : `Bezieht sich auf einen früheren Vorgang${candidates[0]?.title ? `: ${candidates[0].title}` : ''}`;
    }
    case 'case.split': {
      const kids = Array.isArray(p.children) ? (p.children as unknown[]) : [];
      return `Nachricht mit mehreren Anliegen in ${kids.length} Teilvorgänge aufgeteilt`;
    }
    case 'case.split_from':
      return `Teilvorgang einer Nachricht mit mehreren Anliegen${p.goal ? `: ${String(p.goal)}` : ''}`;
    case 'plan.scope_approved':
      return 'Umfang der Wirkungen des Plans freigegeben';
    case 'appointment.proposed':
      return 'Termine vorgeschlagen';
    case 'appointment.booked':
      return `Termin im Kalender gebucht${p.start ? ` (${formatDateTime(String(p.start))})` : ''}`;
    case 'customer.record_checked':
      return `Kundenstamm geprüft: ${p.status === 'FOUND' ? 'gefunden' : p.status === 'NOT_FOUND' ? 'nicht vorhanden' : 'System nicht erreichbar'}`;
    case 'requirements.analyzed':
      return 'Anfrage analysiert';
    case 'command.accepted':
      return `Aktion durch Nutzer: ${String(p.commandType)}`;
    default:
      return event.type;
  }
}

/** The full, ordered history of a case — the audit-friendly counterpart of the live graph. */
export function CaseHistory({ caseId }: { caseId: string }) {
  const { data, isLoading, isError, error, refetch } = useCaseEventHistory(caseId);
  if (isLoading) return <p className="text-sm text-slate-600">Historie wird geladen …</p>;
  if (isError) return <ErrorState message={errorMessage(error, 'Die Historie konnte nicht geladen werden.')} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) return <p className="text-sm text-slate-600">Noch keine Ereignisse.</p>;
  return (
    <ol className="space-y-1.5" aria-label="Ereignisse des Vorgangs">
      {[...data].reverse().map((event) => (
        <li key={event.sequence} className="flex gap-3 rounded border border-slate-100 px-3 py-2 text-sm">
          <span className="w-8 shrink-0 text-right text-xs text-slate-600">#{event.sequence}</span>
          <span className="flex-1 text-slate-800">{describe(event)}</span>
          <time className="shrink-0 text-xs text-slate-600" dateTime={event.at}>
            {formatDateTime(event.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
