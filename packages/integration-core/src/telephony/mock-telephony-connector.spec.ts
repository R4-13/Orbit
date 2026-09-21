import { describe, expect, it } from 'vitest';
import { MockTelephonyConnector } from './mock-telephony-connector';

describe('MockTelephonyConnector', () => {
  it('listRecentCalls() only returns calls at or after the given cutoff', async () => {
    const connector = new MockTelephonyConnector();
    connector.seedCall({
      fromNumber: '+491701234567',
      toNumber: '+498912345678',
      startedAt: new Date('2026-03-01T10:00:00Z'),
      durationSeconds: 120,
    });
    connector.seedCall({
      fromNumber: '+491709876543',
      toNumber: '+498912345678',
      startedAt: new Date('2026-03-02T10:00:00Z'),
      durationSeconds: 60,
    });

    const result = await connector.listRecentCalls(new Date('2026-03-02T00:00:00Z'));
    expect(result).toHaveLength(1);
    expect(result[0]?.fromNumber).toBe('+491709876543');
  });

  it('seedCall() assigns a unique externalId when none is given', () => {
    const connector = new MockTelephonyConnector();
    const a = connector.seedCall({
      fromNumber: '+491701234567',
      toNumber: '+498912345678',
      startedAt: new Date(),
      durationSeconds: 30,
    });
    const b = connector.seedCall({
      fromNumber: '+491701234567',
      toNumber: '+498912345678',
      startedAt: new Date(),
      durationSeconds: 30,
    });
    expect(a.externalId).not.toBe(b.externalId);
  });
});
