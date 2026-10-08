'use client';

import { useState } from 'react';
import type { Supplier } from '@orbit/domain';
import { Badge, Button, Card, ErrorState, SortableTh, useSortableList } from '@orbit/ui';
import { FocusNotice } from '../../../../components/common/primitives';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { useFocusParam } from '../../../../lib/hooks/use-focus-param';
import { formatListDateTime } from '../../../../lib/home-format';
import { useApproveSupplier, useRejectSupplier, useSuppliers } from '../../../../lib/hooks/use-suppliers';
import { statusLabel } from '../../../../lib/status-labels';

const SORT_ACCESSORS = {
  name: (s: Supplier) => s.name,
  status: (s: Supplier) => s.status,
  createdAt: (s: Supplier) => new Date(s.createdAt).toISOString(),
};

export default function SuppliersPage() {
  const { data: suppliers, isLoading, isError, error: loadError, refetch } = useSuppliers();
  const { sorted, sort, requestSort } = useSortableList(suppliers, SORT_ACCESSORS);
  const approveSupplier = useApproveSupplier();
  const rejectSupplier = useRejectSupplier();
  const focus = useFocusParam('focus');
  const visible = sorted?.filter((s) => (focus.value ? s.id === focus.value : true));
  const [error, setError] = useState<string | null>(null);

  async function handleApprove(id: string) {
    setError(null);
    try {
      await approveSupplier.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Freigabe fehlgeschlagen.');
    }
  }

  async function handleReject(id: string) {
    setError(null);
    try {
      await rejectSupplier.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ablehnung fehlgeschlagen.');
    }
  }

  return (
    <div className="">
      <h1 className="text-2xl font-semibold text-slate-900">Lieferanten</h1>
      <p className="mt-1 text-sm text-slate-600">
        Neue Lieferanten benötigen vor der ersten Zahlung eine Freigabe.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {focus.value ? <div className="mt-6"><FocusNotice what="ein Lieferant" onClear={focus.clear} /></div> : null}

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(loadError, 'Die Lieferanten konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <SortableTh label="Name" sortKey="name" sort={sort} onSort={requestSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={requestSort} />
              <SortableTh label="Angelegt am" sortKey="createdAt" sort={sort} onSort={requestSort} />
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={4}>
                  Wird geladen …
                </td>
              </tr>
            ) : visible && visible.length > 0 ? (
              visible.map((supplier) => {
                const status = statusLabel(supplier.status);
                return (
                  <tr key={supplier.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{supplier.name}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatListDateTime(supplier.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {supplier.status === 'PENDING_APPROVAL' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => handleReject(supplier.id)}
                            disabled={rejectSupplier.isPending}
                          >
                            Ablehnen
                          </Button>
                          <Button onClick={() => handleApprove(supplier.id)} disabled={approveSupplier.isPending}>
                            Freigeben
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={4}>
                  Keine Lieferanten gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}
