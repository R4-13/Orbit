-- Amendment 03 §18 / Phase OPS-5 — Support-Sessions: expliziter, zeitlich begrenzter, scopebasierter Zugriff auf einen Mandanten. Kein dauerhaftes
-- Impersonation-Konto. Plattformtabelle ohne tenant_id (die Mandanten-ID ist ein Verweis, kein Mandantenbesitz), RLS über app.platform_scope.

CREATE TYPE "PlatformSupportSessionStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'EXPIRED', 'REVOKED', 'CLOSED');

CREATE TABLE "platform_support_sessions" (
  "id" TEXT NOT NULL,
  "target_tenant_id" TEXT NOT NULL,
  "operator_user_id" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "free_text_reason" TEXT NOT NULL,
  "ticket_ref" TEXT,
  "mode" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "requested_minutes" INTEGER NOT NULL,
  "status" "PlatformSupportSessionStatus" NOT NULL DEFAULT 'REQUESTED',
  "approved_by_user_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "closed_by_user_id" TEXT,
  "close_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_support_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_support_sessions_mode_chk" CHECK ("mode" IN ('READ_DIAGNOSTICS', 'READ_TENANT_CONTEXT', 'ASSISTED_ACTION')),
  CONSTRAINT "platform_support_sessions_reason_chk" CHECK ("reason_code" IN ('INCIDENT', 'CUSTOMER_REQUEST', 'SECURITY', 'QUALITY')),
  CONSTRAINT "platform_support_sessions_minutes_chk" CHECK ("requested_minutes" BETWEEN 5 AND 1440),
  -- Vier-Augen: wer eine Sitzung genehmigt, ist nie die Person, die sie angefordert hat.
  CONSTRAINT "platform_support_sessions_four_eyes_chk" CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" <> "operator_user_id")
);
CREATE INDEX "platform_support_sessions_target_tenant_id_status_idx" ON "platform_support_sessions"("target_tenant_id", "status");
CREATE INDEX "platform_support_sessions_operator_user_id_status_idx" ON "platform_support_sessions"("operator_user_id", "status");

ALTER TABLE "platform_support_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_support_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_scope ON "platform_support_sessions"
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');
