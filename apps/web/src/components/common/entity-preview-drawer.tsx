'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { caseTabHref } from '@orbit/shared';
import { useApprovalDetail, useCaseSummary } from '../../lib/hooks/use-ui-projections';
import { useInvoice } from '../../lib/hooks/use-invoices';
import { formatAmount } from '../../lib/format';
import { statusLabel } from '../../lib/status-labels';
import { formatListTime } from '../../lib/home-format';
import { StatusBadge } from './primitives';
import { usePreview } from './preview-context';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{children}</dd>
    </div>
  );
}

function CasePreview({ id }: { id: string }) {
  const { data, isLoading, isError } = useCaseSummary(id);
  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) return <p className="text-sm text-red-700">Der Vorgang konnte nicht geladen werden oder Sie haben keinen Zugriff.</p>;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone={data.statusTone}>{data.statusLabel}</StatusBadge>
        <span className="text-xs text-slate-600">{data.typeLabel}</span>
      </div>
      <dl>
        {data.counterparty ? <Row label="Gegenüber">{data.counterparty.label}</Row> : null}
        <Row label="Nächster Schritt">{data.nextStep}</Row>
        {data.ownerLabel ? <Row label="Verantwortlich">{data.ownerLabel}</Row> : null}
        <Row label="Aktualisiert">{formatListTime(data.updatedAt)}</Row>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={data.href} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90">
          Vollständige Details
        </Link>
        {data.hasProcess ? (
          <Link href={caseTabHref(id, 'orchestration')} className="rounded-md border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Orchestrierung anzeigen
          </Link>
        ) : null}
      </div>
    </>
  );
}

function InvoicePreview({ id }: { id: string }) {
  const { data, isLoading, isError } = useInvoice(id);
  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) return <p className="text-sm text-red-700">Die Rechnung konnte nicht geladen werden oder Sie haben keinen Zugriff.</p>;
  const status = statusLabel(data.status);
  return (
    <>
      <div className="mb-2">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <dl>
        <Row label="Lieferant">{data.supplier?.name ?? 'Noch nicht zugeordnet'}</Row>
        <Row label="Rechnungsnummer">{data.invoiceNumber ?? '–'}</Row>
        <Row label="Betrag (brutto)">{formatAmount(data.amountGross, data.currency)}</Row>
      </dl>
      <div className="mt-4">
        <Link href={`/finance/invoices/${id}`} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90">
          Vollständige Details
        </Link>
      </div>
    </>
  );
}

function ApprovalPreview({ id }: { id: string }) {
  const { data, isLoading, isError } = useApprovalDetail(id);
  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) return <p className="text-sm text-red-700">Die Freigabe konnte nicht geladen werden oder Sie haben keinen Zugriff.</p>;
  return (
    <>
      <p className="mb-2 text-sm font-medium text-slate-900">{data.actionLabel}</p>
      <p className="mb-2 text-sm text-slate-700">{data.reason}</p>
      <dl>
        {data.fields.slice(0, 4).map((field) => (
          <Row key={field.label} label={field.label}>
            {field.value}
          </Row>
        ))}
      </dl>
      <div className="mt-4">
        <Link href={data.href} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90">
          Entscheidung öffnen
        </Link>
      </div>
    </>
  );
}

const TITLES: Record<string, string> = { CASE: 'Vorgang', INVOICE: 'Rechnung', APPROVAL: 'Freigabe' };

/**
 * Vorschau-Drawer (UI v2 §9.3): kurze Zusammenfassung, Status, nächste Aktion und „Vollständige Details“. Er öffnet als Overlay
 * über der Arbeitsfläche (nie als dritte Spalte neben Sonde), hat Fokusführung und Escape, und gibt den Fokus an den Auslöser zurück.
 */
export function EntityPreviewDrawer() {
  const { preview, closePreview } = usePreview();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const previewKey = preview ? `${preview.type}:${preview.id}` : null;

  useEffect(() => closePreview(), [pathname, closePreview]);

  useEffect(() => {
    if (!previewKey) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewKey, closePreview]);

  if (!preview) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" aria-hidden="true" onClick={closePreview} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Vorschau: ${preview.label}`}
        data-preview={preview.type}
        className="fixed bottom-0 right-0 top-14 z-50 flex w-[min(26rem,100vw)] flex-col border-l border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{TITLES[preview.type] ?? 'Objekt'}</p>
            <h2 className="truncate text-base font-semibold text-slate-900">{preview.label}</h2>
          </div>
          <button type="button" onClick={closePreview} aria-label="Vorschau schließen" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {preview.type === 'CASE' ? <CasePreview id={preview.id} /> : null}
          {preview.type === 'INVOICE' ? <InvoicePreview id={preview.id} /> : null}
          {preview.type === 'APPROVAL' ? <ApprovalPreview id={preview.id} /> : null}
        </div>
      </div>
    </>
  );
}
