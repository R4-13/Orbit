'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, Mail } from 'lucide-react';
import type {
  AttentionItem,
  CompletedPreviewItem,
  DashboardMetric,
  DashboardPeriod,
  FinanceOverview,
  InboxPreviewItem,
  SalesOverview,
  TaskPreviewItem,
} from '@orbit/shared';
import { describeKpi, formatDue, formatListTime, formatMetricValue } from '../../lib/home-format';

/** Kartenrahmen der Home-Seite: 12 px Radius, 12–16 px Innenabstand, `min-h-0`, damit lange Daten das Grid nie aufziehen (SHELL-02). */
export function HomeCard({ title, titleId, action, children, className = '' }: { title: string; titleId: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={titleId} className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
        <h2 id={titleId} className="truncate text-[15px] font-semibold text-slate-900">
          {title}
        </h2>
        {action ? <div className="shrink-0 text-sm">{action}</div> : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function SeeAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
      {children}
    </Link>
  );
}

export function CardMessage({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={`px-3 pb-3 text-sm ${tone === 'error' ? 'text-red-700' : 'text-slate-600'}`}>
      {children}
    </p>
  );
}

export function SkeletonRows({ rows, rowHeight = 44 }: { rows: number; rowHeight?: number }) {
  return (
    <div aria-hidden="true" className="space-y-px px-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} style={{ height: rowHeight }} className="flex items-center">
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------------------------------------------------

export function KpiCard({ metric, period, isLoading }: { metric: DashboardMetric | undefined; period: DashboardPeriod; isLoading: boolean }) {
  const key = metric?.key ?? 'processed';
  const info = describeKpi(key, period);
  const unavailable = !isLoading && (!metric || metric.value === null);
  return (
    <Link
      href={info.href}
      title={info.definition}
      aria-label={`${info.label}: ${isLoading ? 'wird geladen' : unavailable ? 'noch nicht verfügbar' : formatMetricValue(metric)} (${info.basisLabel}). ${info.definition}`}
      className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    >
      <span className="truncate text-[13px] font-medium text-slate-700">{info.label}</span>
      {isLoading ? (
        <span aria-hidden="true" className="h-6 w-16 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      ) : (
        <span className="truncate text-2xl font-semibold leading-8 text-slate-900">{formatMetricValue(metric)}</span>
      )}
      <span className="truncate text-xs text-slate-600">{unavailable ? 'Noch nicht verfügbar' : info.basisLabel}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Aufmerksamkeit
// ---------------------------------------------------------------------------------------------------------------------

const PRIORITY_ICON = {
  CRITICAL: { Icon: AlertOctagon, className: 'text-red-600', label: 'Kritisch' },
  HIGH: { Icon: AlertTriangle, className: 'text-amber-600', label: 'Wichtig' },
  NORMAL: { Icon: CircleDot, className: 'text-blue-600', label: 'Offen' },
} as const;

export function AttentionRow({ item, now }: { item: AttentionItem; now: Date }) {
  const { Icon, className, label } = PRIORITY_ICON[item.priority];
  const action = item.availableActions[0];
  const href = action?.href ?? item.primaryEntity.href;
  const related = item.underlyingCount > 1 ? ` · ${item.underlyingCount} zugehörige Punkte` : '';
  return (
    <li className="flex h-[var(--home-row,44px)] items-center gap-2.5 px-3">
      <Icon size={18} className={`shrink-0 ${className}`} aria-label={label} role="img" />
      <div className="min-w-0 flex-1">
        {item.primaryEntity.href ? (
          <Link href={item.primaryEntity.href} className="block truncate text-sm font-medium leading-5 text-slate-900 hover:underline" title={item.title}>
            {item.title}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium leading-5 text-slate-900">{item.title}</span>
        )}
        <p className="truncate text-xs leading-4 text-slate-600" title={`${item.reason}${related}`}>
          {item.statusLabel}
          {item.dueAt ? ` · ${formatDue(item.dueAt, now)}` : ''} · {item.reason}
          {related}
        </p>
      </div>
      {href ? (
        <Link href={href} className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-[13px] font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          {action?.label ?? 'Prüfen'}
        </Link>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Posteingang
// ---------------------------------------------------------------------------------------------------------------------

export function InboxRow({ item, now }: { item: InboxPreviewItem; now: Date }) {
  const actionLabel = item.hasProcess ? 'Orchestrierung anzeigen' : item.caseRef ? 'Vorgang ansehen' : 'Entscheidung ansehen';
  const actionHref = item.caseRef?.href ?? item.href;
  return (
    <li className="flex h-[var(--home-row,44px)] items-center gap-2.5 px-3">
      <Mail size={16} className="shrink-0 text-slate-500" aria-label="E-Mail" role="img" />
      <Link href={item.href} className="min-w-0 flex-1" title={`${item.senderLabel} – ${item.subject}`}>
        <span className="block truncate text-[13px] leading-5 text-slate-700">
          <span className="font-medium text-slate-900">{item.senderLabel}</span> · {formatListTime(item.occurredAt, now)}
        </span>
        <span className="block truncate text-sm leading-5 text-slate-900">{item.subject}</span>
      </Link>
      <div className="flex w-[8.5rem] shrink-0 flex-col items-end">
        <span className="max-w-full truncate text-xs font-medium leading-5 text-slate-700">{item.statusLabel}</span>
        <Link href={actionHref} className="max-w-full truncate text-xs font-medium leading-5 text-brand hover:underline" aria-label={`${actionLabel}: ${item.subject}`}>
          {actionLabel}
        </Link>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Fachbereiche
// ---------------------------------------------------------------------------------------------------------------------

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xl font-semibold leading-8 text-slate-900">{new Intl.NumberFormat('de-DE').format(value)}</p>
      <p className="truncate text-xs text-slate-600">{label}</p>
    </div>
  );
}

export function FinanceBody({ data }: { data: FinanceOverview }) {
  return (
    <div className="px-3 pb-2">
      <div className="grid grid-cols-3 gap-3">
        <Metric value={data.toReview} label="Zu prüfen" />
        <Metric value={data.approvalOpen} label="Freigabe offen" />
        <Metric value={data.transferred} label="Zur Buchhaltung übertragen" />
      </div>
      {data.hint ? (
        <p className="mt-1 truncate text-[13px] text-amber-800">
          <AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />
          <Link href={data.hint.entity.href ?? '/finance/invoices'} className="font-medium hover:underline">
            {data.hint.text}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function SalesBody({ data }: { data: SalesOverview }) {
  return (
    <div className="px-3 pb-2">
      <div className="grid grid-cols-3 gap-3">
        <Metric value={data.newInquiries} label="Neue Anfragen" />
        <Metric value={data.replyOpen} label="Rückmeldungen offen" />
        <Metric value={data.dueToday} label="Heute fällige Schritte" />
      </div>
      {data.hint ? (
        <p className="mt-1 truncate text-[13px] text-slate-700">
          <Link href={data.hint.entity.href ?? '/sales/leads'} className="font-medium text-brand hover:underline">
            {data.hint.text}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Abschlusszeile
// ---------------------------------------------------------------------------------------------------------------------

export function TaskLine({ task, now }: { task: TaskPreviewItem; now: Date }) {
  return (
    <li className="flex h-6 items-center gap-2 px-3 text-[13px]">
      <Link href={task.href} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:underline" title={task.title}>
        {task.title}
      </Link>
      {task.dueAt ? <span className={`shrink-0 text-xs ${task.overdue ? 'font-medium text-red-700' : 'text-slate-600'}`}>{formatDue(task.dueAt, now)}</span> : null}
      {task.relatedCase?.href ? (
        <Link href={task.relatedCase.href} className="hidden max-w-[40%] shrink-0 truncate text-xs text-brand hover:underline xl:block" title={task.relatedCase.label}>
          {task.relatedCase.label}
        </Link>
      ) : null}
    </li>
  );
}

export function CompletedLine({ item, now }: { item: CompletedPreviewItem; now: Date }) {
  return (
    <li className="flex h-6 items-center gap-2 px-3 text-[13px]">
      <CheckCircle2 size={14} className="shrink-0 text-emerald-600" aria-label="Erledigt" role="img" />
      {item.entity?.href ? (
        <Link href={item.entity.href} className="min-w-0 flex-1 truncate text-slate-900 hover:underline" title={item.title}>
          {item.title}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-slate-900">{item.title}</span>
      )}
      <span className="shrink-0 text-xs text-slate-600">{formatListTime(item.at, now)}</span>
    </li>
  );
}
