'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Approval } from '@orbit/domain';
import { Badge, Button, Card, SortableTh, useSortableList } from '@orbit/ui';
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

const SORT_ACCESSORS = {
  type: (a: Approval) => ENTITY_LABELS[a.entityType] ?? a.entityType,
  status: (a: Approval) => a.status,
  requestedAt: (a: Approval) => new Date(a.requestedAt).getTime(),
};

function detailLink(entityType: string, entityId: string): string | null {
  if (entityType === 'INVOICE') return `/finance/invoices/${entityId}`;
  if (entityType === 'SUPPLIER') return '/finance/suppliers';
  return null;
}

/**
 * Deciding an approval always happens on the owning entity's own
 * endpoint (see ApprovalsService's own doc comment), not a generic
 * "decide" endpoint — this resolves which one to call. Most cases are a
 * plain (entityType, decision) -> endpoint mapping, except a bank-change-
 * flagged invoice (§59 Szenario C): approving that must hit
 * confirm-bank-change (updates the supplier's IBAN on file), not the
 * normal approve endpoint (which requires PENDING_APPROVAL and would
 * 403) — `policyAction` is what the backend already uses to tag that
 * case, so it's the signal used here too, no extra fetch needed.
 *
 * FOLLOW_UP entries (agent tool calls blocked by the Policy Engine) now
 * have a real resume path (docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md,
 * Phase 1 — previously read-only, see the historical note in
 * docs/MASTER_SPEC_GAP_ANALYSIS.md §37). Unlike SUPPLIER/INVOICE, the
 * new `FollowUpsController` is scoped by `Approval.id` itself, not
 * `entityId` (which holds the blocked call's `toolCallId`, not a
 * resource with its own endpoint).
 */
function resolveDecisionPath(approval: Approval, decision: 'approve' | 'reject'): string | null {
  if (approval.entityType === 'SUPPLIER') {
    return `/v1/suppliers/${approval.entityId}/${decision}`;
  }
  if (approval.entityType === 'INVOICE') {
    if (decision === 'approve' && approval.policyAction === 'invoice.bank_change_review') {
      return `/v1/invoices/${approval.entityId}/confirm-bank-change`;
    }
    return `/v1/invoices/${approval.entityId}/${decision}`;
  }
  if (approval.entityType === 'FOLLOW_UP') {
    return `/v1/follow-ups/${approval.id}/${decision}`;
  }
  return null;
}

export default function ApprovalsPage() {
  const { data: approvals, isLoading } = useApprovals();
  const { sorted, sort, requestSort } = useSortableList(approvals, SORT_ACCESSORS);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ approval, decision }: { approval: Approval; decision: 'approve' | 'reject' }) => {
      const path = resolveDecisionPath(approval, decision);
      if (!path) {
        throw new Error(`Für „${approval.entityType}“ gibt es keine automatische Entscheidungs-Aktion.`);
      }
      return apiFetch(path, { method: 'PATCH' });
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
              <SortableTh label="Art" sortKey="type" sort={sort} onSort={requestSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={requestSort} />
              <SortableTh label="Angefragt am" sortKey="requestedAt" sort={sort} onSort={requestSort} />
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
            ) : sorted && sorted.length > 0 ? (
              sorted.map((approval) => {
                const status = statusLabel(approval.status);
                const link = detailLink(approval.entityType, approval.entityId);
                const label = ENTITY_LABELS[approval.entityType] ?? approval.entityType;
                const decidable = approval.status === 'PENDING' && Boolean(resolveDecisionPath(approval, 'approve'));
                const isBankChangeReview = approval.policyAction === 'invoice.bank_change_review';
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
                            {isBankChangeReview ? 'Neue IBAN bestätigen' : 'Freigeben'}
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
