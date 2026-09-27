-- CreateEnum
CREATE TYPE "RetentionCategory" AS ENUM ('AGENT_RUNS', 'TOOL_INVOCATIONS');

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_tenant_id_category_key" ON "retention_policies"("tenant_id", "category");

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
