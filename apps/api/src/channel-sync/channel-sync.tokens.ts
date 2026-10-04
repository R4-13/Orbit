/** Multi-provider injection token — every registered `ChannelPollAdapter`, looked up by `connectorType` at poll time. One new connector = one new adapter added to this array's provider in `channel-sync.module.ts`, no change to the processor that consumes it. */
export const CHANNEL_POLL_ADAPTERS = Symbol('CHANNEL_POLL_ADAPTERS');
