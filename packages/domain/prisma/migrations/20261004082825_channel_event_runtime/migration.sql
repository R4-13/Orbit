-- CreateEnum
CREATE TYPE "ConnectorSyncMode" AS ENUM ('WEBHOOK', 'POLLING', 'ON_DEMAND', 'BATCH');

-- CreateEnum
CREATE TYPE "ConnectorSyncStatus" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntakeChannel" AS ENUM ('EMAIL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "IntakeRelevance" AS ENUM ('BUSINESS_ACTIONABLE', 'BUSINESS_INFORMATIONAL', 'NON_ACTIONABLE', 'PRIVATE_PERSONAL', 'UNKNOWN_REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "IntakeEventStatus" AS ENUM ('RECEIVED', 'TRIAGED', 'ROUTED', 'PROCESSING', 'COMPLETED', 'SKIPPED_NON_ACTIONABLE', 'NEEDS_REVIEW', 'FAILED');

-- CreateTable
CREATE TABLE "connector_syncs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "connector_type" "IntegrationConnectorType" NOT NULL,
    "sync_mode" "ConnectorSyncMode" NOT NULL,
    "cursor" TEXT,
    "status" "ConnectorSyncStatus" NOT NULL DEFAULT 'IDLE',
    "last_attempt_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "channel" "IntakeChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "sender_ref" JSONB,
    "recipient_refs" JSONB,
    "subject" TEXT,
    "email_message_id" TEXT,
    "document_ids" TEXT[],
    "relevance" "IntakeRelevance",
    "domain_category" TEXT,
    "case_id" TEXT,
    "workflow_run_id" TEXT,
    "status" "IntakeEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connector_syncs_connection_id_key" ON "connector_syncs"("connection_id");

-- CreateIndex
CREATE INDEX "connector_syncs_tenant_id_next_run_at_idx" ON "connector_syncs"("tenant_id", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_events_email_message_id_key" ON "intake_events"("email_message_id");

-- CreateIndex
CREATE INDEX "intake_events_tenant_id_status_idx" ON "intake_events"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "intake_events_tenant_id_created_at_idx" ON "intake_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_events_tenant_id_provider_external_event_id_key" ON "intake_events"("tenant_id", "provider", "external_event_id");

-- AddForeignKey
ALTER TABLE "connector_syncs" ADD CONSTRAINT "connector_syncs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_syncs" ADD CONSTRAINT "connector_syncs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_events" ADD CONSTRAINT "intake_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_events" ADD CONSTRAINT "intake_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_events" ADD CONSTRAINT "intake_events_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_events" ADD CONSTRAINT "intake_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_events" ADD CONSTRAINT "intake_events_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
