-- Prüfung hochgeladener Dateien an ihren Bytes (MST-09)
ALTER TABLE "documents" ADD COLUMN "verification_status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "documents" ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "verification_note" TEXT;
