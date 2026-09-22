'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { CaseType } from '@orbit/domain';
import { Badge, Card } from '@orbit/ui';
import { formatDateTime } from '../../../lib/format';
import { useCases } from '../../../lib/hooks/use-cases';
import { caseTypeLabel, statusLabel } from '../../../lib/status-labels';

const TYPE_TABS: { value: CaseType | null; label: string }[] = [
  { value: null, label: 'Alle' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'SALES', label: 'Sales' },
];

export default function CasesPage() {
  const typeFilter = useSearchParams().get('type') as CaseType | null;
  const { data: cases, isLoading } = useCases({ type: typeFilter ?? undefined });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Vorgänge</h1>
      <p className="mt-1 text-sm text-slate-500">
        Jeder eingehende Finance- oder Sales-Vorgang, von Anfang bis Ende nachvollziehbar.
      </p>

      <div className="mt-4 flex gap-2">
        {TYPE_TABS.map((tab) => {
          const href = tab.value ? `/cases?type=${tab.value}` : '/cases';
          const active = (typeFilter ?? null) === tab.value;
          return (
            <Link
              key={tab.label}
              href={href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active ? 'bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Card className="mt-4 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Titel</th>
              <th className="px-4 py-3 font-medium">Typ</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Erstellt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={4}>
                  Wird geladen …
                </td>
              </tr>
            ) : cases && cases.length > 0 ? (
              cases.map((c) => {
                const status = statusLabel(c.status);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/cases/${c.id}`} className="font-medium text-brand hover:underline">
                        {c.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{caseTypeLabel(c.type)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(c.createdAt)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={4}>
                  Keine Vorgänge gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
