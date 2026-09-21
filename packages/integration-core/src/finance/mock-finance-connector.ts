import { randomUUID } from 'node:crypto';
import type {
  CreateFinanceSupplierInput,
  FinanceConnector,
  FinanceSupplierRecord,
  TransferInvoiceInput,
  TransferInvoiceResult,
  UpdateSupplierBankDetailsInput,
} from './types';

/**
 * Deterministic in-memory Finance connector. Used whenever
 * FINANCE_CONNECTOR=mock (the default — see @orbit/config/env.ts) so the
 * Finance workflow (Phase 7) is fully exercisable without DATEV/Lexware
 * credentials, in local dev and in CI.
 */
export class MockFinanceConnector implements FinanceConnector {
  readonly providerName = 'mock';

  private readonly suppliersByExternalId = new Map<string, FinanceSupplierRecord>();
  private readonly transfers: TransferInvoiceInput[] = [];

  async testConnection(): Promise<boolean> {
    return true;
  }

  async findSupplierByTaxId(taxId: string): Promise<FinanceSupplierRecord | null> {
    for (const supplier of this.suppliersByExternalId.values()) {
      if (supplier.taxId === taxId) return supplier;
    }
    return null;
  }

  async findSuppliersByName(name: string): Promise<FinanceSupplierRecord[]> {
    const needle = name.trim().toLowerCase();
    return Array.from(this.suppliersByExternalId.values()).filter((supplier) =>
      supplier.name.toLowerCase().includes(needle),
    );
  }

  async createSupplier(input: CreateFinanceSupplierInput): Promise<FinanceSupplierRecord> {
    const record: FinanceSupplierRecord = {
      externalId: `mock-supplier-${randomUUID()}`,
      name: input.name,
      taxId: input.taxId,
      vatId: input.vatId,
      iban: input.iban,
      bic: input.bic,
    };
    this.suppliersByExternalId.set(record.externalId, record);
    return record;
  }

  async updateSupplierBankDetails(
    supplierExternalId: string,
    input: UpdateSupplierBankDetailsInput,
  ): Promise<void> {
    const existing = this.suppliersByExternalId.get(supplierExternalId);
    if (!existing) {
      throw new Error(`Mock FiBu: unknown supplier "${supplierExternalId}".`);
    }
    this.suppliersByExternalId.set(supplierExternalId, {
      ...existing,
      iban: input.iban,
      bic: input.bic,
    });
  }

  async transferInvoice(input: TransferInvoiceInput): Promise<TransferInvoiceResult> {
    this.transfers.push(input);
    return { externalReference: `mock-voucher-${randomUUID()}` };
  }

  /** Test/dev helper — not part of the FinanceConnector contract. */
  seedSupplier(record: FinanceSupplierRecord): void {
    this.suppliersByExternalId.set(record.externalId, record);
  }

  /** Test/dev helper — not part of the FinanceConnector contract. */
  getRecordedTransfers(): readonly TransferInvoiceInput[] {
    return this.transfers;
  }
}
