-- Zweiter Faktor (TOTP) fuer Plattformzugaenge (PLT-02)
ALTER TABLE "platform_users" ADD COLUMN "mfa_secret_enc" BYTEA, ADD COLUMN "mfa_enabled_at" TIMESTAMP(3), ADD COLUMN "mfa_last_step" INTEGER, ADD COLUMN "mfa_recovery_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
