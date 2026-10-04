-- Amendment 02 reference process - test system-of-record data, communication drafts, quotes, tenant sequences (additive).
-- CreateEnum
CREATE TYPE "CommunicationDraftStatus" AS ENUM ('DRAFT', 'SUPERSEDED', 'SENT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'RENDERED', 'SENT', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "reference_catalog_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "price_tiers" JSONB,
    "attributes" JSONB,
    "source" TEXT NOT NULL DEFAULT 'TEST_SOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_requirement_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fact_key" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'TEST_SOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_requirement_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parent_draft_id" TEXT,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "attachment_document_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_hash" TEXT NOT NULL,
    "thread_id" TEXT,
    "in_reply_to" TEXT,
    "status" "CommunicationDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "price_source" TEXT NOT NULL,
    "document_id" TEXT,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateIndex
CREATE INDEX "reference_catalog_items_tenant_id_category_idx" ON "reference_catalog_items"("tenant_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "reference_catalog_items_tenant_id_sku_key" ON "reference_catalog_items"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "reference_requirement_rules_tenant_id_category_fact_key_key" ON "reference_requirement_rules"("tenant_id", "category", "fact_key");

-- CreateIndex
CREATE INDEX "communication_drafts_tenant_id_case_id_idx" ON "communication_drafts"("tenant_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_drafts_case_id_purpose_version_key" ON "communication_drafts"("case_id", "purpose", "version");

-- CreateIndex
CREATE INDEX "quotes_tenant_id_case_id_idx" ON "quotes"("tenant_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenant_id_number_version_key" ON "quotes"("tenant_id", "number", "version");

-- AddForeignKey
ALTER TABLE "reference_catalog_items" ADD CONSTRAINT "reference_catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_requirement_rules" ADD CONSTRAINT "reference_requirement_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_drafts" ADD CONSTRAINT "communication_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_drafts" ADD CONSTRAINT "communication_drafts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reference_catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_catalog_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reference_catalog_items"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "reference_requirement_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_requirement_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reference_requirement_rules"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "communication_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "communication_drafts"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quotes"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "tenant_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_sequences"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
