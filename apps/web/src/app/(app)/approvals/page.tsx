'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Approval } from '@orbit/domain';
import { Badge, Button, Card } from '@orbit/ui';
import { apiFetch, ApiError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { useApprovals } from '../../../lib/hooks/use-approvals';
import { statusLabel } from '../../../lib/status-labels';

const ENTITY_LABELS: Record<string, string> = {
  INVOICE: 'Rechnung',
  BOOKING_PROPOSAL: 'Buchungsvorschlag',
  SUPPLIER: 'Lieferant',
  FOLLOW_UP: 'Folgeaktion',
  MEETING: 'Termin',
};

function detailLink(entityType: string, entityId: string): string | null {
  if (entityType === 'INVOICE') return `/finance/invoices/${entityId}`;
  if (entityType === 'SUPPLIER') return '/finance/suppliers';
  return null;
}

/**
 * Deciding an approval always happens on the owning entity's own
 * endpoint (see ApprovalsService's own doc comment) — this table maps
 * an Approval's entityType to that endpoint. FOLLOW_UP entries (agent
 * tool calls blocked by the Policy Engine) have no such endpoint yet:
 * the Agent Runtime never persists the blocked call's arguments for a
 * later resume, so there is nothing to actually execute on approval —
 * see docs/MASTER_SPEC_GAP_ANALYSIS.md §37. Shown read-only.
 */
const DECIDABLE_ENDPOINTS: Record<string, (id: string) => string> = {
  INVOICE: (id) => `/v1/invoices/${id}`,
  SUPPLIER: (id) => `/v1/suppliers/${id}`,
};

export default function ApprovalsPage() {
  const { data: approvals, isLoading } = useApprovals();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ approval, decision }: { approval: Approval; decision: 'approve' | 'reject' }) => {
      const buildPath = DECIDABLE_ENDPOINTS[approval.entityType];
      if (!buildPath) {
        throw new Error(`Für „${approval.entityType}“ gibt es keine automatische Entscheidungs-Aktion.`);
      }
      return apiFetch(`${buildPath(approval.entityId)}/${decision}`, { method: 'PATCH' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.message : 'Die Entscheidung konnte nicht gespeichert werden.');
    },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900">Freigaben</h1>
      <p className="mt-1 text-sm text-slate-500">
        Übersicht aller Vorgänge, die eine menschliche Entscheidung benötigen.
      </p>

      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Art</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Angefragt am</th>
              <th className="px-4 py-3 font-medium">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={4}>
                  Wird geladen …
                </td>
              </tr>
            ) : approvals && approvals.length > 0 ? (
              approvals.map((approval) => {
                const status = statusLabel(approval.status);
                const link = detailLink(approval.entityType, approval.entityId);
                const label = ENTITY_LABELS[approval.entityType] ?? approval.entityType;
                const decidable = approval.status === 'PENDING' && Boolean(DECIDABLE_ENDPOINTS[approval.entityType]);
                const isPendingThis =
                  decide.isPending && decide.variables?.approval.id === approval.id;
                return (
                  <tr key={approval.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {link ? (
                        <Link href={link} className="text-brand hover:underline">
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(approval.requestedAt)}</td>
                    <td className="px-4 py-3">
                      {decidable ? (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={isPendingThis}
                            onClick={() => {
                              setActionError(null);
                              decide.mutate({ approval, decision: 'approve' });
                            }}
                          >
                            Freigeben
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={isPendingThis}
                            onClick={() => {
                              setActionError(null);
                              decide.mutate({ approval, decision: 'reject' });
                            }}
                          >
                            Ablehnen
                          </Button>
                        </div>
                      ) : approval.status === 'PENDING' ? (
                        <span className="text-xs text-slate-400">Nur lesend (kein Agent-Ausführungspfad)</span>
                      ) : (
                        <span className="text-xs text-slate-400">Entschieden</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={4}>
                  Keine ausstehenden Freigaben.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
