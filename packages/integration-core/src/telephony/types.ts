/**
 * Provider-agnostic contract for the Telephony connector (Twilio — §11).
 * PRODUCT_CONTEXT.md scopes phone-based lead intake to "Interessentenkontakt
 * per Telefon erkennen" — this connector's job is retrieving call metadata
 * (and, if available, a recording) for the Sales workflow to turn into a
 * lead, not full IVR/call-control (explicitly out of MVP scope).
 */

export interface CallRecord {
  externalId: string;
  fromNumber: string;
  toNumber: string;
  startedAt: Date;
  durationSeconds: number;
  recordingUrl?: string;
}

export interface TelephonyConnector {
  readonly providerName: string;

  testConnection(): Promise<boolean>;

  /** Calls that completed on/after `since`, most recent providers report last. */
  listRecentCalls(since: Date): Promise<CallRecord[]>;
}
