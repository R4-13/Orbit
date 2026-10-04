-- Amendment 02 §5/§6/§19 — Intake Decision (semantic triage outcome), PENDING_TRIAGE status.
ALTER TYPE "IntakeEventStatus" ADD VALUE IF NOT EXISTS 'PENDING_TRIAGE';

CREATE TYPE "IntakeDecisionStatus" AS ENUM ('DECIDED', 'PENDING_TRIAGE', 'REVIEW_REQUIRED', 'OVERRIDDEN');

CREATE TABLE "intake_decisions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "intake_event_id" TEXT NOT NULL,
  "status" "IntakeDecisionStatus" NOT NULL,
  "result" JSONB,
  "applied_relevance" "IntakeRelevance",
  "failure_reason" TEXT,
  "execution" JSONB,
  "hints" JSONB,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "reviewed_by_user_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "previous_relevance" "IntakeRelevance",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intake_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intake_decisions_intake_event_id_key" ON "intake_decisions"("intake_event_id");
CREATE INDEX "intake_decisions_tenant_id_status_idx" ON "intake_decisions"("tenant_id", "status");
CREATE INDEX "intake_decisions_tenant_id_applied_relevance_idx" ON "intake_decisions"("tenant_id", "applied_relevance");
ALTER TABLE "intake_decisions" ADD CONSTRAINT "intake_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_decisions" ADD CONSTRAINT "intake_decisions_intake_event_id_fkey" FOREIGN KEY ("intake_event_id") REFERENCES "intake_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "intake_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "intake_decisions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
