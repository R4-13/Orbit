-- KI-Kosten je Vorgang (BPF-01) und eigene Grenzen je Betrieb (BPF-04)
ALTER TABLE "ai_usage_records" ADD COLUMN "case_id" TEXT;
CREATE INDEX "ai_usage_records_tenant_id_case_id_idx" ON "ai_usage_records"("tenant_id", "case_id");
ALTER TABLE "tenant_profiles" ADD COLUMN "process_limits" JSONB;
