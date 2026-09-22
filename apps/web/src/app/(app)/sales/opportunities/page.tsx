'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Card } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import { formatAmount } from '../../../../lib/format';
import { useCompanies } from '../../../../lib/hooks/use-companies';
import { useCreateOpportunity, useOpportunities } from '../../../../lib/hooks/use-opportunities';
import { statusLabel } from '../../../../lib/status-labels';

export default function OpportunitiesPage() {
  const { data: opportunities, isLoading } = useOpportunities();
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Opportunities</h1>
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
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Bezeichnung</th>
              <th className="px-4 py-3 font-medium">Wert</th>
              <th className="px-4 py-3 font-medium">Phase</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : opportunities && opportunities.length > 0 ? (
              opportunities.map((opportunity) => {
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
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Keine Opportunities gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
