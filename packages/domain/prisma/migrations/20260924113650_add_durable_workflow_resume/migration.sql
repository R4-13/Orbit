-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentRunStatus" ADD VALUE 'WAITING_FOR_APPROVAL';
ALTER TYPE "AgentRunStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "tool_invocations" ADD COLUMN     "tool_call_id" TEXT;

-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN     "context_snapshot" JSONB;

-- CreateIndex
CREATE INDEX "tool_invocations_tenant_id_tool_call_id_idx" ON "tool_invocations"("tenant_id", "tool_call_id");

-- CreateIndex
CREATE INDEX "workflow_step_runs_agent_run_id_idx" ON "workflow_step_runs"("agent_run_id");
