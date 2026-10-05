'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, Circle, Clock, Eye, Info, Lock, SearchX } from 'lucide-react';
import type { EntityRef } from '@orbit/shared';
import { formatClock } from '../../lib/home-format';
import { usePreview } from './preview-context';

// ---------------------------------------------------------------------------------------------------------------------
// PageHeader – Titel, kurzer Zweck, höchstens drei Kennzahlen, Aktionen (UI v2 §10)
// ---------------------------------------------------------------------------------------------------------------------

export interface PageStat {
  label: string;
  value: string | number;
  href?: string;
}

export function PageHeader({ title, description, stats, actions, children }: { title: string; description?: string; stats?: PageStat[]; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-8 text-slate-900">{title}</h1>
          {description ? <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {stats && stats.length > 0 ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-2" aria-label="Kennzahlen">
          {stats.slice(0, 3).map((stat) => (
            <div key={stat.label} className="min-w-[6rem]">
              <dd className="text-xl font-semibold leading-7 text-slate-900">
                {stat.href ? (
                  <Link href={stat.href} className="hover:underline">
                    {stat.value}
                  </Link>
                ) : (
                  stat.value
                )}
              </dd>
              <dt className="text-xs text-slate-600">{stat.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </header>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Statusanzeige: Farbe nie allein – immer Symbol + Text (UI v2 §21.3, §25)
// ---------------------------------------------------------------------------------------------------------------------

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const TONE_STYLE: Record<StatusTone, { className: string; Icon: typeof Circle }> = {
  neutral: { className: 'bg-slate-100 text-slate-800', Icon: Circle },
  info: { className: 'bg-blue-50 text-blue-800', Icon: Clock },
  warning: { className: 'bg-amber-50 text-amber-900', Icon: AlertTriangle },
  success: { className: 'bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  danger: { className: 'bg-red-50 text-red-800', Icon: AlertOctagon },
};

export function StatusBadge({ tone = 'neutral', children, title }: { tone?: StatusTone; children: ReactNode; title?: string }) {
  const { className, Icon } = TONE_STYLE[tone];
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      <Icon size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Test-/Simulationsevidenz am betroffenen Objekt (UI v2 §23): kein versteckter globaler Modusbadge. */
export function ExecutionModeBadge({ mode }: { mode: 'LIVE' | 'SIMULATED' | 'TEST' }) {
  if (mode === 'LIVE') return <StatusBadge tone="success">Live</StatusBadge>;
  return <StatusBadge tone="warning">{mode === 'TEST' ? 'Testbetrieb' : 'Simuliert'}</StatusBadge>;
}

// ---------------------------------------------------------------------------------------------------------------------
// EntityLink – einheitlicher Objektlink mit getrennter Vorschau (UI v2 §9)
// ---------------------------------------------------------------------------------------------------------------------

const PREVIEWABLE = new Set(['CASE', 'INVOICE', 'APPROVAL']);

export function EntityLink({ entity, className = '', withPreview = true }: { entity: EntityRef; className?: string; withPreview?: boolean }) {
  const { openPreview } = usePreview();
  const canPreview = withPreview && PREVIEWABLE.has(entity.type);
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1 ${className}`}>
      {entity.href ? (
        <Link href={entity.href} className="min-w-0 truncate font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" title={entity.label}>
          {entity.label}
        </Link>
      ) : (
        <span className="min-w-0 truncate" title={entity.label}>
          {entity.label}
        </span>
      )}
      {canPreview ? (
        <button
          type="button"
          onClick={() => openPreview(entity)}
          aria-label={`Vorschau: ${entity.label}`}
          title="Vorschau"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <Eye size={15} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Zustände
// ---------------------------------------------------------------------------------------------------------------------

export function LastUpdated({ at, fetching = false }: { at?: string | Date | null; fetching?: boolean }) {
  if (!at) return null;
  return (
    <span className="text-xs text-slate-600" role="status">
      Stand {formatClock(at)}
      {fetching ? ' – wird aktualisiert' : ''}
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-hidden="true">
        <SearchX size={20} />
      </span>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {children ? <p className="max-w-md text-sm text-slate-600">{children}</p> : null}
      {action}
    </div>
  );
}

/** Sichere, neutrale Meldung ohne Detailleak (UI v2 §24 „Zugriff fehlt“). */
export function PermissionState({ children }: { children?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <Lock size={18} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
      <p>{children ?? 'Für diese Ansicht fehlt Ihnen die Berechtigung. Wenden Sie sich bei Bedarf an Ihre Administration.'}</p>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const style = { info: 'border-blue-200 bg-blue-50 text-blue-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', danger: 'border-red-200 bg-red-50 text-red-900' }[tone];
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${style}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// FilterTabs – Filter als sichtbare, zurücksetzbare Schalter mit ehrlichem Zähler
// ---------------------------------------------------------------------------------------------------------------------

export function FilterTabs<T extends string>({ items, value, onChange, label }: { items: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              active ? 'border-brand bg-brand/10 text-brand' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {item.label}
            {item.count !== undefined ? <span className={`rounded-full px-1.5 text-xs ${active ? 'bg-brand/15' : 'bg-slate-100 text-slate-700'}`}>{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <div className="w-full max-w-xs">
      <label className="sr-only" htmlFor={`search-${label}`}>
        {label}
      </label>
      <input
        id={`search-${label}`}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Seiten" className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2.5 text-sm text-slate-700">
      <span>
        Seite {page} von {pages} · {total} Einträge
      </span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="h-9 rounded-md border border-slate-300 bg-white px-3 font-medium hover:bg-slate-50 disabled:opacity-50">
          Zurück
        </button>
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="h-9 rounded-md border border-slate-300 bg-white px-3 font-medium hover:bg-slate-50 disabled:opacity-50">
          Weiter
        </button>
      </div>
    </nav>
  );
}

/** Verknüpfte Objekte einer Detailseite (UI v2 LINK-02): kompakt, mit Zähler, keine seitenlange Beziehungskarte. */
export function RelatedObjects({ title = 'Verknüpft', items }: { title?: string; items: Array<{ label: string; entity?: EntityRef; text?: string }> }) {
  const visible = items.filter((item) => item.entity || item.text);
  if (visible.length === 0) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold text-slate-900">
        {title} <span className="text-sm font-normal text-slate-600">({visible.length})</span>
      </h2>
      <ul className="mt-2 divide-y divide-slate-100">
        {visible.map((item) => (
          <li key={`${item.label}-${item.entity?.id ?? item.text}`} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-32 shrink-0 text-slate-600">{item.label}</span>
            {item.entity ? <EntityLink entity={item.entity} /> : <span className="text-slate-900">{item.text}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
