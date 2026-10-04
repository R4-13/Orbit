-- Amendment 02 §12.5 — durable, tenant-bound Mock-CRM records.
CREATE TYPE "MockCrmRecordKind" AS ENUM ('CONTACT', 'COMPANY', 'LEAD', 'ACTIVITY');

CREATE TABLE "mock_crm_records" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "kind" "MockCrmRecordKind" NOT NULL,
  "external_id" TEXT NOT NULL,
  "match_key" TEXT,
  "data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mock_crm_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mock_crm_records_tenant_id_kind_external_id_key" ON "mock_crm_records"("tenant_id", "kind", "external_id");
CREATE INDEX "mock_crm_records_tenant_id_kind_match_key_idx" ON "mock_crm_records"("tenant_id", "kind", "match_key");
ALTER TABLE "mock_crm_records" ADD CONSTRAINT "mock_crm_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: ORBIT already persists mock references (`crm_external_id`) on contacts/companies. Re-create exactly those
-- references as tenant-bound records, derived from the existing, verifiable ORBIT entity — never a wildcard.
INSERT INTO "mock_crm_records" ("id", "tenant_id", "kind", "external_id", "match_key", "data")
SELECT gen_random_uuid()::text, c."tenant_id", 'CONTACT', c."crm_external_id", c."email",
       jsonb_build_object('firstName', c."first_name", 'lastName', c."last_name", 'backfilledFromContactId', c."id")
FROM "contacts" c
WHERE c."crm_external_id" LIKE 'mock-contact-%'
ON CONFLICT DO NOTHING;

INSERT INTO "mock_crm_records" ("id", "tenant_id", "kind", "external_id", "match_key", "data")
SELECT gen_random_uuid()::text, co."tenant_id", 'COMPANY', co."crm_external_id", co."domain",
       jsonb_build_object('name', co."name", 'backfilledFromCompanyId', co."id")
FROM "companies" co
WHERE co."crm_external_id" LIKE 'mock-company-%'
ON CONFLICT DO NOTHING;

ALTER TABLE "mock_crm_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mock_crm_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mock_crm_records"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
