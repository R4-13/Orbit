import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CHANNEL_POLL_ADAPTERS } from './channel-sync.tokens';
import { GmailPollAdapter } from './gmail-poll.adapter';

/**
 * Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md). Provides
 * every `ChannelPollAdapter` behind the `CHANNEL_POLL_ADAPTERS` token —
 * `ChannelSyncProcessor` (Increment D, `apps/api/worker/`) looks one up by
 * `connectorType` at poll time, never imports `GmailPollAdapter` (or any
 * future adapter) directly. A new polling-capable connector registers one
 * new provider in this array; the processor itself never changes.
 */
@Module({
  imports: [IntegrationsModule],
  providers: [
    GmailPollAdapter,
    {
      provide: CHANNEL_POLL_ADAPTERS,
      inject: [GmailPollAdapter],
      useFactory: (gmail: GmailPollAdapter) => [gmail],
    },
  ],
  exports: [CHANNEL_POLL_ADAPTERS],
})
export class ChannelSyncModule {}
