import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §64 ("Metrics") /
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md Phase 2 ("Operational
 * Hardening") — closes the `/metrics`-Endpunkt gap
 * `docs/MASTER_SPEC_GAP_ANALYSIS.md` §41 named ("Keine Metrics").
 *
 * `@Global()` (see `metrics.module.ts`), same pattern as `AuditModule` —
 * every feature module that wants to record a metric (Workflows, Agent,
 * Approvals, the HTTP middleware) injects this one shared service
 * instead of each owning its own `Registry`.
 *
 * Deliberately a narrower set than §64's full wishlist:
 * `llm_request_duration`/`llm_failures` are intentionally **not** here —
 * OpenTelemetry tracing (Phase 25, `docs/OBSERVABILITY.md`) already
 * captures LLM call latency as spans, duplicating that as a second,
 * differently-shaped metric would be redundant instrumentation for the
 * same underlying calls. `copilot_response_latency` doesn't exist yet
 * either — Sonde (§18+ of the concept) hasn't been built, a metric with
 * nothing to ever record would be a dead, misleading name.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  readonly queueDepth = new Gauge({
    name: 'queue_depth',
    help: 'Number of BullMQ jobs per queue and state.',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });

  readonly workflowRunDuration = new Histogram({
    name: 'workflow_run_duration_seconds',
    help: 'Duration of a WorkflowRun from creation to a terminal or WAITING_FOR_APPROVAL status.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly workflowRunFailures = new Counter({
    name: 'workflow_run_failures_total',
    help: 'Total number of WorkflowRuns that ended FAILED.',
    registers: [this.registry],
  });

  readonly agentRunDuration = new Histogram({
    name: 'agent_run_duration_seconds',
    help: 'Duration of a single AgentRuntime.runTurn() call.',
    labelNames: ['agent_type', 'status'] as const,
    registers: [this.registry],
  });

  readonly agentRunFailures = new Counter({
    name: 'agent_run_failures_total',
    help: 'Total number of AgentRuns that ended FAILED.',
    labelNames: ['agent_type'] as const,
    registers: [this.registry],
  });

  readonly toolInvocationDuration = new Histogram({
    name: 'tool_invocation_duration_seconds',
    help: 'Duration of a single tool execution (ALLOW decisions only — blocked/denied calls never reach the tool).',
    labelNames: ['tool_name', 'status'] as const,
    registers: [this.registry],
  });

  readonly approvalWaitTime = new Histogram({
    name: 'approval_wait_time_seconds',
    help: 'Time between an Approval being requested and decided.',
    labelNames: ['entity_type', 'decision'] as const,
    buckets: [1, 10, 60, 300, 900, 3600, 21600, 86400, 604800], // 1s .. 1 week — approvals can realistically wait days
    registers: [this.registry],
  });

  readonly connectorErrors = new Counter({
    name: 'connector_errors_total',
    help: 'Total number of ExternalSystemError/IntegrationUnavailableError responses.',
    labelNames: ['error_code'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
