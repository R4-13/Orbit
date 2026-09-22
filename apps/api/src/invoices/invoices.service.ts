import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError } from '@orbit/shared';
import { Prisma, type BookingProposal, type Invoice } from '@orbit/domain';
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
    if (!duplicate && extracted.supplierName) {
      const { supplier } = await this.suppliers.findOrCreate(
        tenantId,
        actorUserId,
        { name: extracted.supplierName, taxId: extracted.supplierTaxId },
        actorType,
      );
      supplierId = supplier.id;
    }

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
        status: duplicate ? 'DUPLICATE_SUSPECTED' : 'PENDING_APPROVAL',
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

  findAll(tenantId: string, status?: Invoice['status']): Promise<Invoice[]> {
    return this.prisma.forTenantId(tenantId).invoice.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Invoice> {
    const found = await this.prisma.forTenantId(tenantId).invoice.findUnique({ where: { id } });
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
