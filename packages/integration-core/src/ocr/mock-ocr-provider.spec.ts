import { describe, expect, it } from 'vitest';
import { MockOcrProvider } from './mock-ocr-provider';

describe('MockOcrProvider', () => {
  it('returns scripted results in order', async () => {
    const provider = new MockOcrProvider([
      { supplierName: 'Muster GmbH', confidenceScore: 0.95 },
      { supplierName: 'Beispiel AG', confidenceScore: 0.8 },
    ]);

    const a = await provider.extractInvoiceData(Buffer.from(''), 'application/pdf');
    const b = await provider.extractInvoiceData(Buffer.from(''), 'application/pdf');

    expect(a.supplierName).toBe('Muster GmbH');
    expect(b.supplierName).toBe('Beispiel AG');
  });

  it('returns zero confidence once the script is exhausted', async () => {
    const provider = new MockOcrProvider();
    const result = await provider.extractInvoiceData(Buffer.from(''), 'application/pdf');
    expect(result).toEqual({ confidenceScore: 0 });
  });

  it('seedResult() appends to the queue', async () => {
    const provider = new MockOcrProvider();
    provider.seedResult({ supplierName: 'Nachtrag GmbH', confidenceScore: 0.5 });
    const result = await provider.extractInvoiceData(Buffer.from(''), 'application/pdf');
    expect(result.supplierName).toBe('Nachtrag GmbH');
  });
});
