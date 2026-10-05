import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError } from '@orbit/shared';
import { Prisma, type BookingProposal, type FinanceTransfer, type Invoice, type Supplier } from '@orbit/domain';
import type { FinanceConnector, OcrProvider } from '@orbit/integration-core';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService, type AuditActorType } from '../audit/audit.service';
import { FINANCE_CONNECTOR, OCR_PROVIDER } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SuppliersService } from '../suppliers/suppliers.service';

export interface CreateInvoiceFromDocumentInput {
  documentId: string;
  caseId?: string;
}

export interface AddBookingProposalInput {
  accountCode: string;
  costCenter?: string;
  description?: string;
  amount: number;
}

/** IBAN comparison ignores spaces/case — "DE12 3456" and "de123456" are the same account. */
export type InvoiceDetailRecord = Invoice & {
  supplier: Supplier | null;
  document: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
  case: { id: string; title: string } | null;
  bookingProposals: BookingProposal[];
  financeTransfers: FinanceTransfer[];
};

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Finance-workflow core: document -> OCR extraction -> duplicate check ->
 * supplier match/create -> booking proposal -> human approval -> FiBu
 * transfer. Every step here is a direct, RBAC-gated human/API action
 * (INVOICE_APPROVE / INVOICE_TRANSFER permissions) rather than something
 * routed through the Policy Engine — that governs *agent* autonomy
 * (@orbit/agent-core), not a human who already has the permission to
 * approve/transfer. See docs/ASSUMPTIONS.md for the full reasoning.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly suppliers: SuppliersService,
    private readonly approvals: ApprovalsService,
    @Inject(FINANCE_CONNECTOR) private readonly financeConnector: FinanceConnector,
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
  ) {}

  async createFromDocument(
    tenantId: string,
    actorUserId: string | undefined,
    input: CreateInvoiceFromDocumentInput,
    actorType: AuditActorType = 'USER',
  ): Promise<Invoice> {
    const document = await this.prisma.forTenantId(tenantId).document.findUnique({
      where: { id: input.documentId },
    });
    if (!document) {
      throw new NotFoundError('Document not found.', { id: input.documentId });
    }

    const bytes = await this.storage.getObjectBytes(document.storageKey);
    const extracted = await this.ocrProvider.extractInvoiceData(bytes, document.mimeType);

    const duplicate =
      extracted.invoiceNumber && extracted.amountGross !== undefined
        ? await this.prisma.forTenantId(tenantId).invoice.findFirst({
            where: { invoiceNumber: extracted.invoiceNumber, amountGross: extracted.amountGross },
          })
        : null;

    let supplierId: string | undefined;
    let bankChange: { previousIban: string; newIban: string } | undefined;
    if (!duplicate && extracted.supplierName) {
      const { supplier } = await this.suppliers.findOrCreate(
        tenantId,
        actorUserId,
        { name: extracted.supplierName, taxId: extracted.supplierTaxId },
        actorType,
      );
      supplierId = supplier.id;

      // §59 Szenario C: an IBAN on the invoice that differs from the one
      // already on file for this supplier is a classic fraud pattern
      // (compromised supplier email announcing "new bank details") — a
      // brand-new supplier (no prior IBAN) is not a "change".
      if (supplier.iban && extracted.supplierIban && normalizeIban(supplier.iban) !== normalizeIban(extracted.supplierIban)) {
        bankChange = { previousIban: supplier.iban, newIban: extracted.supplierIban };
      }
    }

    const status = duplicate ? 'DUPLICATE_SUSPECTED' : bankChange ? 'BANK_CHANGE_SUSPECTED' : 'PENDING_APPROVAL';

    const invoice = await this.prisma.forTenantId(tenantId).invoice.create({
      data: {
        tenantId,
        caseId: input.caseId,
        documentId: document.id,
        supplierId,
        invoiceNumber: extracted.invoiceNumber,
        invoiceDate: extracted.invoiceDate ? new Date(extracted.invoiceDate) : undefined,
        dueDate: extracted.dueDate ? new Date(extracted.dueDate) : undefined,
        amountNet: extracted.amountNet,
        amountGross: extracted.amountGross,
        vatAmount: extracted.vatAmount,
        vatRate: extracted.vatRate,
        currency: extracted.currency ?? 'EUR',
        confidenceScore: extracted.confidenceScore,
        extractedData: extracted as unknown as Prisma.InputJsonValue,
        status,
        duplicateOfInvoiceId: duplicate?.id,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'DOCUMENT_PARSED',
      actorType,
      actorUserId,
      entityType: 'Invoice',
      entityId: invoice.id,
      payload: { confidenceScore: extracted.confidenceScore },
    });
    await this.audit.record({
      tenantId,
      eventType: 'INVOICE_CREATED',
      actorType,
      actorUserId,
      entityType: 'Invoice',
      entityId: invoice.id,
    });

    if (duplicate) {
      await this.audit.record({
        tenantId,
        eventType: 'DUPLICATE_INVOICE_DETECTED',
        actorType,
        actorUserId,
        entityType: 'Invoice',
        entityId: invoice.id,
        payload: { duplicateOfInvoiceId: duplicate.id },
      });
    } else if (bankChange) {
      await this.audit.record({
        tenantId,
        eventType: 'SUPPLIER_BANK_DETAILS_CHANGED',
        actorType,
        actorUserId,
        entityType: 'Invoice',
        entityId: invoice.id,
        payload: { supplierId, previousIban: bankChange.previousIban, newIban: bankChange.newIban },
      });
      await this.approvals.create(tenantId, {
        entityType: 'INVOICE',
        entityId: invoice.id,
        policyAction: 'invoice.bank_change_review',
        requestedByUserId: actorUserId,
        reason: `Achtung: Die Bankverbindung des Lieferanten hat sich geändert (bisher ${bankChange.previousIban}, neu ${bankChange.newIban}). Bitte vor Weiterbearbeitung prüfen.`,
      });
    } else {
      // §37: an invoice awaiting a booking proposal + approval belongs in
      // the central Approval Center, same as pending suppliers.
      await this.approvals.create(tenantId, {
        entityType: 'INVOICE',
        entityId: invoice.id,
        policyAction: 'invoice.approve',
        requestedByUserId: actorUserId,
        reason: invoice.invoiceNumber
          ? `Rechnung ${invoice.invoiceNumber} wartet auf Buchungsvorschlag und Freigabe.`
          : 'Neue Rechnung wartet auf Buchungsvorschlag und Freigabe.',
      });
    }

    return invoice;
  }

  /** UI v2 §12.1: die Liste zeigt Lieferant (Name) und Fälligkeit – der Lieferant kommt als schmale Auswahl mit, nicht als ganzer Stammsatz. */
  findAll(tenantId: string, status?: Invoice['status']): Promise<Array<Invoice & { supplier: { id: string; name: string } | null }>> {
    return this.prisma.forTenantId(tenantId).invoice.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      include: { supplier: { select: { id: true, name: true } } },
    });
  }

  /**
   * Includes the linked Supplier (name + IBAN) so the invoice detail page
   * can show the bank-change comparison (§59 Szenario C) to whoever can
   * already read this invoice (INVOICE_READ) — without also requiring
   * SUPPLIER_MANAGE just to see the one field that matters for that
   * comparison. See docs/ASSUMPTIONS.md Phase 19e.
   */
  async findOne(tenantId: string, id: string): Promise<InvoiceDetailRecord> {
    const found = await this.prisma.forTenantId(tenantId).invoice.findUnique({
      where: { id },
      // UI v2 §12.2: Beleg (Dokument), Buchungsvorschlag, Übertragung und der zugehörige Vorgang für die „Verknüpft“-Sektion.
      include: {
        supplier: true,
        document: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
        case: { select: { id: true, title: true } },
        bookingProposals: { orderBy: { createdAt: 'desc' } },
        financeTransfers: { orderBy: { startedAt: 'desc' } },
      },
    });
    if (!found) {
      throw new NotFoundError('Invoice not found.', { id });
    }
    return found;
  }

  async addBookingProposal(
    tenantId: string,
    actorUserId: string | undefined,
    invoiceId: string,
    input: AddBookingProposalInput,
    actorType: AuditActorType = 'USER',
  ): Promise<BookingProposal> {
    const invoice = await this.findOne(tenantId, invoiceId);
    if (invoice.status !== 'PENDING_APPROVAL') {
      throw new PolicyViolationError('Invoice is not awaiting a booking proposal.', {
        id: invoiceId,
        status: invoice.status,
      });
    }

    const proposal = await this.prisma.forTenantId(tenantId).bookingProposal.create({
      data: {
        tenantId,
        invoiceId,
        accountCode: input.accountCode,
        costCenter: input.costCenter,
        description: input.description,
        amount: input.amount,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'BOOKING_PROPOSED',
      actorType,
      actorUserId,
      entityType: 'BookingProposal',
      entityId: proposal.id,
      payload: { invoiceId, accountCode: input.accountCode },
    });

    return proposal;
  }

  async approve(tenantId: string, actorUserId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.findOne(tenantId, invoiceId);
    if (invoice.status !== 'PENDING_APPROVAL') {
      throw new PolicyViolationError('Invoice is not awaiting approval.', {
        id: invoiceId,
        status: invoice.status,
      });
    }

    const proposals = await this.prisma.forTenantId(tenantId).bookingProposal.findMany({
      where: { invoiceId },
    });
    if (proposals.length === 0) {
      throw new PolicyViolationError('Invoice has no booking proposal to approve.', { id: invoiceId });
    }

    await this.prisma.forTenantId(tenantId).bookingProposal.updateMany({
      where: { invoiceId },
      data: { status: 'APPROVED' },
    });

    const updated = await this.prisma.forTenantId(tenantId).invoice.update({
      where: { id: invoiceId },
      data: { status: 'APPROVED' },
    });

    await this.approvals.markDecided(tenantId, 'INVOICE', invoiceId, actorUserId, 'APPROVED');
    await this.audit.record({
      tenantId,
      eventType: 'APPROVAL_GRANTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { policyAction: 'invoice.transfer_to_fibu' },
    });

    return updated;
  }

  async reject(tenantId: string, actorUserId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.findOne(tenantId, invoiceId);
    if (invoice.status !== 'PENDING_APPROVAL' && invoice.status !== 'BANK_CHANGE_SUSPECTED') {
      throw new PolicyViolationError('Invoice is not awaiting approval.', {
        id: invoiceId,
        status: invoice.status,
      });
    }

    const updated = await this.prisma.forTenantId(tenantId).invoice.update({
      where: { id: invoiceId },
      data: { status: 'REJECTED' },
    });

    await this.approvals.markDecided(tenantId, 'INVOICE', invoiceId, actorUserId, 'REJECTED');
    await this.audit.record({
      tenantId,
      eventType: 'APPROVAL_REJECTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { policyAction: invoice.status === 'BANK_CHANGE_SUSPECTED' ? 'invoice.bank_change_review' : 'invoice.approve' },
    });

    return updated;
  }

  /**
   * Resolves a BANK_CHANGE_SUSPECTED invoice after a human has verified
   * the new IBAN is legitimate (e.g. called the supplier back on a known
   * number — out of scope for this system to verify itself, §59 Szenario
   * C only requires the *flag*, the human makes the actual judgment call).
   * Updates the Supplier's IBAN on file and continues the normal
   * booking-proposal + approval flow — this does NOT itself approve the
   * invoice for payment.
   */
  async confirmBankChange(tenantId: string, actorUserId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.findOne(tenantId, invoiceId);
    if (invoice.status !== 'BANK_CHANGE_SUSPECTED') {
      throw new PolicyViolationError('Invoice has no pending bank-change review.', {
        id: invoiceId,
        status: invoice.status,
      });
    }
    if (!invoice.supplierId) {
      throw new PolicyViolationError('Invoice has no linked supplier to update.', { id: invoiceId });
    }

    const extracted = invoice.extractedData as { supplierIban?: string } | null;
    const newIban = extracted?.supplierIban;
    if (!newIban) {
      throw new PolicyViolationError('Invoice has no extracted IBAN to confirm.', { id: invoiceId });
    }

    const previousSupplier = await this.prisma.forTenantId(tenantId).supplier.findUnique({
      where: { id: invoice.supplierId },
    });
    await this.prisma.forTenantId(tenantId).supplier.update({
      where: { id: invoice.supplierId },
      data: { iban: newIban },
    });

    const updated = await this.prisma.forTenantId(tenantId).invoice.update({
      where: { id: invoiceId },
      data: { status: 'PENDING_APPROVAL' },
    });

    await this.approvals.markDecided(tenantId, 'INVOICE', invoiceId, actorUserId, 'APPROVED');
    await this.audit.record({
      tenantId,
      eventType: 'SUPPLIER_BANK_DETAILS_CHANGED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Supplier',
      entityId: invoice.supplierId,
      payload: { previousIban: previousSupplier?.iban, newIban, confirmedViaInvoiceId: invoiceId },
    });

    // Bank-change risk cleared — the invoice still needs the normal
    // booking-proposal + approval step, so re-enter that queue.
    await this.approvals.create(tenantId, {
      entityType: 'INVOICE',
      entityId: invoiceId,
      policyAction: 'invoice.approve',
      requestedByUserId: actorUserId,
      reason: invoice.invoiceNumber
        ? `Rechnung ${invoice.invoiceNumber} wartet auf Buchungsvorschlag und Freigabe.`
        : 'Neue Rechnung wartet auf Buchungsvorschlag und Freigabe.',
    });

    return updated;
  }

  async transfer(
    tenantId: string,
    actorUserId: string | undefined,
    invoiceId: string,
    actorType: AuditActorType = 'USER',
  ): Promise<Invoice> {
    const invoice = await this.findOne(tenantId, invoiceId);
    if (invoice.status !== 'APPROVED') {
      throw new PolicyViolationError('Invoice is not approved for transfer.', {
        id: invoiceId,
        status: invoice.status,
      });
    }
    if (!invoice.supplierId) {
      throw new PolicyViolationError('Invoice has no matched supplier to transfer to.', { id: invoiceId });
    }

    const supplier = await this.prisma.forTenantId(tenantId).supplier.findUnique({
      where: { id: invoice.supplierId },
    });
    if (!supplier || supplier.status !== 'ACTIVE' || !supplier.externalFinanceId) {
      throw new PolicyViolationError('Supplier is not yet active in the FiBu system.', {
        id: invoiceId,
        supplierId: invoice.supplierId,
      });
    }

    const bookingProposal = await this.prisma.forTenantId(tenantId).bookingProposal.findFirst({
      where: { invoiceId, status: 'APPROVED' },
    });
    if (!bookingProposal) {
      throw new PolicyViolationError('Invoice has no approved booking proposal.', { id: invoiceId });
    }

    await this.audit.record({
      tenantId,
      eventType: 'FINANCE_TRANSFER_STARTED',
      actorType,
      actorUserId,
      entityType: 'Invoice',
      entityId: invoiceId,
    });

    try {
      const result = await this.financeConnector.transferInvoice({
        supplierExternalId: supplier.externalFinanceId,
        invoiceNumber: invoice.invoiceNumber ?? invoice.id,
        invoiceDate: invoice.invoiceDate ?? invoice.createdAt,
        dueDate: invoice.dueDate ?? undefined,
        amountNet: Number(invoice.amountNet ?? 0),
        amountGross: Number(invoice.amountGross ?? 0),
        vatAmount: Number(invoice.vatAmount ?? 0),
        vatRate: Number(invoice.vatRate ?? 0),
        currency: invoice.currency,
        accountCode: bookingProposal.accountCode,
        costCenter: bookingProposal.costCenter ?? undefined,
        description: bookingProposal.description ?? undefined,
      });

      await this.prisma.forTenantId(tenantId).financeTransfer.create({
        data: {
          tenantId,
          invoiceId,
          connector: this.financeConnector.providerName,
          externalReference: result.externalReference,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      const updated = await this.prisma.forTenantId(tenantId).invoice.update({
        where: { id: invoiceId },
        data: { status: 'TRANSFERRED' },
      });

      await this.audit.record({
        tenantId,
        eventType: 'FINANCE_TRANSFER_COMPLETED',
        actorType,
        actorUserId,
        entityType: 'Invoice',
        entityId: invoiceId,
        payload: { externalReference: result.externalReference },
      });

      return updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.prisma.forTenantId(tenantId).financeTransfer.create({
        data: {
          tenantId,
          invoiceId,
          connector: this.financeConnector.providerName,
          status: 'FAILED',
          errorMessage,
        },
      });

      await this.prisma.forTenantId(tenantId).invoice.update({
        where: { id: invoiceId },
        data: { status: 'TRANSFER_FAILED' },
      });

      await this.audit.record({
        tenantId,
        eventType: 'FINANCE_TRANSFER_FAILED',
        actorType,
        actorUserId,
        entityType: 'Invoice',
        entityId: invoiceId,
        payload: { error: errorMessage },
      });

      throw error;
    }
  }
}
