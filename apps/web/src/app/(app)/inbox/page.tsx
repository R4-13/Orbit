'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FlaskConical, Mail } from 'lucide-react';
import type { IntakeEventStatus } from '@orbit/domain';
import { SIMULATED_TRIAGE_SCENARIOS, SIMULATED_TRIAGE_SCENARIO_LABELS, caseTabHref, categoryLabel, type InboxFilter, type SimulatedTriageScenario } from '@orbit/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label } from '@orbit/ui';
import { EmptyState, FilterTabs, LastUpdated, PageHeader, Pagination, SearchField, StatusBadge } from '../../../components/common/primitives';
import { ExcludedIntakeSection } from '../../../components/excluded-intake-section';
import { ApiError, errorMessage } from '../../../lib/api-client';
import { useMainWidth } from '../../../lib/hooks/use-element-size';
import { useIntakeVisibility } from '../../../lib/hooks/use-intake-decisions';
import { useSimulateIncomingEmail } from '../../../lib/hooks/use-email-messages';
import { usePersistentState } from '../../../lib/hooks/use-persistent-state';
import { useInboxItems } from '../../../lib/hooks/use-ui-projections';
import { formatListTime } from '../../../lib/home-format';

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
      return `Eingestuft als „${categoryLabel(category)}“${hasCase ? ' — Vorgang wurde angelegt.' : ''}`;
  }
}

const STAGE_TONE = { ATTENTION: 'warning', NEW: 'info', IN_PROGRESS: 'info', DONE: 'success' } as const;

interface ListState {
  filter: InboxFilter;
  q: string;
  page: number;
}

/**
 * UI/UX v2 §11: der Posteingang dient der Sichtung – berechtigte, geschäftsrelevante und ungeklärte Eingänge mit ihrem fachlichen
 * Typ, dem Stand und der Orchestrierung. Agent, Vertrauen und technische Klassifikation stehen im Eingangsdetail. Filter, Suche und
 * Seite überstehen den Weg ins Detail und zurück.
 */
export default function InboxPage() {
  const [state, setState, resetState] = usePersistentState<ListState>('inbox', { filter: 'ALL', q: '', page: 1 });
  const { data, isLoading, isError, error, refetch, isFetching } = useInboxItems({ filter: state.filter, page: state.page, q: state.q });
  const visibility = useIntakeVisibility();
  const width = useMainWidth();
  const compact = width > 0 && width < 900;
  const simulate = useSimulateIncomingEmail();
  const [simulating, setSimulating] = useState(false);

  const [fromAddress, setFromAddress] = useState('');
  const [toAddress, setToAddress] = useState('rechnungen@musterwerk.example');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [scenario, setScenario] = useState<SimulatedTriageScenario | ''>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setLastResult(null);
    try {
      const result = await simulate.mutateAsync({ fromAddress, toAddresses: [toAddress], subject, bodyText, simulatedTriageScenario: scenario || undefined });
      setLastResult(describeIntakeOutcome(result.intakeStatus, result.category, Boolean(result.case)));
      setFromAddress('');
      setSubject('');
      setBodyText('');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Die E-Mail konnte nicht verarbeitet werden.');
    }
  }

  const counts = data?.counts;
  const tabs: Array<{ value: InboxFilter; label: string; count?: number }> = [
    { value: 'ALL', label: 'Alle', count: counts?.ALL },
    { value: 'ATTENTION', label: 'Benötigt Aufmerksamkeit', count: counts?.ATTENTION },
    { value: 'NEW', label: 'Neu', count: counts?.NEW },
    { value: 'IN_PROGRESS', label: 'In Bearbeitung', count: counts?.IN_PROGRESS },
    { value: 'DONE', label: 'Abgeschlossen', count: counts?.DONE },
    { value: 'FINANCE', label: 'Finanzen', count: counts?.FINANCE },
    { value: 'SALES', label: 'Vertrieb', count: counts?.SALES },
  ];
  const filtered = state.filter !== 'ALL' || state.q.trim() !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Posteingang"
        description="Was eingegangen ist und was ORBIT daraus gemacht hat."
        stats={counts ? [{ label: 'Benötigt Aufmerksamkeit', value: counts.ATTENTION }, { label: 'Neu', value: counts.NEW }, { label: 'In Bearbeitung', value: counts.IN_PROGRESS }] : undefined}
        actions={
          visibility.data?.testOperation ? (
            <button type="button" onClick={() => setSimulating((open) => !open)} aria-expanded={simulating} className="flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <FlaskConical size={15} aria-hidden="true" /> Test-Eingang simulieren
            </button>
          ) : null
        }
      />

      {simulating ? (
        <Card>
          <CardHeader>
            <CardTitle>Eingehende E-Mail simulieren (Testbetrieb)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="fromAddress">Von</Label>
                  <Input id="fromAddress" type="email" required value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} placeholder="kunde@beispiel.example" />
                </div>
                <div>
                  <Label htmlFor="toAddress">An</Label>
                  <Input id="toAddress" type="email" required value={toAddress} onChange={(event) => setToAddress(event.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="subject">Betreff</Label>
                <Input id="subject" required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="z. B. Anfrage zu Ihrem Angebot" />
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
                <p className="mt-1 text-xs text-slate-600">Solange kein echter KI-Dienst verbunden ist, wird nichts anhand von Schlüsselwörtern erraten: Sie wählen hier, was die <strong>simulierte</strong> KI antwortet.</p>
              </div>
              <Button type="submit" disabled={simulate.isPending}>
                E-Mail senden
              </Button>
            </form>
            {formError ? (
              <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}
            {lastResult ? <p className="mt-3 text-sm text-emerald-700">{lastResult}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs label="Eingänge filtern" items={tabs} value={state.filter} onChange={(filter) => setState({ ...state, filter, page: 1 })} />
        <div className="flex flex-wrap items-center gap-3">
          <SearchField label="Posteingang" value={state.q} onChange={(q) => setState({ ...state, q, page: 1 })} placeholder="Betreff oder Vorgang suchen …" />
          {filtered ? (
            <button type="button" onClick={resetState} className="text-sm font-medium text-brand hover:underline">
              Filter zurücksetzen
            </button>
          ) : null}
          <LastUpdated at={data?.generatedAt} fetching={isFetching} />
        </div>
      </div>

      {isError ? (
        <ErrorState message={errorMessage(error, 'Der Posteingang konnte nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : (
        <Card className="overflow-hidden rounded-xl">
          {data?.excludedHidden ? <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">Eingänge, die bewusst keinen Geschäftsprozess ausgelöst haben, sind ausgeblendet (siehe unten „Kein Geschäftsprozess ausgelöst“).</p> : null}
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Eingänge mit Absender, Betreff, Typ, Stand und Orchestrierung</caption>
            <thead className="bg-slate-50 text-xs font-medium text-slate-700">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5">
                  <span className="sr-only">Quelle</span>
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Absender und Betreff
                </th>
                {compact ? null : (
                  <th scope="col" className="w-36 px-3 py-2.5">
                    Typ
                  </th>
                )}
                <th scope="col" className="w-44 px-3 py-2.5">
                  Stand und nächster Schritt
                </th>
                {compact ? null : (
                  <th scope="col" className="w-20 px-3 py-2.5">
                    Zeit
                  </th>
                )}
                <th scope="col" className="w-44 px-3 py-2.5">
                  Orchestrierung
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={compact ? 4 : 6} className="px-4 py-8 text-slate-600">
                    Wird geladen …
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 align-top text-slate-500">
                      <Mail size={16} aria-label="E-Mail" role="img" />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Link href={`/inbox/${item.id}`} className="block min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                        <span className="block truncate font-medium text-slate-900" title={item.subject}>
                          {item.subject}
                        </span>
                        <span className="block truncate text-[13px] text-slate-700" title={item.senderAddress ?? item.senderLabel}>
                          {item.senderLabel}
                          {compact ? ` · ${item.typeLabel} · ${formatListTime(item.occurredAt)}` : ''}
                        </span>
                      </Link>
                    </td>
                    {compact ? null : <td className="px-3 py-3 align-top text-slate-800">{item.typeLabel}</td>}
                    <td className="px-3 py-3 align-top">
                      <StatusBadge tone={STAGE_TONE[item.stage]}>{item.statusLabel}</StatusBadge>
                      <p className="mt-1 truncate text-xs text-slate-700">{item.nextActionLabel}</p>
                    </td>
                    {compact ? null : <td className="px-3 py-3 align-top text-slate-700">{formatListTime(item.occurredAt)}</td>}
                    <td className="px-3 py-3 align-top">
                      {item.caseRef ? (
                        <Link href={item.hasProcess ? caseTabHref(item.caseRef.id, 'orchestration') : (item.caseRef.href ?? `/cases/${item.caseRef.id}`)} className="font-medium text-brand hover:underline" aria-label={`${item.hasProcess ? 'Orchestrierung anzeigen' : 'Vorgang ansehen'}: ${item.subject}`}>
                          {item.hasProcess ? 'Orchestrierung anzeigen' : 'Vorgang ansehen'}
                        </Link>
                      ) : (
                        <Link href={`/inbox/${item.id}`} className="font-medium text-brand hover:underline" aria-label={`Entscheidung ansehen: ${item.subject}`}>
                          Entscheidung ansehen
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={compact ? 4 : 6}>
                    <EmptyState title={filtered ? 'Keine Eingänge für diese Auswahl' : 'Noch keine Eingänge'}>
                      {filtered ? 'Passen Sie den Filter an oder setzen Sie ihn zurück.' : 'Sobald eine Nachricht eingeht, erscheint sie hier mit ihrem Stand.'}
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setState({ ...state, page })} /> : null}
        </Card>
      )}

      <ExcludedIntakeSection />
    </div>
  );
}
