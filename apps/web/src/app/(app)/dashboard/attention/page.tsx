'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ErrorState } from '@orbit/ui';
import { AttentionRow } from '../../../../components/home/home-cards';
import { errorMessage } from '../../../../lib/api-client';
import { useDashboardSnapshot } from '../../../../lib/hooks/use-dashboard-snapshot';
import { formatClock } from '../../../../lib/home-format';
import { useUiPreferences } from '../../../../lib/ui-preferences';

/**
 * Vollständige Liste der Aufmerksamkeit (UI v2 §6.5): Home zeigt nur die wichtigsten Einträge und verweist hierher. Es ist
 * dieselbe Projektion wie auf Home – nur mit größerer Vorschaugrenze –, damit Zähler und Einträge übereinstimmen.
 */
export default function AttentionPage() {
  const { preferences } = useUiPreferences();
  const query = useDashboardSnapshot({ view: preferences.home.view, period: preferences.home.period, limits: { attention: 50, inbox: 1, tasks: 1, completed: 1 } });
  const snapshot = query.data;
  const now = snapshot ? new Date(snapshot.generatedAt) : new Date();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
          <ArrowLeft size={14} aria-hidden="true" /> Zurück zu Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Benötigt Ihre Aufmerksamkeit</h1>
        <p className="mt-1 text-sm text-slate-600">
          {snapshot ? `${snapshot.attentionTotal} ${snapshot.attentionTotal === 1 ? 'Punkt' : 'Punkte'} · Stand ${formatClock(snapshot.generatedAt)}` : 'Wird geladen …'} · Sortiert nach Dringlichkeit
        </p>
      </div>
      {query.isError && !snapshot ? (
        <ErrorState message={errorMessage(query.error, 'Die Liste konnte nicht geladen werden.')} onRetry={() => void query.refetch()} />
      ) : snapshot && snapshot.attentionPreview.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Nichts wartet auf Sie.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {snapshot?.attentionPreview.map((item) => (
            <AttentionRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
