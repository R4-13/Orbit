'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { ApiError } from '../../../../../lib/api-client';
import { formatAmount } from '../../../../../lib/format';
import {
  useAddBookingProposal,
  useApproveInvoice,
  useInvoice,
  useTransferInvoice,
} from '../../../../../lib/hooks/use-invoices';
import { statusLabel } from '../../../../../lib/status-labels';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: invoice, isLoading } = useInvoice(id);
  const addBookingProposal = useAddBookingProposal(id);
  const approveInvoice = useApproveInvoice(id);
  const transferInvoice = useTransferInvoice(id);

  const [accountCode, setAccountCode] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Wird geladen …</p>;
  }
  if (!invoice) {
    return <p className="text-sm text-slate-500">Rechnung nicht gefunden.</p>;
  }

  const status = statusLabel(invoice.status);

  function describeError(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    return 'Die Aktion konnte nicht ausgeführt werden.';
  }

  async function handleAddBookingProposal(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      await addBookingProposal.mutateAsync({
        accountCode,
        amount: Number(invoice!.amountGross ?? 0),
      });
      setAccountCode('');
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  async function handleApprove() {
    setActionError(null);
    try {
      await approveInvoice.mutateAsync();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  async function handleTransfer() {
    setActionError(null);
    try {
      await transferInvoice.mutateAsync();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {invoice.invoiceNumber ?? 'Rechnung ohne Nummer'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Betrag: {formatAmount(invoice.amountGross, invoice.currency)}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ausgelesene Daten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Netto</dt>
            <dd>{formatAmount(invoice.amountNet, invoice.currency)}</dd>
            <dt className="text-slate-500">USt.</dt>
            <dd>{formatAmount(invoice.vatAmount, invoice.currency)}</dd>
            <dt className="text-slate-500">Konfidenz der Texterkennung</dt>
            <dd>
              {invoice.confidenceScore !== null
                ? `${Math.round(invoice.confidenceScore * 100)} %`
                : '–'}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {invoice.status === 'PENDING_APPROVAL' ? (
        <Card>
          <CardHeader>
            <CardTitle>Buchungsvorschlag</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddBookingProposal} className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="accountCode">Sachkonto</Label>
                <Input
                  id="accountCode"
                  required
                  value={accountCode}
                  onChange={(event) => setAccountCode(event.target.value)}
                  placeholder="z. B. 4400"
                />
              </div>
              <Button type="submit" disabled={addBookingProposal.isPending}>
                Vorschlag speichern
              </Button>
            </form>
            <div className="mt-4">
              <Button onClick={handleApprove} disabled={approveInvoice.isPending} variant="secondary">
                Rechnung freigeben
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {invoice.status === 'APPROVED' ? (
        <Card>
          <CardContent>
            <p className="mb-3 text-sm text-slate-600">
              Die Rechnung ist freigegeben und kann an die Finanzbuchhaltung übertragen werden.
            </p>
            <Button onClick={handleTransfer} disabled={transferInvoice.isPending}>
              An Finanzbuchhaltung übertragen
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {invoice.status === 'DUPLICATE_SUSPECTED' ? (
        <Card>
          <CardContent className="text-sm text-amber-800">
            Diese Rechnung könnte eine Dublette einer bereits erfassten Rechnung sein. Bitte manuell
            prüfen.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
