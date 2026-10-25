-- Meilenstein B: der Lead merkt sich seinen CRM-Bezug und den Stand des Abgleichs
ALTER TABLE "leads" ADD COLUMN "crm_external_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "crm_sync_state" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "leads" ADD COLUMN "crm_synced_hash" TEXT;
ALTER TABLE "leads" ADD COLUMN "crm_synced_title" TEXT;
ALTER TABLE "leads" ADD COLUMN "crm_synced_text" TEXT;
ALTER TABLE "leads" ADD COLUMN "crm_synced_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "crm_sync_error" TEXT;
ALTER TABLE "leads" ADD COLUMN "crm_sync_locked_until" TIMESTAMP(3);
