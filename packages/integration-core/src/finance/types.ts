/**
 * Provider-agnostic contract for the Finance/FiBu connector (DATEV/Lexware
 * — §5, §53). Every method here maps to a real capability those systems
 * expose; nothing here invents a concrete DATEV/Lexware API shape — the
 * actual HTTP calls are added per-provider only once implemented against
 * official vendor documentation (see docs/INTEGRATIONS.md).
 */

export interface FinanceSupplierRecord {
  /** The FiBu system's own identifier for this supplier — never our internal Supplier.id. */
  externalId: string;
  name: string;
  taxId?: string;
  vatId?: string;
  iban?: string;
  bic?: string;
}

export interface CreateFinanceSupplierInput {
  name: string;
  taxId?: string;
  vatId?: string;
  iban?: string;
  bic?: string;
  email?: string;
  addressLine1?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

export interface UpdateSupplierBankDetailsInput {
  iban: string;
  bic: string;
}

export interface TransferInvoiceInput {
  supplierExternalId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date;
  amountNet: number;
  amountGross: number;
  vatAmount: number;
  vatRate: number;
  currency: string;
  accountCode: string;
  costCenter?: string;
  description?: string;
}

export interface TransferInvoiceResult {
  /** The FiBu system's booking/voucher reference. */
  externalReference: string;
}

export interface FinanceConnector {
  readonly providerName: string;

  /** Verifies stored credentials still work; used by Integration health checks. */
  testConnection(): Promise<boolean>;

  findSupplierByTaxId(taxId: string): Promise<FinanceSupplierRecord | null>;
  findSuppliersByName(name: string): Promise<FinanceSupplierRecord[]>;
  createSupplier(input: CreateFinanceSupplierInput): Promise<FinanceSupplierRecord>;
  updateSupplierBankDetails(
    supplierExternalId: string,
    input: UpdateSupplierBankDetailsInput,
  ): Promise<void>;

  transferInvoice(input: TransferInvoiceInput): Promise<TransferInvoiceResult>;
}
