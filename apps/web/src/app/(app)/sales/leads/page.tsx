'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Lead, LeadSource } from '@orbit/domain';
import { Badge, Button, Card, ErrorState, SortableTh, useSortableList } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { useContacts } from '../../../../lib/hooks/use-contacts';
import { useCreateLead, useLeads } from '../../../../lib/hooks/use-leads';
import { statusLabel } from '../../../../lib/status-labels';

const SOURCE_LABELS: Record<LeadSource, string> = {
  EMAIL: 'E-Mail',
  PHONE: 'Telefon',
  WEB: 'Web',
  MANUAL: 'Manuell',
};

const SORT_ACCESSORS = {
  source: (l: Lead) => SOURCE_LABELS[l.source],
  notes: (l: Lead) => l.notes,
  status: (l: Lead) => l.status,
};

export default function LeadsPage() {
  const { data: leads, isLoading, isError, error: loadError, refetch } = useLeads();
  const { sorted, sort, requestSort } = useSortableList(leads, SORT_ACCESSORS);
  const { data: contacts } = useContacts();
  const createLead = useCreateLead();

  const [contactId, setContactId] = useState('');
  const [source, setSource] = useState<LeadSource>('EMAIL');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!contactId) {
      setError('Bitte zuerst einen Kontakt auswählen.');
      return;
    }
    try {
      await createLead.mutateAsync({ contactId, source });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lead konnte nicht angelegt werden.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Leads</h1>
        <p className="mt-1 text-sm text-slate-500">
          Beim Anlegen wird automatisch eine Folgeaufgabe für die Kontaktaufnahme erstellt.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <label htmlFor="contactId" className="mb-1 block text-sm font-medium text-slate-700">
              Kontakt
            </label>
            <select
              id="contactId"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
            >
              <option value="">Bitte wählen …</option>
              {contacts?.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="source" className="mb-1 block text-sm font-medium text-slate-700">
              Quelle
            </label>
            <select
              id="source"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={source}
              onChange={(event) => setSource(event.target.value as LeadSource)}
            >
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={createLead.isPending}>
            Lead anlegen
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {!contacts || contacts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Noch kein Kontakt vorhanden — legen Sie zuerst einen unter „Kontakte“ an.
          </p>
        ) : null}
      </Card>

      {isError ? (
        <ErrorState
          message={errorMessage(loadError, 'Die Leads konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh label="Quelle" sortKey="source" sort={sort} onSort={requestSort} />
              <SortableTh label="Notizen" sortKey="notes" sort={sort} onSort={requestSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={requestSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : sorted && sorted.length > 0 ? (
              sorted.map((lead) => {
                const status = statusLabel(lead.status);
                return (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/sales/leads/${lead.id}`} className="font-medium text-brand hover:underline">
                        {SOURCE_LABELS[lead.source]}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{lead.notes ?? '–'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={3}>
                  Keine Leads gefunden.
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
