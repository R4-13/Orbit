-- Amendment 02 section 7/12/13 - Universal Case (additive), append-only case facts, case correlation.
ALTER TYPE "CaseType" ADD VALUE IF NOT EXISTS 'GENERAL';

CREATE TYPE "CaseOrchestrationStatus" AS ENUM ('RECEIVED', 'READY', 'IN_PROGRESS', 'WAITING_FOR_INFORMATION', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_EXTERNAL_SYSTEM', 'PAUSED', 'MANUAL_REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED');
CREATE TYPE "CaseFactStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'CONFLICTED', 'STALE', 'REJECTED');
CREATE TYPE "CaseFactSourceType" AS ENUM ('EMAIL', 'ATTACHMENT', 'SYSTEM_OF_RECORD', 'CONFIGURATION', 'HUMAN');
CREATE TYPE "CaseCorrelationStatus" AS ENUM ('MATCHED', 'AMBIGUOUS', 'NONE', 'OVERRIDDEN');

ALTER TABLE "cases"
  ADD COLUMN "orchestration_status" "CaseOrchestrationStatus" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "business_goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "current_intent" TEXT,
  ADD COLUMN "attention_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "blueprint_key" TEXT,
  ADD COLUMN "blueprint_version" TEXT,
  ADD COLUMN "outcome" JSONB,
  ADD COLUMN "completed_at" TIMESTAMP(3);

-- Backfill ONLY from what the existing simple status really says; nothing becomes "completed" unless it was DONE.
UPDATE "cases" SET "orchestration_status" = CASE "status"
  WHEN 'OPEN' THEN 'RECEIVED'::"CaseOrchestrationStatus"
  WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"CaseOrchestrationStatus"
  WHEN 'WAITING_APPROVAL' THEN 'WAITING_FOR_APPROVAL'::"CaseOrchestrationStatus"
  WHEN 'DONE' THEN 'COMPLETED'::"CaseOrchestrationStatus"
  WHEN 'CANCELLED' THEN 'CANCELLED'::"CaseOrchestrationStatus"
END;

CREATE INDEX "cases_tenant_id_orchestration_status_idx" ON "cases"("tenant_id", "orchestration_status");

CREATE TABLE "case_facts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "value_schema_ref" TEXT,
  "unit" TEXT,
  "currency" TEXT,
  "status" "CaseFactStatus" NOT NULL,
  "source_type" "CaseFactSourceType" NOT NULL,
  "source_ref" TEXT,
  "evidence_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_as_of" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "confidence" DOUBLE PRECISION,
  "verified_by" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "supersedes_fact_id" TEXT,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "sensitivity" TEXT,
  "retention_class" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_facts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "case_facts_tenant_id_case_id_key_is_current_idx" ON "case_facts"("tenant_id", "case_id", "key", "is_current");
CREATE INDEX "case_facts_case_id_is_current_idx" ON "case_facts"("case_id", "is_current");
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "case_correlations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "email_message_id" TEXT NOT NULL,
  "case_id" TEXT,
  "status" "CaseCorrelationStatus" NOT NULL,
  "rule" TEXT NOT NULL,
  "candidate_case_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_correlations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "case_correlations_email_message_id_key" ON "case_correlations"("email_message_id");
CREATE INDEX "case_correlations_tenant_id_case_id_idx" ON "case_correlations"("tenant_id", "case_id");
ALTER TABLE "case_correlations" ADD CONSTRAINT "case_correlations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_correlations" ADD CONSTRAINT "case_correlations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "case_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_facts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_facts"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "case_correlations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_correlations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_correlations"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
