-- Passwortablauf und -verlauf (PLT-07)
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3), ADD COLUMN "password_history" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "platform_users" ADD COLUMN "password_changed_at" TIMESTAMP(3), ADD COLUMN "password_history" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
