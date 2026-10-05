'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { LeadSource } from '@orbit/domain';
import type { LeadFilter } from '@orbit/shared';
import { Button, ErrorState } from '@orbit/ui';
import { EmptyState, EntityLink, FilterTabs, LastUpdated, Notice, PageHeader, SearchField, StatusBadge } from '../../../../components/common/primitives';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { useMainWidth } from '../../../../lib/hooks/use-element-size';
import { useContacts } from '../../../../lib/hooks/use-contacts';
import { useCreateLead } from '../../../../lib/hooks/use-leads';
import { usePersistentState } from '../../../../lib/hooks/use-persistent-state';
import { useLeadList } from '../../../../lib/hooks/use-ui-projections';
import { formatDue } from '../../../../lib/home-format';

const SOURCE_LABELS: Record<LeadSource, string> = { EMAIL: 'E-Mail', PHONE: 'Telefon', WEB: 'Web', MANUAL: 'Manuell' };

interface LeadViewState {
  filter: LeadFilter;
  q: string;
}

/**
 * UI/UX v2 §13.1: Standard „Offene Anfragen“ mit verständlichem nächsten Schritt; Filter Neu, Antwort fehlt, Heute fällig,
 * Abgeschlossen. Kontakt/Unternehmen und Vorgang sind direkt verlinkt; eine CRM-Zuordnung wird nur bei Bestätigung als solche gezeigt.
 */
export default function LeadsPage() {
  const [view, setView, resetView] = usePersistentState<LeadViewState>('leads', { filter: 'OPEN', q: '' });
  const { data, isLoading, isError, error, refetch, isFetching } = useLeadList(view);
  const { data: contacts } = useContacts();
  const createLead = useCreateLead();
  const width = useMainWidth();
  const compact = width > 0 && width < 900;

  const [creating, setCreating] = useState(false);
  const [contactId, setContactId] = useState('');
  const [source, setSource] = useState<LeadSource>('EMAIL');
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!contactId) {
      setFormError('Bitte zuerst einen Kontakt auswählen.');
      return;
    }
    try {
      await createLead.mutateAsync({ contactId, source });
      setCreating(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Der Interessent konnte nicht angelegt werden.');
    }
  }

  const counts = data?.counts;
  const filtered = view.filter !== 'OPEN' || view.q.trim() !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Interessenten"
        description="Offene Kundenanfragen und was als Nächstes zu tun ist. Beim Anlegen entsteht automatisch eine Folgeaufgabe für die Kontaktaufnahme."
        stats={counts ? [{ label: 'Offene Anfragen', value: counts.OPEN }, { label: 'Antwort fehlt', value: counts.REPLY_MISSING }, { label: 'Heute fällig', value: counts.DUE_TODAY }] : undefined}
        actions={
          <button type="button" onClick={() => setCreating((open) => !open)} aria-expanded={creating} className="flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
            <Plus size={15} aria-hidden="true" /> Interessent anlegen
          </button>
        }
      />

      {creating ? (
        <section aria-label="Interessent anlegen" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <div>
              <label htmlFor="contactId" className="mb-1 block text-sm font-medium text-slate-800">
                Kontakt
              </label>
              <select id="contactId" className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" value={contactId} onChange={(event) => setContactId(event.target.value)}>
                <option value="">Bitte wählen …</option>
                {contacts?.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source" className="mb-1 block text-sm font-medium text-slate-800">
                Quelle
              </label>
              <select id="source" className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" value={source} onChange={(event) => setSource(event.target.value as LeadSource)}>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={createLead.isPending}>
              Interessent speichern
            </Button>
          </form>
          {formError ? <div className="mt-3"><Notice tone="danger">{formError}</Notice></div> : null}
          {!contacts || contacts.length === 0 ? (
            <p className="mt-3 text-sm text-slate-700">
              Noch kein Kontakt vorhanden – legen Sie zuerst einen unter{' '}
              <Link href="/sales/contacts" className="font-medium text-brand hover:underline">
                Kontakte
              </Link>{' '}
              an.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Interessenten filtern"
          value={view.filter}
          onChange={(filter) => setView({ ...view, filter })}
          items={[
            { value: 'OPEN', label: 'Offene Anfragen', count: counts?.OPEN },
            { value: 'NEW', label: 'Neu', count: counts?.NEW },
            { value: 'REPLY_MISSING', label: 'Antwort fehlt', count: counts?.REPLY_MISSING },
            { value: 'DUE_TODAY', label: 'Heute fällig', count: counts?.DUE_TODAY },
            { value: 'DONE', label: 'Abgeschlossen', count: counts?.DONE },
            { value: 'ALL', label: 'Alle', count: counts?.ALL },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SearchField label="Interessenten" value={view.q} onChange={(q) => setView({ ...view, q })} placeholder="Kontakt oder Unternehmen …" />
          {filtered ? (
            <button type="button" onClick={resetView} className="text-sm font-medium text-brand hover:underline">
              Filter zurücksetzen
            </button>
          ) : null}
          <LastUpdated at={data?.generatedAt} fetching={isFetching} />
        </div>
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Die Interessenten konnten nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Interessenten mit Kontakt, Quelle, Status und nächstem Schritt</caption>
            <thead className="bg-slate-50 text-xs font-medium text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  Kontakt und Unternehmen
                </th>
                {compact ? null : (
                  <th scope="col" className="w-28 px-3 py-2.5">
                    Quelle
                  </th>
                )}
                <th scope="col" className="w-60 px-3 py-2.5">
                  Status und nächster Schritt
                </th>
                {compact ? null : (
                  <th scope="col" className="w-52 px-3 py-2.5">
                    Vorgang und CRM
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={compact ? 2 : 4} className="px-4 py-8 text-slate-600">
                    Wird geladen …
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 align-top">
                      <Link href={lead.href} className="block truncate font-medium text-slate-900 hover:underline" title={lead.contactLabel}>
                        {lead.contactLabel}
                      </Link>
                      <p className="truncate text-[13px] text-slate-700">{lead.companyLabel ?? 'Kein Unternehmen'}{compact ? ` · ${lead.sourceLabel}` : ''}</p>
                    </td>
                    {compact ? null : <td className="px-3 py-3 align-top text-slate-800">{lead.sourceLabel}</td>}
                    <td className="px-3 py-3 align-top">
                      <StatusBadge tone={lead.statusTone}>{lead.statusLabel}</StatusBadge>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-700">
                        {lead.nextStep}
                        {lead.dueAt ? ` · ${formatDue(lead.dueAt)}` : ''}
                      </p>
                    </td>
                    {compact ? null : (
                      <td className="px-3 py-3 align-top">
                        {lead.caseRef ? <EntityLink entity={lead.caseRef} /> : <span className="text-slate-500">Kein Vorgang</span>}
                        <p className="mt-0.5 truncate text-xs text-slate-600">{lead.crmLabel}</p>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={compact ? 2 : 4}>
                    <EmptyState title={filtered ? 'Keine Interessenten für diese Auswahl' : 'Keine offenen Anfragen'}>{filtered ? 'Passen Sie den Filter an oder setzen Sie ihn zurück.' : 'Neue Kundenanfragen erscheinen hier, sobald sie eingehen.'}</EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
