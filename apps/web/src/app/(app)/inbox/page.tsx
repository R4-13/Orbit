'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { ApiError } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { useEmailMessages, useSimulateIncomingEmail } from '../../../lib/hooks/use-email-messages';

const CLASSIFICATION_LABELS: Record<string, string> = {
  FINANCE: 'Finance',
  SALES: 'Sales',
  OTHER: 'Sonstiges',
};

export default function InboxPage() {
  const { data: emails, isLoading } = useEmailMessages();
  const simulate = useSimulateIncomingEmail();

  const [fromAddress, setFromAddress] = useState('');
  const [toAddress, setToAddress] = useState('rechnungen@musterwerk.example');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLastResult(null);
    try {
      const result = await simulate.mutateAsync({
        fromAddress,
        toAddresses: [toAddress],
        subject,
        bodyText,
      });
      setLastResult(
        `Klassifiziert als „${CLASSIFICATION_LABELS[result.category] ?? result.category}“${
          result.case ? ' — Vorgang wurde automatisch angelegt.' : ''
        }`,
      );
      setFromAddress('');
      setSubject('');
      setBodyText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die E-Mail konnte nicht verarbeitet werden.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Posteingang</h1>
        <p className="mt-1 text-sm text-slate-500">
          Jede eingehende E-Mail, die der Communication-Agent klassifiziert hat. Da noch kein echter
          Mail-Connector angebunden ist (siehe docs/KNOWN_LIMITATIONS.md), kann hier eine eingehende E-Mail
          zu Demozwecken simuliert werden — der Agent-Lauf ist dabei echt, nur der Auslöser ist manuell.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Eingehende E-Mail simulieren</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="fromAddress">Von</Label>
                <Input
                  id="fromAddress"
                  type="email"
                  required
                  value={fromAddress}
                  onChange={(event) => setFromAddress(event.target.value)}
                  placeholder="kunde@beispiel.example"
                />
              </div>
              <div>
                <Label htmlFor="toAddress">An</Label>
                <Input
                  id="toAddress"
                  type="email"
                  required
                  value={toAddress}
                  onChange={(event) => setToAddress(event.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="subject">Betreff</Label>
              <Input
                id="subject"
                required
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="z. B. Anfrage zu Ihrem Angebot"
              />
            </div>
            <div>
              <Label htmlFor="bodyText">Nachricht</Label>
              <textarea
                id="bodyText"
                required
                rows={4}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                placeholder="Enthält der Text Wörter wie „Rechnung“, wird sie als Finance klassifiziert; enthält er „Interesse“/„Angebot“/„Anfrage“, als Sales."
              />
            </div>
            <Button type="submit" disabled={simulate.isPending}>
              E-Mail senden
            </Button>
          </form>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          {lastResult ? <p className="mt-3 text-sm text-emerald-700">{lastResult}</p> : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Richtung</th>
              <th className="px-4 py-3 font-medium">Von / An</th>
              <th className="px-4 py-3 font-medium">Betreff</th>
              <th className="px-4 py-3 font-medium">Klassifikation</th>
              <th className="px-4 py-3 font-medium">Empfangen</th>
              <th className="px-4 py-3 font-medium">Vorgang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={6}>
                  Wird geladen …
                </td>
              </tr>
            ) : emails && emails.length > 0 ? (
              emails.map((email) => (
                <tr key={email.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Badge tone={email.direction === 'INBOUND' ? 'info' : 'neutral'}>
                      {email.direction === 'INBOUND' ? 'Eingehend' : 'Ausgehend'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {email.direction === 'INBOUND' ? email.fromAddress : email.toAddresses.join(', ')}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{email.subject ?? '(ohne Betreff)'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {email.classification ? CLASSIFICATION_LABELS[email.classification] ?? email.classification : '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(email.receivedAt ?? email.createdAt)}</td>
                  <td className="px-4 py-3">
                    {email.caseId ? (
                      <Link href={`/cases/${email.caseId}`} className="text-brand hover:underline">
                        Öffnen
                      </Link>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={6}>
                  Noch keine E-Mails vorhanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
