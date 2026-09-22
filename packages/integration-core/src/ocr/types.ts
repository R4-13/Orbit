/**
 * Provider-agnostic contract for invoice text/field extraction
 * (OCR_PROVIDER — @orbit/config/env.ts: "mock" | "tesseract"). Every field
 * is optional because a real OCR pass may fail to read some of them —
 * `confidenceScore` is what the Finance workflow (Phase 7) uses to decide
 * whether to trust the extraction or fall back to REQUIRE_APPROVAL.
 */
export interface ExtractedInvoiceData {
  supplierName?: string;
  supplierTaxId?: string;
  /** IBAN printed on the invoice as the payment destination — compared against the supplier's IBAN on file to detect bank-change fraud (§59 Szenario C). */
  supplierIban?: string;
  invoiceNumber?: string;
  /** ISO 8601 date string. */
  invoiceDate?: string;
  dueDate?: string;
  amountNet?: number;
  amountGross?: number;
  vatAmount?: number;
  vatRate?: number;
  currency?: string;
  /** 0 (no confidence / total failure) to 1 (fully confident). */
  confidenceScore: number;
}

export interface OcrProvider {
  readonly providerName: string;
  extractInvoiceData(documentBytes: Buffer, mimeType: string): Promise<ExtractedInvoiceData>;
}
