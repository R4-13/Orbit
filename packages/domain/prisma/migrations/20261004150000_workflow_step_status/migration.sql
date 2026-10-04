-- Amendment 02 §12.1/§12.5 — real step status + OUTCOME_UNKNOWN tool status.
ALTER TYPE "ToolInvocationStatus" ADD VALUE IF NOT EXISTS 'OUTCOME_UNKNOWN';

CREATE TYPE "WorkflowStepRunStatus" AS ENUM ('PLANNED', 'READY', 'RUNNING', 'WAITING', 'AWAITING_APPROVAL', 'SUCCEEDED', 'SKIPPED', 'BLOCKED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'OUTCOME_UNKNOWN');

ALTER TABLE "workflow_step_runs"
  ADD COLUMN "status" "WorkflowStepRunStatus" NOT NULL DEFAULT 'SUCCEEDED',
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "failed_tool_name" TEXT;

-- Backfill from what was actually recorded, never inventing a success:
-- skipped rows, rows whose AgentRun FAILED, and rows whose run is paused for approval.
UPDATE "workflow_step_runs" SET "status" = 'SKIPPED' WHERE "skipped" = true;

UPDATE "workflow_step_runs" sr
SET "status" = 'FAILED',
    "error_code" = 'TOOL_RETURNED_ERROR',
    "error_message" = 'Nachträglich aus dem AgentRun-Status abgeleitet (AgentRun FAILED).'
FROM "agent_runs" ar
WHERE sr."agent_run_id" = ar."id" AND ar."status" = 'FAILED' AND sr."skipped" = false;

UPDATE "workflow_step_runs" sr
SET "status" = 'AWAITING_APPROVAL'
FROM "workflow_runs" wr
WHERE sr."workflow_run_id" = wr."id" AND wr."status" = 'WAITING_FOR_APPROVAL' AND sr."status" = 'SUCCEEDED' AND sr."skipped" = false
  AND sr."step_order" = (SELECT MAX(x."step_order") FROM "workflow_step_runs" x WHERE x."workflow_run_id" = wr."id");
