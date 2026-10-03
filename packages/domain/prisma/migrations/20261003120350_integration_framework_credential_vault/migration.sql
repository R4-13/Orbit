/*
  Warnings:

  - You are about to drop the column `encrypted_credentials` on the `integrations` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationStatus" ADD VALUE 'CONNECTING';
ALTER TYPE "IntegrationStatus" ADD VALUE 'DEGRADED';
ALTER TYPE "IntegrationStatus" ADD VALUE 'AUTH_REQUIRED';

-- AlterTable
ALTER TABLE "integrations" DROP COLUMN "encrypted_credentials",
ADD COLUMN     "credential_reference" TEXT,
ADD COLUMN     "external_account_display_name" TEXT,
ADD COLUMN     "external_account_id" TEXT,
ADD COLUMN     "granted_capabilities" JSONB,
ADD COLUMN     "last_error_at" TIMESTAMP(3),
ADD COLUMN     "last_error_code" TEXT,
ADD COLUMN     "last_success_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "integration_credential_secrets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "encrypted_value" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credential_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_credential_secrets_tenant_id_idx" ON "integration_credential_secrets"("tenant_id");

-- AddForeignKey
ALTER TABLE "integration_credential_secrets" ADD CONSTRAINT "integration_credential_secrets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
