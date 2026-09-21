'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, Input, Label } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import { useContacts, useCreateContact } from '../../../../lib/hooks/use-contacts';

export default function ContactsPage() {
  const { data: contacts, isLoading } = useContacts();
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Kontakte</h1>
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
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">E-Mail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={2}>
                  Wird geladen …
                </td>
              </tr>
            ) : contacts && contacts.length > 0 ? (
              contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {contact.firstName} {contact.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{contact.email ?? '–'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={2}>
                  Keine Kontakte gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
