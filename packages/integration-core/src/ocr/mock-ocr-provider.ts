import type { ExtractedInvoiceData, OcrProvider } from './types';

/**
 * Deterministic OCR double (OCR_PROVIDER=mock, the default). Real OCR
 * output can't be simulated meaningfully from arbitrary bytes, so this
 * takes a queue of pre-scripted extraction results the same way
 * MockLLMProvider does — tests/demo scripts seed exactly what "OCR" should
 * report for the next document.
 */
export class MockOcrProvider implements OcrProvider {
  readonly providerName = 'mock';

  private readonly queue: ExtractedInvoiceData[];

  constructor(scriptedResults: ExtractedInvoiceData[] = []) {
    this.queue = [...scriptedResults];
  }

  async extractInvoiceData(_documentBytes: Buffer, _mimeType: string): Promise<ExtractedInvoiceData> {
    return this.queue.shift() ?? { confidenceScore: 0 };
  }

  /** Test/dev helper — not part of the OcrProvider contract. */
  seedResult(result: ExtractedInvoiceData): void {
    this.queue.push(result);
  }
}
