-- Amendment 02 section 8/11/13/14/15/18 - Blueprint registry, plans, action ledger, wait subscriptions, case events, commands (additive).
-- CreateEnum
CREATE TYPE "ProcessBlueprintStatus" AS ENUM ('DRAFT', 'VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED', 'SUSPENDED', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProcessPlanStatus" AS ENUM ('PROPOSED', 'VALIDATED', 'AWAITING_APPROVAL', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProcessPlanSource" AS ENUM ('BLUEPRINT_INSTANTIATION', 'LLM_PLANNER', 'HUMAN');

-- CreateEnum
CREATE TYPE "ProcessNodeState" AS ENUM ('PLANNED', 'READY', 'RUNNING', 'WAITING', 'AWAITING_APPROVAL', 'SUCCEEDED', 'SKIPPED', 'BLOCKED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "ActionIntentStatus" AS ENUM ('PREPARED', 'AWAITING_APPROVAL', 'APPROVED', 'DISPATCHING', 'CONFIRMED', 'FAILED', 'OUTCOME_UNKNOWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionReceiptStatus" AS ENUM ('CONFIRMED', 'FAILED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "WaitSubscriptionStatus" AS ENUM ('WAITING', 'SATISFIED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseCommandStatus" AS ENUM ('ACCEPTED', 'REJECTED', 'CONFLICT');

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "event_sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lease_expires_at" TIMESTAMP(3),
ADD COLUMN     "lease_owner" TEXT;

-- CreateTable
CREATE TABLE "process_blueprints" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ProcessBlueprintStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "definition_hash" TEXT NOT NULL,
    "validation" JSONB,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "process_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_process_activations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "blueprint_key" TEXT NOT NULL,
    "active_version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "activated_by_user_id" TEXT,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_process_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "parent_plan_id" TEXT,
    "status" "ProcessPlanStatus" NOT NULL,
    "source" "ProcessPlanSource" NOT NULL,
    "blueprint_key" TEXT,
    "blueprint_version" TEXT,
    "goal_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "based_on_case_revision" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "unresolved_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan_hash" TEXT NOT NULL,
    "validation" JSONB NOT NULL,
    "created_by_user_id" TEXT,
    "approval_id" TEXT,
    "diff_from_parent" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),

    CONSTRAINT "process_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_plan_nodes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "state" "ProcessNodeState" NOT NULL DEFAULT 'PLANNED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "execution_mode" TEXT,
    "agent_run_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "retry_at" TIMESTAMP(3),

    CONSTRAINT "process_plan_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_plan_edges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "edge_key" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "label" TEXT,
    "condition" JSONB,

    CONSTRAINT "process_plan_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_intents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "plan_revision" INTEGER NOT NULL,
    "case_revision" INTEGER NOT NULL,
    "node_key" TEXT NOT NULL,
    "capability_key" TEXT NOT NULL,
    "purpose" TEXT,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "ActionIntentStatus" NOT NULL DEFAULT 'PREPARED',
    "approval_id" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "status" "ActionReceiptStatus" NOT NULL,
    "provider_ref" TEXT,
    "evidence" JSONB NOT NULL,
    "execution_mode" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wait_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "node_key" TEXT,
    "event_type" TEXT NOT NULL,
    "correlation" JSONB NOT NULL,
    "status" "WaitSubscriptionStatus" NOT NULL DEFAULT 'WAITING',
    "deadline_at" TIMESTAMP(3),
    "satisfied_by_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "wait_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT,
    "inbound" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_commands" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expected_case_revision" INTEGER NOT NULL,
    "status" "CaseCommandStatus" NOT NULL,
    "result_case_revision" INTEGER,
    "actor_user_id" TEXT NOT NULL,
    "errors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "process_blueprints_tenant_id_status_idx" ON "process_blueprints"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "process_blueprints_tenant_id_key_version_key" ON "process_blueprints"("tenant_id", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_process_activations_tenant_id_blueprint_key_key" ON "tenant_process_activations"("tenant_id", "blueprint_key");

-- CreateIndex
CREATE INDEX "process_plans_tenant_id_case_id_status_idx" ON "process_plans"("tenant_id", "case_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "process_plans_case_id_revision_key" ON "process_plans"("case_id", "revision");

-- CreateIndex
CREATE INDEX "process_plan_nodes_tenant_id_state_idx" ON "process_plan_nodes"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "process_plan_nodes_plan_id_node_key_key" ON "process_plan_nodes"("plan_id", "node_key");

-- CreateIndex
CREATE UNIQUE INDEX "process_plan_edges_plan_id_edge_key_key" ON "process_plan_edges"("plan_id", "edge_key");

-- CreateIndex
CREATE INDEX "action_intents_tenant_id_case_id_status_idx" ON "action_intents"("tenant_id", "case_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "action_intents_tenant_id_idempotency_key_key" ON "action_intents"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "action_receipts_tenant_id_intent_id_idx" ON "action_receipts"("tenant_id", "intent_id");

-- CreateIndex
CREATE INDEX "wait_subscriptions_tenant_id_case_id_status_idx" ON "wait_subscriptions"("tenant_id", "case_id", "status");

-- CreateIndex
CREATE INDEX "wait_subscriptions_status_deadline_at_idx" ON "wait_subscriptions"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "case_events_tenant_id_inbound_processed_at_idx" ON "case_events"("tenant_id", "inbound", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "case_events_case_id_sequence_key" ON "case_events"("case_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "case_events_tenant_id_dedupe_key_key" ON "case_events"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "case_commands_tenant_id_case_id_idx" ON "case_commands"("tenant_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_commands_tenant_id_command_id_key" ON "case_commands"("tenant_id", "command_id");

-- AddForeignKey
ALTER TABLE "process_blueprints" ADD CONSTRAINT "process_blueprints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_process_activations" ADD CONSTRAINT "tenant_process_activations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_plans" ADD CONSTRAINT "process_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_plans" ADD CONSTRAINT "process_plans_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_plan_nodes" ADD CONSTRAINT "process_plan_nodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_plan_nodes" ADD CONSTRAINT "process_plan_nodes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "process_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_plan_edges" ADD CONSTRAINT "process_plan_edges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_plan_edges" ADD CONSTRAINT "process_plan_edges_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "process_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "action_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_subscriptions" ADD CONSTRAINT "wait_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_subscriptions" ADD CONSTRAINT "wait_subscriptions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_commands" ADD CONSTRAINT "case_commands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_commands" ADD CONSTRAINT "case_commands_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_blueprints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process_blueprints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "process_blueprints"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "tenant_process_activations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_process_activations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_process_activations"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "process_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "process_plans"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "process_plan_nodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process_plan_nodes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "process_plan_nodes"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "process_plan_edges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process_plan_edges" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "process_plan_edges"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "action_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "action_intents"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "action_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "action_receipts"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "wait_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wait_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "wait_subscriptions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "case_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_events"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "case_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_commands" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_commands"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
