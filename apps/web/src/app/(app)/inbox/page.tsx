'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { EmailMessage, IntakeEventStatus } from '@orbit/domain';
import { SIMULATED_TRIAGE_SCENARIOS, SIMULATED_TRIAGE_SCENARIO_LABELS, type SimulatedTriageScenario } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label, SortableTh, useSortableList } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../lib/api-client';
import { formatDateTime } from '../../../lib/format';
import { useEmailMessages, useSimulateIncomingEmail } from '../../../lib/hooks/use-email-messages';

/** `EmailMessage.classification` holds the semantic triage category (registry key); the legacy FINANCE/SALES/OTHER values remain readable for older rows. */
const CLASSIFICATION_LABELS: Record<string, string> = {
  FINANCE: 'Finance',
  SALES: 'Sales',
  OTHER: 'Sonstiges',
  REQUEST_FOR_QUOTE: 'Angebotsanfrage',
  SALES_INQUIRY: 'Vertriebsanfrage',
  INVOICE_RECEIVED: 'Eingangsrechnung',
  SUPPLIER_OFFER: 'Lieferantenangebot',
  COMPLAINT_OR_SERVICE: 'Beschwerde / Service',
  APPLICATION: 'Bewerbung',
  NEWSLETTER_OR_MARKETING: 'Newsletter / Werbung',
  PRIVATE: 'Privat',
  SPAM: 'Spam',
  UNKNOWN: 'Unklar',
};

/** Says what actually happened to the simulated message — never just a label. */
function describeIntakeOutcome(status: IntakeEventStatus | undefined, category: string, hasCase: boolean): string {
  switch (status) {
    case 'COMPLETED':
      return hasCase ? 'Vorgang wurde angelegt und automatisch bearbeitet.' : 'Verarbeitet.';
    case 'NEEDS_REVIEW':
      return 'Zur Prüfung vorgelegt — ein Mitarbeiter muss entscheiden (siehe Aufgaben).';
    case 'SKIPPED_NON_ACTIONABLE':
      return 'Nicht geschäftsrelevant eingestuft — es wurde kein Geschäftsprozess ausgelöst.';
    case 'PENDING_TRIAGE':
      return 'Die KI-Einstufung steht noch aus und wird erneut versucht. Die Nachricht geht nicht verloren.';
    case 'FAILED':
      return 'Die Verarbeitung ist fehlgeschlagen' + (hasCase ? ' — der Vorgang wurde angelegt, die Bearbeitung aber nicht abgeschlossen.' : '.');
    default:
      return `Eingestuft als „${CLASSIFICATION_LABELS[category] ?? category}“${hasCase ? ' — Vorgang wurde angelegt.' : ''}`;
  }
}

const SORT_ACCESSORS = {
  direction: (e: EmailMessage) => e.direction,
  from: (e: EmailMessage) => (e.direction === 'INBOUND' ? e.fromAddress : e.toAddresses.join(', ')),
  subject: (e: EmailMessage) => e.subject,
  classification: (e: EmailMessage) => e.classification,
  receivedAt: (e: EmailMessage) => new Date(e.receivedAt ?? e.createdAt).getTime(),
};

export default function InboxPage() {
  const { data: emails, isLoading, isError, error: loadError, refetch } = useEmailMessages();
  const { sorted, sort, requestSort } = useSortableList(emails, SORT_ACCESSORS);
  const simulate = useSimulateIncomingEmail();

  const [fromAddress, setFromAddress] = useState('');
  const [toAddress, setToAddress] = useState('rechnungen@musterwerk.example');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [scenario, setScenario] = useState<SimulatedTriageScenario | ''>('');
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
        simulatedTriageScenario: scenario || undefined,
      });
      setLastResult(describeIntakeOutcome(result.intakeStatus, result.category, Boolean(result.case)));
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
          Jede eingehende E-Mail, die ORBIT eingestuft hat. Hier kann eine eingehende E-Mail zu Demozwecken
          simuliert werden. Der Auslöser ist manuell, und solange kein echter KI-Provider verbunden ist, ist auch die
          KI-Einstufung simuliert (siehe Administration → KI-Provider).
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
                placeholder="Text der Nachricht"
              />
            </div>
            <div>
              <Label htmlFor="scenario">Ergebnis der simulierten KI</Label>
              <select
                id="scenario"
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={scenario}
                onChange={(event) => setScenario(event.target.value as SimulatedTriageScenario | '')}
              >
                <option value="">Kein Szenario — die simulierte KI liefert kein Ergebnis (→ Prüfung)</option>
                {SIMULATED_TRIAGE_SCENARIOS.map((value) => (
                  <option key={value} value={value}>
                    {SIMULATED_TRIAGE_SCENARIO_LABELS[value]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Solange kein echter KI-Provider verbunden ist, wird nichts anhand von Schlüsselwörtern erraten: Sie wählen hier,
                was die <strong>simulierte</strong> KI antwortet. Mit einem echten Provider entscheidet die KI selbst.
              </p>
            </div>
            <Button type="submit" disabled={simulate.isPending}>
              E-Mail senden
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {lastResult ? <p className="mt-3 text-sm text-emerald-700">{lastResult}</p> : null}
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState
          message={errorMessage(loadError, 'Der Posteingang konnte nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh label="Richtung" sortKey="direction" sort={sort} onSort={requestSort} />
              <SortableTh label="Von / An" sortKey="from" sort={sort} onSort={requestSort} />
              <SortableTh label="Betreff" sortKey="subject" sort={sort} onSort={requestSort} />
              <SortableTh label="Klassifikation" sortKey="classification" sort={sort} onSort={requestSort} />
              <SortableTh label="Empfangen" sortKey="receivedAt" sort={sort} onSort={requestSort} />
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
            ) : sorted && sorted.length > 0 ? (
              sorted.map((email) => (
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
      )}
    </div>
  );
}
