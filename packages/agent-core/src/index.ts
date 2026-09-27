// Agent Runtime: provider-agnostic LLM abstraction, a Zod-validated Tool
// Registry, the Policy Engine decision function, and the AgentRuntime
// orchestration loop that ties them together (see runtime/agent-runtime.ts
// for how this maps to the "Agent -> Tool Registry -> Policy Engine ->
// Authorization Check -> Tool Gateway -> Connector" architecture principle
// in docs/PRODUCT_CONTEXT.md).
//
// Concrete tools (invoice extraction, CRM lookups, ...) and the four
// logical agent personas (Orchestrator, Communication, Finance, Sales)
// are registered per-domain starting Phase 7 (Finance-Workflow) — there is
// nothing to give them yet before those tools exist.
export * from './llm/types';
export * from './llm/mock-llm-provider';
export * from './llm/anthropic-llm-provider';
export * from './tools/types';
export * from './tools/tool-registry';
export * from './policy/policy-engine';
export * from './runtime/agent-runtime';
export * from './prompt/prompt-layers';
