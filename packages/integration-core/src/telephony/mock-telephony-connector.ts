import { randomUUID } from 'node:crypto';
import type { CallRecord, TelephonyConnector } from './types';

/**
 * Deterministic in-memory Telephony connector (TELEPHONY_CONNECTOR=mock).
 * `seedCall()` lets tests/demo scripts inject a call as if Twilio had
 * reported it.
 */
export class MockTelephonyConnector implements TelephonyConnector {
  readonly providerName = 'mock';

  private readonly calls: CallRecord[] = [];

  async testConnection(): Promise<boolean> {
    return true;
  }

  async listRecentCalls(since: Date): Promise<CallRecord[]> {
    return this.calls.filter((call) => call.startedAt.getTime() >= since.getTime());
  }

  /** Test/dev helper — not part of the TelephonyConnector contract. */
  seedCall(call: Omit<CallRecord, 'externalId'> & { externalId?: string }): CallRecord {
    const record: CallRecord = { ...call, externalId: call.externalId ?? `mock-call-${randomUUID()}` };
    this.calls.push(record);
    return record;
  }
}
