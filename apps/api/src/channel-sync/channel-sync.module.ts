import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { GmailPollAdapter } from './gmail-poll.adapter';

/**
 * Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md). Increment C
 * only — provides the poll adapter(s). The generic sync queue/processor/
 * scheduler that actually calls `GmailPollAdapter.poll()` on a schedule is
 * Increment D; nothing in the running application invokes this module's
 * providers yet (deliberately — this increment is the adapter alone,
 * verified in isolation before wiring it to a live scheduler).
 */
@Module({
  imports: [IntegrationsModule],
  providers: [GmailPollAdapter],
  exports: [GmailPollAdapter],
})
export class ChannelSyncModule {}
