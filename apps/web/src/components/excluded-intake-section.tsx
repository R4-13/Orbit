'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { errorMessage } from '../lib/api-client';
import { formatDateTime } from '../lib/format';
import { useExcludedIntake, useIntakeVisibility, useReviewIntakeDecision } from '../lib/hooks/use-intake-decisions';

const CATEGORY_LABELS: Record<string, string> = { NEWSLETTER_OR_MARKETING: 'Newsletter / Werbung', PRIVATE: 'Privat', SPAM: 'Spam', UNKNOWN: 'Unklar' };

/**
 * "Kein Geschäftsprozess ausgelöst" (Amendment 02 §19.2): inputs that deliberately started no process, with the reason and
 * the explicit statement that no action happened. Shown by default in test operation, available as an explicit filter in
 * production — nothing is hidden from the user's reach, only from the default view.
 */
export function ExcludedIntakeSection() {
  const visibility = useIntakeVisibility();
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (open === null && visibility.data) setOpen(visibility.data.showExcludedByDefault);
  }, [open, visibility.data]);
  const isOpen = open ?? false;
  const { data, isLoading, isError, error, refetch } = useExcludedIntake(isOpen);
  const review = useReviewIntakeDecision();

  return (
    <section aria-label="Kein Geschäftsprozess ausgelöst">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        Kein Geschäftsprozess ausgelöst
        {isOpen && data ? <Badge tone="neutral">{data.length}</Badge> : null}
      </button>
      {isOpen ? (
        <Card className="mt-3 overflow-hidden">
          <CardHeader>
            <CardTitle>Eingänge ohne Geschäftsprozess</CardTitle>
            <p className="mt-1 text-xs text-slate-500">Bei diesen Eingängen wurde bewusst nichts ausgelöst: keine Aufgabe, kein Vorgang, keine Antwort. Falls die Einstufung falsch ist, können Sie sie zur Prüfung vormerken.</p>
          </CardHeader>
          <CardContent className="p-0">
            {isError ? (
              <ErrorState className="m-4" message={errorMessage(error, 'Die Liste konnte nicht geladen werden.')} onRetry={() => void refetch()} />
            ) : isLoading ? (
              <p className="px-5 py-4 text-sm text-slate-400">Wird geladen …</p>
            ) : data && data.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {data.map((item) => (
                  <li key={item.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium text-slate-900">{item.subject ?? '(ohne Betreff)'}</p>
                      <p className="text-xs text-slate-500">
                        {item.sender?.address ?? 'unbekannt'} · {formatDateTime(item.occurredAt)}
                      </p>
                      <p className="mt-1 text-slate-700">{item.conciseReason ?? item.basis ?? 'Als nicht geschäftsrelevant eingestuft.'}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {item.category ? <Badge tone="neutral">{CATEGORY_LABELS[item.category] ?? item.category}</Badge> : null}
                        {item.confidence ? <span>Sicherheit {Math.round(item.confidence.relevance * 100)} %</span> : null}
                        {item.execution ? <Badge tone={item.execution.mode === 'LIVE' ? 'info' : 'warning'}>{item.execution.mode === 'LIVE' ? `KI: ${item.execution.model ?? item.execution.provider}` : 'Simuliert'}</Badge> : <span>Regelbasiert</span>}
                        <span className="font-medium">Aktion: {item.action}</span>
                      </p>
                    </div>
                    <div className="shrink-0">
                      {item.reviewed ? (
                        <Badge tone="warning">Zur Prüfung vorgemerkt</Badge>
                      ) : (
                        <Button variant="secondary" disabled={review.isPending} onClick={() => review.mutate({ id: item.id })}>
                          Als geschäftsrelevant prüfen
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-500">Keine ausgeschlossenen Eingänge.</p>
            )}
            {review.isError ? (
              <p role="alert" className="m-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage(review.error, 'Die Korrektur konnte nicht gespeichert werden.')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
