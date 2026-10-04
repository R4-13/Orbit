'use client';

import { ErrorState } from '@orbit/ui';
import { errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { useCaseEventHistory, type CaseEventRow } from '../../lib/hooks/use-case-orchestration';

function describe(event: CaseEventRow): string {
  const p = event.payload;
  switch (event.type) {
    case 'case.status_changed':
      return `Status geändert: ${String(p.from ?? '–')} → ${String(p.to ?? '–')}`;
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
    case 'communication.received':
      return 'Nachricht eingegangen';
    case 'command.accepted':
      return `Aktion durch Nutzer: ${String(p.commandType)}`;
    default:
      return event.type;
  }
}

/** The full, ordered history of a case — the audit-friendly counterpart of the live graph. */
export function CaseHistory({ caseId }: { caseId: string }) {
  const { data, isLoading, isError, error, refetch } = useCaseEventHistory(caseId);
  if (isLoading) return <p className="text-sm text-slate-500">Historie wird geladen …</p>;
  if (isError) return <ErrorState message={errorMessage(error, 'Die Historie konnte nicht geladen werden.')} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) return <p className="text-sm text-slate-500">Noch keine Ereignisse.</p>;
  return (
    <ol className="space-y-1.5" aria-label="Ereignisse des Vorgangs">
      {[...data].reverse().map((event) => (
        <li key={event.sequence} className="flex gap-3 rounded border border-slate-100 px-3 py-2 text-sm">
          <span className="w-8 shrink-0 text-right text-xs text-slate-400">#{event.sequence}</span>
          <span className="flex-1 text-slate-800">{describe(event)}</span>
          <time className="shrink-0 text-xs text-slate-400" dateTime={event.at}>
            {formatDateTime(event.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
