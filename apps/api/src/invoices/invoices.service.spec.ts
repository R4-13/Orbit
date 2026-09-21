import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { FINANCE_CONNECTOR, OCR_PROVIDER } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let scoped: {
    document: { findUnique: jest.Mock };
    invoice: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    bookingProposal: { create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock; findFirst: jest.Mock };
    supplier: { findUnique: jest.Mock };
    financeTransfer: { create: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let storage: { getObjectBytes: jest.Mock };
  let ocr: { extractInvoiceData: jest.Mock };
  let financeConnector: { transferInvoice: jest.Mock; providerName: string };
  let suppliers: { findOrCreate: jest.Mock };

  beforeEach(async () => {
    scoped = {
      document: { findUnique: jest.fn() },
      invoice: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      bookingProposal: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
      supplier: { findUnique: jest.fn() },
      financeTransfer: { create: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    storage = { getObjectBytes: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')) };
    ocr = { extractInvoiceData: jest.fn() };
    financeConnector = {
      transferInvoice: jest.fn().mockResolvedValue({ externalReference: 'mock-voucher-1' }),
      providerName: 'mock',
    };
    suppliers = { findOrCreate: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: StorageService, useValue: storage },
        { provide: SuppliersService, useValue: suppliers },
        { provide: FINANCE_CONNECTOR, useValue: financeConnector },
        { provide: OCR_PROVIDER, useValue: ocr },
      ],
    }).compile();

    service = moduleRef.get(InvoicesService);
  });

  describe('createFromDocument', () => {
    it('runs OCR, matches/creates the supplier, and creates a PENDING_APPROVAL invoice', async () => {
      scoped.document.findUnique.mockResolvedValue({
        id: 'doc_1',
        storageKey: 'tenants/t1/documents/x.pdf',
        mimeType: 'application/pdf',
      });
      ocr.extractInvoiceData.mockResolvedValue({
        supplierName: 'Muster GmbH',
        supplierTaxId: 'DE123',
        invoiceNumber: 'RE-2026-001',
        amountGross: 119,
        confidenceScore: 0.9,
      });
      scoped.invoice.findFirst.mockResolvedValue(null); // no duplicate
      suppliers.findOrCreate.mockResolvedValue({ supplier: { id: 'sup_1' }, created: false });
      scoped.invoice.create.mockResolvedValue({ id: 'inv_1', status: 'PENDING_APPROVAL' });

      const result = await service.createFromDocument('tenant_1', 'user_1', { documentId: 'doc_1' });

      expect(storage.getObjectBytes).toHaveBeenCalledWith('tenants/t1/documents/x.pdf');
      expect(suppliers.findOrCreate).toHaveBeenCalledWith('tenant_1', 'user_1', {
        name: 'Muster GmbH',
        taxId: 'DE123',
      });
      expect(scoped.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ supplierId: 'sup_1', status: 'PENDING_APPROVAL' }),
      });
      expect(result.status).toBe('PENDING_APPROVAL');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INVOICE_CREATED' }));
    });

    it('marks the invoice DUPLICATE_SUSPECTED when invoiceNumber+amountGross already exist, and skips supplier matching', async () => {
      scoped.document.findUnique.mockResolvedValue({
        id: 'doc_1',
        storageKey: 'x',
        mimeType: 'application/pdf',
      });
      ocr.extractInvoiceData.mockResolvedValue({
        supplierName: 'Muster GmbH',
        invoiceNumber: 'RE-2026-001',
        amountGross: 119,
        confidenceScore: 0.9,
      });
      scoped.invoice.findFirst.mockResolvedValue({ id: 'inv_existing' });
      scoped.invoice.create.mockResolvedValue({ id: 'inv_2', status: 'DUPLICATE_SUSPECTED' });

      const result = await service.createFromDocument('tenant_1', 'user_1', { documentId: 'doc_1' });

      expect(suppliers.findOrCreate).not.toHaveBeenCalled();
      expect(scoped.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'DUPLICATE_SUSPECTED', duplicateOfInvoiceId: 'inv_existing' }),
      });
      expect(result.status).toBe('DUPLICATE_SUSPECTED');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'DUPLICATE_INVOICE_DETECTED' }),
      );
    });
  });

  describe('approve', () => {
    it('rejects an invoice that is not PENDING_APPROVAL', async () => {
      scoped.invoice.findUnique.mockResolvedValue({ id: 'inv_1', status: 'RECEIVED' });
      await expect(service.approve('tenant_1', 'user_1', 'inv_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
    });

    it('rejects an invoice with no booking proposal', async () => {
      scoped.invoice.findUnique.mockResolvedValue({ id: 'inv_1', status: 'PENDING_APPROVAL' });
      scoped.bookingProposal.findMany.mockResolvedValue([]);
      await expect(service.approve('tenant_1', 'user_1', 'inv_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
    });

    it('approves the invoice and all its booking proposals', async () => {
      scoped.invoice.findUnique.mockResolvedValue({ id: 'inv_1', status: 'PENDING_APPROVAL' });
      scoped.bookingProposal.findMany.mockResolvedValue([{ id: 'bp_1' }]);
      scoped.invoice.update.mockResolvedValue({ id: 'inv_1', status: 'APPROVED' });

      const result = await service.approve('tenant_1', 'user_1', 'inv_1');

      expect(scoped.bookingProposal.updateMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv_1' },
        data: { status: 'APPROVED' },
      });
      expect(result.status).toBe('APPROVED');
    });
  });

  describe('transfer', () => {
    const APPROVED_INVOICE = {
      id: 'inv_1',
      status: 'APPROVED',
      supplierId: 'sup_1',
      invoiceNumber: 'RE-1',
      invoiceDate: new Date(),
      amountNet: 100,
      amountGross: 119,
      vatAmount: 19,
      vatRate: 19,
      currency: 'EUR',
      createdAt: new Date(),
    };
    const ACTIVE_SUPPLIER = { id: 'sup_1', status: 'ACTIVE', externalFinanceId: 'mock-supplier-1' };
    const APPROVED_BOOKING = { id: 'bp_1', accountCode: '4400', status: 'APPROVED' };

    it('rejects an invoice that is not APPROVED', async () => {
      scoped.invoice.findUnique.mockResolvedValue({ id: 'inv_1', status: 'PENDING_APPROVAL' });
      await expect(service.transfer('tenant_1', 'user_1', 'inv_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
    });

    it('rejects when the supplier is not yet ACTIVE in the FiBu system', async () => {
      scoped.invoice.findUnique.mockResolvedValue(APPROVED_INVOICE);
      scoped.supplier.findUnique.mockResolvedValue({ id: 'sup_1', status: 'PENDING_APPROVAL' });
      await expect(service.transfer('tenant_1', 'user_1', 'inv_1')).rejects.toMatchObject({
        code: 'POLICY_VIOLATION',
      });
    });

    it('on success: calls the FiBu connector, records a COMPLETED FinanceTransfer, and marks the invoice TRANSFERRED', async () => {
      scoped.invoice.findUnique.mockResolvedValue(APPROVED_INVOICE);
      scoped.supplier.findUnique.mockResolvedValue(ACTIVE_SUPPLIER);
      scoped.bookingProposal.findFirst.mockResolvedValue(APPROVED_BOOKING);
      scoped.invoice.update.mockResolvedValue({ id: 'inv_1', status: 'TRANSFERRED' });

      const result = await service.transfer('tenant_1', 'user_1', 'inv_1');

      expect(financeConnector.transferInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ supplierExternalId: 'mock-supplier-1', accountCode: '4400' }),
      );
      expect(scoped.financeTransfer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'COMPLETED', externalReference: 'mock-voucher-1' }),
      });
      expect(result.status).toBe('TRANSFERRED');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'FINANCE_TRANSFER_COMPLETED' }),
      );
    });

    it('on connector failure: records a FAILED FinanceTransfer, marks the invoice TRANSFER_FAILED, and rethrows', async () => {
      scoped.invoice.findUnique.mockResolvedValue(APPROVED_INVOICE);
      scoped.supplier.findUnique.mockResolvedValue(ACTIVE_SUPPLIER);
      scoped.bookingProposal.findFirst.mockResolvedValue(APPROVED_BOOKING);
      financeConnector.transferInvoice.mockRejectedValue(new Error('FiBu system unreachable'));

      await expect(service.transfer('tenant_1', 'user_1', 'inv_1')).rejects.toThrow('FiBu system unreachable');

      expect(scoped.financeTransfer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'FiBu system unreachable' }),
      });
      expect(scoped.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv_1' },
        data: { status: 'TRANSFER_FAILED' },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'FINANCE_TRANSFER_FAILED' }));
    });
  });
});
