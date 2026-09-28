import type { ConversationMessage } from '@orbit/domain';

/**
 * §33 des Master-Dokuments ("Sonde action cards, streaming and API") —
 * die dort vorgeschlagene SSE-Event-Liste (`message.delta`, `tool.started`,
 * `tool.completed`, `workflow.started`, `workflow.updated`,
 * `approval.required`, `message.completed`, `error`), reduziert auf den
 * Teil, der im ASK-Modus tatsächlich zutrifft: kein `message.delta` (siehe
 * `AgentTurnEvent` in packages/agent-core), keine `workflow.*`/
 * `approval.required`-Events (die gehören zu PREPARE/ACT/DELEGATE,
 * §63 Phase 9-11, noch nicht Teil dieser Stufe) — ausdrücklich von §33
 * selbst als "or an equivalent clean SSE design" erlaubt.
 */
export type CopilotStreamEvent =
  | { type: 'tool.started'; data: { toolName: string } }
  | { type: 'tool.completed'; data: { toolName: string; decision: string; error?: string } }
  | { type: 'message.completed'; data: ConversationMessage }
  | { type: 'error'; data: { message: string } };
