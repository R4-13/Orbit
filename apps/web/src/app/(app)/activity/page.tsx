'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { AgentType } from '@orbit/domain';
import { Badge, Card } from '@orbit/ui';
import { formatDateTime } from '../../../lib/format';
import { useAgentRuns } from '../../../lib/hooks/use-agent-runs';
import { statusLabel } from '../../../lib/status-labels';

const AGENT_TYPE_TABS: { value: AgentType | null; label: string }[] = [
  { value: null, label: 'Alle' },
  { value: 'COMMUNICATION', label: 'Communication' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'SALES', label: 'Sales' },
];

const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  ORCHESTRATOR: 'Orchestrator',
  COMMUNICATION: 'Communication',
  FINANCE: 'Finance',
  SALES: 'Sales',
};

export default function ActivityPage() {
  const agentTypeFilter = useSearchParams().get('agentType') as AgentType | null;
  const { data: runs, isLoading } = useAgentRuns({ agentType: agentTypeFilter ?? undefined });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Activity</h1>
      <p className="mt-1 text-sm text-slate-500">
        Jeder Agent-Lauf, mit den einzelnen Tool-Aufrufen und den getroffenen Policy-Entscheidungen.
      </p>

      <div className="mt-4 flex gap-2">
        {AGENT_TYPE_TABS.map((tab) => {
          const href = tab.value ? `/activity?agentType=${tab.value}` : '/activity';
          const active = (agentTypeFilter ?? null) === tab.value;
          return (
            <Link
              key={tab.label}
              href={href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active ? 'bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <p className="text-sm text-slate-400">Wird geladen …</p>
        ) : runs && runs.length > 0 ? (
          runs.map((run) => {
            const status = statusLabel(run.status);
            return (
              <Card key={run.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-slate-800">{AGENT_TYPE_LABELS[run.agentType]}</span>
                    <span className="ml-2 text-xs text-slate-400">{run.triggerType}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {run.caseId ? (
                      <Link href={`/cases/${run.caseId}`} className="text-xs text-brand hover:underline">
                        Vorgang öffnen
                      </Link>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(run.startedAt)}</p>
                {run.toolInvocations.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {run.toolInvocations.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between">
                        <span>{inv.toolName}</span>
                        <span className="text-slate-400">{inv.status}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {run.errorMessage ? (
                  <p className="mt-2 text-xs text-red-600">{run.errorMessage}</p>
                ) : null}
              </Card>
            );
          })
        ) : (
          <p className="text-sm text-slate-400">Noch keine Agent-Läufe vorhanden.</p>
        )}
      </div>
    </div>
  );
}
