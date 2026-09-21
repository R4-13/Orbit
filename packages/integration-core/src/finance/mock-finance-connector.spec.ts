import { describe, expect, it } from 'vitest';
import { MockFinanceConnector } from './mock-finance-connector';

describe('MockFinanceConnector', () => {
  it('testConnection() always succeeds', async () => {
    expect(await new MockFinanceConnector().testConnection()).toBe(true);
  });

  it('createSupplier() then findSupplierByTaxId() round-trips', async () => {
    const connector = new MockFinanceConnector();
    const created = await connector.createSupplier({ name: 'Muster GmbH', taxId: 'DE123456789' });

    expect(created.externalId).toMatch(/^mock-supplier-/);
    expect(await connector.findSupplierByTaxId('DE123456789')).toEqual(created);
    expect(await connector.findSupplierByTaxId('unknown')).toBeNull();
  });

  it('findSuppliersByName() matches case-insensitively and partially', async () => {
    const connector = new MockFinanceConnector();
    await connector.createSupplier({ name: 'Muster GmbH' });
    await connector.createSupplier({ name: 'Beispiel AG' });

    const results = await connector.findSuppliersByName('muster');
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('Muster GmbH');
  });

  it('updateSupplierBankDetails() overwrites iban/bic on the existing record', async () => {
    const connector = new MockFinanceConnector();
    const created = await connector.createSupplier({ name: 'Muster GmbH' });

    await connector.updateSupplierBankDetails(created.externalId, {
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
    });

    const found = await connector.findSuppliersByName('Muster');
    expect(found[0]).toMatchObject({ iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' });
  });

  it('updateSupplierBankDetails() rejects an unknown supplier', async () => {
    const connector = new MockFinanceConnector();
    await expect(
      connector.updateSupplierBankDetails('does-not-exist', { iban: 'x', bic: 'y' }),
    ).rejects.toThrow(/unknown supplier/i);
  });

  it('transferInvoice() records the transfer and returns a unique voucher reference', async () => {
    const connector = new MockFinanceConnector();
    const input = {
      supplierExternalId: 'mock-supplier-1',
      invoiceNumber: 'RE-2026-001',
      invoiceDate: new Date('2026-01-15'),
      amountNet: 100,
      amountGross: 119,
      vatAmount: 19,
      vatRate: 19,
      currency: 'EUR',
      accountCode: '4400',
    };

    const resultA = await connector.transferInvoice(input);
    const resultB = await connector.transferInvoice(input);

    expect(resultA.externalReference).not.toBe(resultB.externalReference);
    expect(connector.getRecordedTransfers()).toHaveLength(2);
  });
});
