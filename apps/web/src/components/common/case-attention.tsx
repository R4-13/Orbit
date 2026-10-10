'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, STAFF_CHANNEL_LABELS, type StaffContactChannel } from '@orbit/shared';
import { Button } from '@orbit/ui';
import { apiFetch, errorMessage } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { formatDateTime } from '../../lib/format';
import { Notice } from './primitives';

interface CaseAttention {
  id: string;
  kind: string;
  state: string;
  phase: string;
  emergency: boolean;
  since: string;
  acknowledgedAt: string | null;
  notifications: Array<{ person: string; role: string; phase: string; wantedChannel: string; deliveredVia: string | null; status: string; executionMode: string | null; note: string | null; at: string }>;
}

const ROLE_LABELS: Record<string, string> = { RESPONSIBLE: 'zuständig', DEPUTY: 'Vertretung', SUPERVISOR: 'Vorgesetzte/r', LEADERSHIP: 'Leitung' };
const PHASE_LABELS: Record<string, string> = { INITIAL: 'Meldung', REMINDER: 'Erinnerung', ESCALATED: 'Eskalation' };
const STATUS_LABELS: Record<string, string> = { SENT: 'zugestellt', FAILED: 'nicht zugestellt', SKIPPED: 'nicht erreichbar' };

/**
 * Wartet der Vorgang auf einen Menschen, zeigt dieser Hinweis, wen ORBIT informiert hat (und wann, über welchen Kanal, ob es ankam), wie weit die Erinnerung und
 * Eskalation ist – und bietet „Ich kümmere mich“ an, was weitere Erinnerungen beendet. Ohne offenen Eintrag erscheint nichts.
 */
export function CaseAttentionNotice({ caseId }: { caseId: string }) {
  const { hasPermission } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['attention', caseId], queryFn: () => apiFetch<{ attention: CaseAttention | null }>(`/v1/attention/cases/${caseId}`), refetchInterval: 60_000 });
  const acknowledge = useMutation({
    mutationFn: (id: string) => apiFetch<CaseAttention>(`/v1/attention/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['attention', caseId] }),
  });
  const attention = query.data?.attention;
  if (!attention) return null;

  const acknowledged = attention.state === 'ACKNOWLEDGED';
  return (
    <div data-testid="case-attention">
      <Notice tone={attention.emergency ? 'danger' : 'warning'}>
        <p className="font-medium">
          {attention.emergency ? 'Notfall – ' : ''}
          {acknowledged ? 'Ein Mensch hat den Vorgang übernommen.' : 'Dieser Vorgang wartet auf einen Menschen.'} Seit {formatDateTime(attention.since)}
          {!acknowledged && attention.phase !== 'INITIAL' ? ` · ${PHASE_LABELS[attention.phase]} läuft` : ''}.
        </p>
        {attention.notifications.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
            {attention.notifications.map((n, index) => (
              <li key={index}>
                {PHASE_LABELS[n.phase] ?? n.phase}: {n.person} ({ROLE_LABELS[n.role] ?? n.role}) · {formatDateTime(n.at)} · {STATUS_LABELS[n.status] ?? n.status}
                {n.deliveredVia && n.deliveredVia !== n.wantedChannel ? ` per ${STAFF_CHANNEL_LABELS[n.deliveredVia as StaffContactChannel] ?? n.deliveredVia} (gewünscht: ${STAFF_CHANNEL_LABELS[n.wantedChannel as StaffContactChannel] ?? n.wantedChannel})` : ''}
                {n.executionMode === 'SIMULATED' ? ' · simuliert' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[13px]">Es wurde noch niemand informiert{attention.state === 'SUPPRESSED' ? ' (Altbestand)' : ''}.</p>
        )}
        {!acknowledged && hasPermission(PERMISSIONS.CASE_MANAGE) ? (
          <div className="mt-2">
            <Button variant="secondary" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(attention.id)}>
              Ich kümmere mich darum
            </Button>
            {acknowledge.isError ? <span role="alert" className="ml-2 text-sm text-red-700">{errorMessage(acknowledge.error, 'Das hat nicht geklappt.')}</span> : null}
            <span className="ml-2 text-xs text-slate-700">Beendet weitere Erinnerungen; der Vorgang bleibt offen, bis er bearbeitet ist.</span>
          </div>
        ) : null}
      </Notice>
    </div>
  );
}
