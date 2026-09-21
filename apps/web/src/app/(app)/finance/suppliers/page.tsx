'use client';

import { useState } from 'react';
import { Badge, Button, Card } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import { useApproveSupplier, useRejectSupplier, useSuppliers } from '../../../../lib/hooks/use-suppliers';
import { statusLabel } from '../../../../lib/status-labels';

export default function SuppliersPage() {
  const { data: suppliers, isLoading } = useSuppliers();
  const approveSupplier = useApproveSupplier();
  const rejectSupplier = useRejectSupplier();
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
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Lieferanten</h1>
      <p className="mt-1 text-sm text-slate-500">
        Neue Lieferanten benötigen vor der ersten Zahlung eine Freigabe.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : suppliers && suppliers.length > 0 ? (
              suppliers.map((supplier) => {
                const status = statusLabel(supplier.status);
                return (
                  <tr key={supplier.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{supplier.name}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
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
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Keine Lieferanten gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
