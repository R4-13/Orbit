-- CreateEnum
CREATE TYPE "AIProviderKey" AS ENUM ('ANTHROPIC', 'OPENAI');

-- CreateEnum
CREATE TYPE "AIProviderConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "ai_provider_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_key" "AIProviderKey" NOT NULL,
    "status" "AIProviderConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "encrypted_credentials" BYTEA,
    "model" TEXT,
    "last_tested_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_connections_tenant_id_key" ON "ai_provider_connections"("tenant_id");

-- AddForeignKey
ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
