'use client';

import Link from 'next/link';
import { Card, CardContent } from '@orbit/ui';
import { useAuth } from '../../../lib/auth-context';
import { useApprovals } from '../../../lib/hooks/use-approvals';
import { useInvoices } from '../../../lib/hooks/use-invoices';
import { useTasks } from '../../../lib/hooks/use-tasks';

function StatCard({ href, label, value, isLoading }: { href: string; label: string; value: number; isLoading: boolean }) {
  return (
    <Link href={href}>
      <Card className="transition hover:border-brand hover:shadow-md">
        <CardContent>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{isLoading ? '–' : value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const openTasks = useTasks('OPEN');
  const pendingInvoices = useInvoices('PENDING_APPROVAL');
  const pendingApprovals = useApprovals('PENDING');

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Übersicht</h1>
      <p className="mt-1 text-sm text-slate-500">
        Willkommen zurück{user ? `, ${user.email}` : ''}. Hier sehen Sie, was gerade auf Sie wartet.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          href="/tasks"
          label="Offene Aufgaben"
          value={openTasks.data?.length ?? 0}
          isLoading={openTasks.isLoading}
        />
        <StatCard
          href="/finance/invoices?status=PENDING_APPROVAL"
          label="Rechnungen mit Freigabe erforderlich"
          value={pendingInvoices.data?.length ?? 0}
          isLoading={pendingInvoices.isLoading}
        />
        <StatCard
          href="/approvals"
          label="Ausstehende Freigaben"
          value={pendingApprovals.data?.length ?? 0}
          isLoading={pendingApprovals.isLoading}
        />
      </div>
    </div>
  );
}
