'use client';

import { useState, type FormEvent } from 'react';
import type { Contact } from '@orbit/domain';
import { Button, Card, ErrorState, Input, Label, SortableTh, useSortableList } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { useContacts, useCreateContact } from '../../../../lib/hooks/use-contacts';

const SORT_ACCESSORS = {
  name: (c: Contact) => `${c.firstName} ${c.lastName}`,
  email: (c: Contact) => c.email,
};

export default function ContactsPage() {
  const { data: contacts, isLoading, isError, error: loadError, refetch } = useContacts();
  const { sorted, sort, requestSort } = useSortableList(contacts, SORT_ACCESSORS);
  const createContact = useCreateContact();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createContact.mutateAsync({ firstName, lastName, email: email || undefined });
      setFirstName('');
      setLastName('');
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kontakt konnte nicht angelegt werden.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Kontakte</h1>
        <p className="mt-1 text-sm text-slate-500">Interessenten und Ansprechpartner im CRM.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <Label htmlFor="firstName">Vorname</Label>
            <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="lastName">Nachname</Label>
            <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">E-Mail (optional)</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" disabled={createContact.isPending}>
            Kontakt anlegen
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </Card>

      {isError ? (
        <ErrorState
          message={errorMessage(loadError, 'Die Kontakte konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh label="Name" sortKey="name" sort={sort} onSort={requestSort} />
              <SortableTh label="E-Mail" sortKey="email" sort={sort} onSort={requestSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={2}>
                  Wird geladen …
                </td>
              </tr>
            ) : sorted && sorted.length > 0 ? (
              sorted.map((contact) => (
                <tr key={contact.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {contact.firstName} {contact.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{contact.email ?? '–'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={2}>
                  Keine Kontakte gefunden.
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
