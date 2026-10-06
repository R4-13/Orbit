-- Amendment 03 §20: Plattform-Secrets (ORBIT-Managed-Zugangsdaten) liegen verschluesselt hinter einer Referenz, nie in Konfigurationstabellen.
-- Gleiche Verschluesselung wie der Mandanten-Tresor (CredentialEncryptionService, AES-256-GCM); eigene Tabelle, weil dort tenant_id Pflicht ist.
CREATE TABLE "platform_secrets" (
  "id" TEXT NOT NULL,
  "encrypted_value" BYTEA NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "platform_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_secrets" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_scope ON "platform_secrets"
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');
