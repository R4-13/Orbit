'use client';

import { useState } from 'react';
import type { RetentionCategory } from '@orbit/domain';
import { Badge, Button, Card, ErrorState, Input } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import {
  useApplyRetention,
  useRetentionPolicies,
  useRetentionPreview,
  useUpdateRetentionPolicy,
} from '../../../../lib/hooks/use-retention-policies';

const CATEGORY_LABELS: Record<RetentionCategory, string> = {
  AGENT_RUNS: 'Agent-Läufe',
  TOOL_INVOCATIONS: 'Tool-Aufrufe',
};

const CATEGORIES: RetentionCategory[] = ['AGENT_RUNS', 'TOOL_INVOCATIONS'];

/** Matches MIN_RETENTION_DAYS in apps/api/src/retention/retention.constants.ts — the backend is the source of truth and re-validates regardless. */
const MIN_RETENTION_DAYS = 30;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('de-DE');
}

function CategoryRow({ category, currentDays }: { category: RetentionCategory; currentDays: number | null }) {
  const [draftDays, setDraftDays] = useState(String(currentDays ?? 90));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const updatePolicy = useUpdateRetentionPolicy();
  const applyRetention = useApplyRetention();
  const preview = useRetentionPreview(category);

  const isBusy = updatePolicy.isPending || applyRetention.isPending || preview.isFetching;

  return (
    <tr className="align-top hover:bg-slate-50">
      <td className="px-4 py-3">
        <span className="font-medium text-slate-900">{CATEGORY_LABELS[category]}</span>
      </td>
      <td className="px-4 py-3">
        {currentDays !== null ? <Badge tone="info">{currentDays} Tage</Badge> : <Badge tone="neutral">Unbegrenzt</Badge>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            aria-label={`Aufbewahrung in Tagen: ${CATEGORY_LABELS[category]}`}
            min={MIN_RETENTION_DAYS}
            className="w-24"
            value={draftDays}
            disabled={isBusy}
            onChange={(event) => setDraftDays(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              setSaveError(null);
              updatePolicy.mutate(
                { category, retentionDays: Number(draftDays) },
                { onError: (err) => setSaveError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.') },
              );
            }}
          >
            Speichern
          </Button>
        </div>
        {saveError ? <p className="mt-1 text-xs text-red-600">{saveError}</p> : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            disabled={currentDays === null || isBusy}
            onClick={() => {
              setConfirming(false);
              void preview.refetch();
            }}
          >
            Vorschau
          </Button>

          {preview.isError ? (
            <p className="text-xs text-red-600">
              {preview.error instanceof ApiError ? preview.error.message : 'Vorschau fehlgeschlagen.'}
            </p>
          ) : preview.data ? (
            <p className="text-xs text-slate-600">
              {preview.data.matchingCount === 0
                ? 'Keine Datensätze zur Löschung fällig.'
                : `${preview.data.matchingCount} Datensätze fällig (${formatDate(preview.data.oldestMatchingAt)} – ${formatDate(preview.data.newestMatchingAt)}).`}
            </p>
          ) : null}

          {preview.data && preview.data.matchingCount > 0 ? (
            confirming ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  disabled={isBusy}
                  onClick={() => {
                    applyRetention.mutate(category, {
                      onSuccess: () => {
                        setConfirming(false);
                        void preview.refetch();
                      },
                    });
                  }}
                >
                  Endgültig löschen
                </Button>
                <Button variant="ghost" disabled={isBusy} onClick={() => setConfirming(false)}>
                  Abbrechen
                </Button>
              </div>
            ) : (
              <Button variant="danger" disabled={isBusy} onClick={() => setConfirming(true)}>
                Anwenden
              </Button>
            )
          ) : null}

          {applyRetention.isError ? (
            <p className="text-xs text-red-600">
              {applyRetention.error instanceof ApiError ? applyRetention.error.message : 'Anwenden fehlgeschlagen.'}
            </p>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default function AdminRetentionPage() {
  const { data: policies, isLoading, isError, error, refetch } = useRetentionPolicies();
  const policyByCategory = new Map((policies ?? []).map((p) => [p.category, p.retentionDays]));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Datenaufbewahrung</h1>
      <p className="mt-1 text-sm text-slate-600">
        Legt fest, wie lange Agent-Lauf- und Tool-Aufruf-Historie aufbewahrt wird. Ohne konfigurierte Regel
        wird nichts gelöscht. Eine Vorschau zeigt vor dem Löschen, wie viele Datensätze betroffen wären — das
        Löschen selbst muss danach explizit bestätigt werden und läuft nie automatisch.
      </p>

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(error, 'Die Aufbewahrungsregeln konnten nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Kategorie</th>
              <th className="px-4 py-3 font-medium">Aktuelle Regel</th>
              <th className="px-4 py-3 font-medium">Aufbewahrungsdauer (Tage)</th>
              <th className="px-4 py-3 font-medium">Löschen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={4}>
                  Wird geladen …
                </td>
              </tr>
            ) : (
              CATEGORIES.map((category) => (
                <CategoryRow key={category} category={category} currentDays={policyByCategory.get(category) ?? null} />
              ))
            )}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}
