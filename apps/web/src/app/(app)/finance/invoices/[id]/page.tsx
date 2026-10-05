'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { PERMISSIONS, internalHref } from '@orbit/shared';
import { Button, ErrorState, Input, Label } from '@orbit/ui';
import { EntityLink, LastUpdated, Notice, PageHeader, RelatedObjects, StatusBadge } from '../../../../../components/common/primitives';
import { ApiError, apiFetch, errorMessage } from '../../../../../lib/api-client';
import { useAuth } from '../../../../../lib/auth-context';
import { formatAmount, formatDateTime } from '../../../../../lib/format';
import { useElementSize } from '../../../../../lib/hooks/use-element-size';
import { useAddBookingProposal, useApproveInvoice, useConfirmBankChange, useInvoice, useRejectInvoice, useTransferInvoice } from '../../../../../lib/hooks/use-invoices';
import { invoiceNextAction } from '../../../../../lib/invoice-view';
import { statusLabel } from '../../../../../lib/status-labels';

const day = (value: Date | string | null | undefined) => (value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(value)) : '–');

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 text-sm text-slate-800">{children}</div>
    </section>
  );
}

function Fields({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-600">{label}</dt>
          <dd className="min-w-0 break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Beleg: Metadaten, „Öffnen“ und – bei PDF/Bild – eine eingebettete Ansicht. Kein winziger Viewer: bei wenig Platz eigener Tab. */
function Receipt({ document }: { document: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (!document) return <p className="text-sm text-slate-600">Zu dieser Rechnung ist kein Beleg gespeichert.</p>;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ url: string }>(`/v1/documents/${document!.id}/download-url`);
      setUrl(result.url);
    } catch (err) {
      setError(errorMessage(err, 'Der Beleg konnte nicht geladen werden.'));
    } finally {
      setLoading(false);
    }
  }
  const inline = document.mimeType === 'application/pdf' || document.mimeType.startsWith('image/');
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium text-slate-900">{document.fileName}</span> <span className="text-slate-600">· {(document.sizeBytes / 1024).toFixed(1)} KB</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {url ? 'Beleg neu laden' : 'Beleg anzeigen'}
        </Button>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 px-3.5 text-sm font-medium text-slate-900 hover:bg-slate-50">
            <ExternalLink size={14} aria-hidden="true" /> In neuem Tab öffnen
          </a>
        ) : null}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {url && inline ? (
        document.mimeType === 'application/pdf' ? (
          <iframe src={url} title={`Beleg: ${document.fileName}`} className="h-[32rem] w-full rounded-lg border border-slate-200" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- kurzlebige, signierte Beleg-URL
          <img src={url} alt={`Beleg: ${document.fileName}`} className="max-h-[32rem] w-full rounded-lg border border-slate-200 object-contain" />
        )
      ) : null}
    </div>
  );
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { data: invoice, isLoading, isError, error, refetch, dataUpdatedAt } = useInvoice(id);
  const addBookingProposal = useAddBookingProposal(id);
  const approveInvoice = useApproveInvoice(id);
  const transferInvoice = useTransferInvoice(id);
  const rejectInvoice = useRejectInvoice(id);
  const confirmBankChange = useConfirmBankChange(id);
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const [tab, setTab] = useState<'receipt' | 'data'>('data');
  const [accountCode, setAccountCode] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const back = (
    <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <ArrowLeft size={14} aria-hidden="true" /> Zurück zu den Rechnungen
    </button>
  );

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !invoice) {
    return (
      <div className="space-y-3">
        {back}
        <ErrorState message={errorMessage(error, 'Die Rechnung konnte nicht geladen werden – sie existiert nicht mehr oder Sie haben keinen Zugriff.')} onRetry={() => void refetch()} />
        <Link href="/finance/invoices" className="text-sm font-medium text-brand hover:underline">
          Zur Liste
        </Link>
      </div>
    );
  }

  const status = statusLabel(invoice.status);
  const supplierName = invoice.supplier?.name ?? 'Lieferant noch nicht zugeordnet';
  const wide = size.width >= 1000;
  const proposal = invoice.bookingProposals[0];
  const transfer = invoice.financeTransfers[0];
  const newIban = (invoice.extractedData as { supplierIban?: string } | null)?.supplierIban;
  const canApprove = hasPermission(PERMISSIONS.INVOICE_APPROVE);
  const canBook = hasPermission(PERMISSIONS.BOOKING_CREATE);
  const canTransfer = hasPermission(PERMISSIONS.INVOICE_TRANSFER);

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Die Aktion konnte nicht ausgeführt werden.');
    }
  }

  async function handleAddBookingProposal(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await addBookingProposal.mutateAsync({ accountCode, amount: Number(invoice!.amountGross ?? 0) });
      setAccountCode('');
    });
  }

  const dataPanels = (
    <div className="space-y-4">
      <Panel title="Wichtigste Angaben">
        <Fields
          rows={[
            ['Lieferant', invoice.supplier ? <EntityLink key="s" entity={{ type: 'SUPPLIER', id: invoice.supplier.id, label: invoice.supplier.name, href: '/finance/suppliers' }} withPreview={false} /> : 'Noch nicht zugeordnet'],
            ['Rechnungsnummer', invoice.invoiceNumber ?? '–'],
            ['Betrag (brutto)', formatAmount(invoice.amountGross, invoice.currency)],
            ['Rechnungsdatum', day(invoice.invoiceDate)],
            ['Fällig am', day(invoice.dueDate)],
            ['Prüfergebnis', <StatusBadge key="st" tone={status.tone}>{status.label}</StatusBadge>],
            ['Erforderlich', invoiceNextAction(invoice.status)],
            ['Buchungsvorschlag', proposal ? `Konto ${proposal.accountCode}${proposal.costCenter ? ` · Kostenstelle ${proposal.costCenter}` : ''}` : 'Noch keiner'],
            ['Übertragung', transfer ? (transfer.status === 'COMPLETED' ? `Zur Buchhaltung übertragen am ${day(transfer.completedAt)}` : transfer.status === 'FAILED' ? `Fehlgeschlagen: ${transfer.errorMessage ?? 'unbekannter Fehler'}` : 'Läuft') : 'Noch nicht übertragen'],
          ]}
        />
      </Panel>

      {invoice.status === 'PENDING_APPROVAL' && (canBook || canApprove) ? (
        <Panel title="Prüfen und freigeben">
          {canBook ? (
            <form onSubmit={handleAddBookingProposal} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <Label htmlFor="accountCode">Sachkonto</Label>
                <Input id="accountCode" required value={accountCode} onChange={(event) => setAccountCode(event.target.value)} placeholder="z. B. 4400" />
              </div>
              <Button type="submit" disabled={addBookingProposal.isPending}>
                Buchungsvorschlag speichern
              </Button>
            </form>
          ) : null}
          {canApprove ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void run(() => approveInvoice.mutateAsync())} disabled={approveInvoice.isPending} variant="secondary">
                Rechnung freigeben
              </Button>
              <Button onClick={() => void run(() => rejectInvoice.mutateAsync())} disabled={rejectInvoice.isPending} variant="ghost">
                Ablehnen
              </Button>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {invoice.status === 'APPROVED' && canTransfer ? (
        <Panel title="Zur Buchhaltung übertragen">
          <p className="mb-3 text-slate-700">Die Rechnung ist freigegeben. „Übertragen“ heißt nicht „bezahlt“: ORBIT löst keine Zahlung aus.</p>
          <Button onClick={() => void run(() => transferInvoice.mutateAsync())} disabled={transferInvoice.isPending}>
            Zur Buchhaltung übertragen
          </Button>
        </Panel>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-[15px] font-semibold text-slate-900">Weitere Angaben und Nachweise</summary>
        <div className="mt-3 space-y-3 text-sm">
          <Fields
            rows={[
              ['Netto', formatAmount(invoice.amountNet, invoice.currency)],
              ['Umsatzsteuer', formatAmount(invoice.vatAmount, invoice.currency)],
              ['Hinterlegte Bankverbindung', invoice.supplier?.iban ?? '–'],
              ['Bankverbindung laut Rechnung', newIban ?? '–'],
              ['Sicherheit der Auslesung', invoice.confidenceScore !== null ? `${Math.round(invoice.confidenceScore * 100)} %` : '–'],
              ['Erfasst am', formatDateTime(invoice.createdAt)],
            ]}
          />
          {invoice.duplicateOfInvoiceId ? (
            <p>
              Mögliche Dublette von{' '}
              <Link href={`/finance/invoices/${invoice.duplicateOfInvoiceId}`} className="font-medium text-brand hover:underline">
                Rechnung ansehen
              </Link>
              .
            </p>
          ) : null}
        </div>
      </details>

      <RelatedObjects
        items={[
          { label: 'Lieferant', entity: invoice.supplier ? { type: 'SUPPLIER', id: invoice.supplier.id, label: invoice.supplier.name, href: '/finance/suppliers' } : undefined },
          { label: 'Vorgang', entity: invoice.case ? { type: 'CASE', id: invoice.case.id, label: invoice.case.title, href: internalHref('CASE', invoice.case.id) } : undefined },
          { label: 'Beleg', text: invoice.document?.fileName },
        ]}
      />
    </div>
  );

  return (
    <div className="space-y-4" ref={measureRef}>
      {back}
      <PageHeader title={`${supplierName}${invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ''}`} description={`Betrag ${formatAmount(invoice.amountGross, invoice.currency)} · fällig ${day(invoice.dueDate)}`}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <span className="text-sm text-slate-800">Nächster Schritt: {invoiceNextAction(invoice.status)}</span>
          <LastUpdated at={new Date(dataUpdatedAt).toISOString()} />
        </div>
      </PageHeader>

      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

      {/* Kritische Risiken stehen oben und werden nie eingeklappt (UI v2 §12.2). */}
      {invoice.status === 'BANK_CHANGE_SUSPECTED' ? (
        <section aria-label="Bankverbindung geändert" className="rounded-xl border border-red-300 bg-red-50 p-4">
          <h2 className="text-[15px] font-semibold text-red-900">Achtung: Die Bankverbindung hat sich geändert</h2>
          <p className="mt-1 text-sm text-red-900">Die Bankverbindung auf dieser Rechnung weicht von der hinterlegten ab – ein typisches Muster bei Rechnungsbetrug. Bitte die neue IBAN telefonisch unter einer bekannten Nummer beim Lieferanten bestätigen, bevor Sie fortfahren.</p>
          <dl className="mt-3 grid grid-cols-[14rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-red-900">Bisher hinterlegte IBAN</dt>
            <dd className="break-all font-mono text-red-950">{invoice.supplier?.iban ?? '–'}</dd>
            <dt className="text-red-900">Neue IBAN auf der Rechnung</dt>
            <dd className="break-all font-mono font-semibold text-red-950">{newIban ?? '–'}</dd>
          </dl>
          {canApprove ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void run(() => confirmBankChange.mutateAsync())} disabled={confirmBankChange.isPending} variant="secondary">
                Neue IBAN bestätigen und fortfahren
              </Button>
              <Button onClick={() => void run(() => rejectInvoice.mutateAsync())} disabled={rejectInvoice.isPending} variant="ghost">
                Rechnung ablehnen
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-red-900">Die Bestätigung kann nur eine Person mit Freigaberecht vornehmen.</p>
          )}
        </section>
      ) : null}
      {invoice.status === 'DUPLICATE_SUSPECTED' ? <Notice tone="warning">Diese Rechnung könnte eine Dublette einer bereits erfassten Rechnung sein. Bitte prüfen, bevor sie weiterbearbeitet wird.</Notice> : null}
      {invoice.status === 'TRANSFER_FAILED' ? <Notice tone="danger">Die Übertragung zur Buchhaltung ist fehlgeschlagen{transfer?.errorMessage ? `: ${transfer.errorMessage}` : '.'}</Notice> : null}

      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <Panel title="Beleg">
            <Receipt document={invoice.document} />
          </Panel>
          {dataPanels}
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Rechnungsansicht" className="flex gap-1 border-b border-slate-200">
            {(['data', 'receipt'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`-mb-px h-11 border-b-2 px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${tab === value ? 'border-brand text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              >
                {value === 'data' ? 'Daten' : 'Beleg'}
              </button>
            ))}
          </div>
          {tab === 'data' ? dataPanels : <Panel title="Beleg"><Receipt document={invoice.document} /></Panel>}
        </>
      )}
    </div>
  );
}
