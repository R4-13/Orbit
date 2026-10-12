-- CreateTable
CREATE TABLE "customer_record_watches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL,
    "system" TEXT,
    "external_id" TEXT,
    "origin" TEXT,
    "reason" TEXT,
    "checks" INTEGER NOT NULL DEFAULT 1,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_check_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_record_watches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_record_watches_case_id_key" ON "customer_record_watches"("case_id");

-- CreateIndex
CREATE INDEX "customer_record_watches_tenant_id_status_idx" ON "customer_record_watches"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "customer_record_watches_status_next_check_at_idx" ON "customer_record_watches"("status", "next_check_at");

-- AddForeignKey
ALTER TABLE "customer_record_watches" ADD CONSTRAINT "customer_record_watches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_record_watches" ADD CONSTRAINT "customer_record_watches_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mandantenisolation wie bei allen Mandantentabellen (RLS)
ALTER TABLE "customer_record_watches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_record_watches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_record_watches"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
