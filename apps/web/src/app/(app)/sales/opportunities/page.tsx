'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Opportunity } from '@orbit/domain';
import { Badge, Button, Card, ErrorState, SortableTh, useSortableList } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { formatAmount } from '../../../../lib/format';
import { useCompanies } from '../../../../lib/hooks/use-companies';
import { useCreateOpportunity, useOpportunities } from '../../../../lib/hooks/use-opportunities';
import { statusLabel } from '../../../../lib/status-labels';

const SORT_ACCESSORS = {
  name: (o: Opportunity) => o.name,
  value: (o: Opportunity) => (o.value !== null ? Number(o.value) : null),
  stage: (o: Opportunity) => o.stage,
};

export default function OpportunitiesPage() {
  const { data: opportunities, isLoading, isError, error: loadError, refetch } = useOpportunities();
  const { sorted, sort, requestSort } = useSortableList(opportunities, SORT_ACCESSORS);
  const { data: companies } = useCompanies();
  const createOpportunity = useCreateOpportunity();

  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createOpportunity.mutateAsync({
        name,
        companyId: companyId || undefined,
        value: value ? Number(value) : undefined,
      });
      setName('');
      setCompanyId('');
      setValue('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opportunity konnte nicht angelegt werden.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Verkaufschancen</h1>
        <p className="mt-1 text-sm text-slate-500">Verkaufschancen von der Qualifizierung bis zum Abschluss.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div className="sm:col-span-2">
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
              Bezeichnung
            </label>
            <input
              id="name"
              required
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Wartungsvertrag 2026"
            />
          </div>
          <div>
            <label htmlFor="companyId" className="mb-1 block text-sm font-medium text-slate-700">
              Firma
            </label>
            <select
              id="companyId"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            >
              <option value="">Keine</option>
              {companies?.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="value" className="mb-1 block text-sm font-medium text-slate-700">
              Wert (EUR)
            </label>
            <input
              id="value"
              type="number"
              min="0"
              step="0.01"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={createOpportunity.isPending}>
              Opportunity anlegen
            </Button>
          </div>
        </form>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </Card>

      {isError ? (
        <ErrorState
          message={errorMessage(loadError, 'Die Opportunities konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh label="Bezeichnung" sortKey="name" sort={sort} onSort={requestSort} />
              <SortableTh label="Wert" sortKey="value" sort={sort} onSort={requestSort} />
              <SortableTh label="Phase" sortKey="stage" sort={sort} onSort={requestSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : sorted && sorted.length > 0 ? (
              sorted.map((opportunity) => {
                const stage = statusLabel(opportunity.stage);
                return (
                  <tr key={opportunity.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/sales/opportunities/${opportunity.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {opportunity.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {opportunity.value !== null ? formatAmount(opportunity.value, opportunity.currency) : '–'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={stage.tone}>{stage.label}</Badge>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  Keine Opportunities gefunden.
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
