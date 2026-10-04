import { Injectable } from '@nestjs/common';
import { GmailConnectorService } from './gmail-connector.service';
import type { OutgoingMessage } from './rfc822';

/**
 * The outbound-mail port the process tools depend on. The real implementation sends through the tenant's connected
 * mailbox; tests substitute a recording double. `executionMode` is part of the contract so a simulated send can never be
 * reported as a live one (Amendment 02 §16.6).
 */
export const OUTBOUND_MAIL = Symbol('OUTBOUND_MAIL');

export type OutboundMessage = Omit<OutgoingMessage, 'from'> & { threadId?: string };

export interface OutboundMailResult {
  providerMessageId: string;
  threadId?: string;
  rfcMessageId?: string;
  from: string;
  executionMode: 'LIVE' | 'SIMULATED';
}

export interface OutboundMailPort {
  send(tenantId: string, message: OutboundMessage): Promise<OutboundMailResult>;
}

@Injectable()
export class GmailOutboundMail implements OutboundMailPort {
  constructor(private readonly gmail: GmailConnectorService) {}

  async send(tenantId: string, message: OutboundMessage): Promise<OutboundMailResult> {
    const sent = await this.gmail.sendMessage(tenantId, message);
    return { ...sent, executionMode: 'LIVE' };
  }
}
