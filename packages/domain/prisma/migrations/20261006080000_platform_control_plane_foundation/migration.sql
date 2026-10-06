-- Amendment 03 (Platform Operations) / Phase OPS-1 — Sicherheitsdomäne "Plattform".
-- ADR OPS-A1/A3/A4 (docs/PLATFORM_OPERATIONS_IMPLEMENTATION_PLAN.md):
--   * eigene Betreiberidentität ohne Mandantenbezug (platform_users, platform_role_assignments, platform_sessions)
--   * dieselbe Audit-Tabelle für beide Domänen (kein zweiter Audit Store): PLATFORM-Zeilen ohne tenant_id, unveränderlich
--   * Tabellenzugriff der Plattformidentität ist per RLS an den Transaktions-GUC app.platform_scope gebunden
--   * Mandantenrollen dürfen nie wie Plattformrollen heißen (CHECK auf roles.name)

ALTER TYPE "ActorType" ADD VALUE IF NOT EXISTS 'PLATFORM_USER';

CREATE TYPE "AuditDomain" AS ENUM ('TENANT', 'PLATFORM');
CREATE TYPE "PlatformUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- ── Audit: zweite Domäne, gleicher Speicher ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "audit_logs"
  ADD COLUMN "domain" "AuditDomain" NOT NULL DEFAULT 'TENANT',
  ADD COLUMN "actor_platform_user_id" TEXT,
  ADD COLUMN "target_tenant_id" TEXT,
  ADD COLUMN "correlation_id" TEXT,
  ADD COLUMN "support_session_id" TEXT;

-- Genau dann ohne Mandant, wenn Plattformdomäne: kein Mandantenereignis ohne Mandant, kein Betreiberereignis unter einem Mandanten.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_domain_tenant_chk" CHECK (("domain" = 'PLATFORM') = ("tenant_id" IS NULL));

CREATE INDEX "audit_logs_domain_created_at_idx" ON "audit_logs"("domain", "created_at");
CREATE INDEX "audit_logs_target_tenant_id_created_at_idx" ON "audit_logs"("target_tenant_id", "created_at");

DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (
    ("domain" = 'TENANT' AND (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true)))
    OR ("domain" = 'PLATFORM' AND current_setting('app.platform_scope', true) = 'on')
  )
  WITH CHECK (
    ("domain" = 'TENANT' AND (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true)))
    OR ("domain" = 'PLATFORM' AND current_setting('app.platform_scope', true) = 'on')
  );

-- Betreiber-Audit ist unveränderlich (Amendment 03 §19.3): weder UPDATE noch DELETE, auch nicht über die Anwendungsrolle.
CREATE FUNCTION "audit_logs_platform_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Platform audit events are immutable (% on audit_logs)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_platform_immutable"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW WHEN (OLD."domain" = 'PLATFORM')
  EXECUTE FUNCTION "audit_logs_platform_immutable"();

-- ── Mandantenrollen: reservierter Präfix ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "roles" ADD CONSTRAINT "roles_name_not_platform_chk" CHECK (upper("name") NOT LIKE 'PLATFORM\_%' ESCAPE '\');

-- ── Plattformidentität ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "platform_users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "status" "PlatformUserStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_login_at" TIMESTAMP(3),
  "created_by_platform_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

CREATE TABLE "platform_role_assignments" (
  "id" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "granted_by_user_id" TEXT,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_user_id" TEXT,
  CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_role_assignments_role_chk" CHECK ("role" LIKE 'PLATFORM\_%' ESCAPE '\')
);
CREATE INDEX "platform_role_assignments_platform_user_id_idx" ON "platform_role_assignments"("platform_user_id");
-- höchstens eine AKTIVE Zuweisung je Nutzer und Rolle (Historie bleibt über revoked_at erhalten)
CREATE UNIQUE INDEX "platform_role_assignments_active_uq" ON "platform_role_assignments"("platform_user_id", "role") WHERE "revoked_at" IS NULL;
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_user_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_sessions" (
  "id" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "assurance" TEXT NOT NULL DEFAULT 'PASSWORD',
  "step_up_until" TIMESTAMP(3),
  "environment" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_sessions_refresh_token_hash_key" ON "platform_sessions"("refresh_token_hash");
CREATE INDEX "platform_sessions_platform_user_id_idx" ON "platform_sessions"("platform_user_id");
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_user_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: Plattformtabellen sind nur im Plattform-Zugriffspfad sichtbar (Defense in Depth, ADR OPS-A4) ────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_users', 'platform_role_assignments', 'platform_sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY platform_scope ON %I USING (current_setting(''app.platform_scope'', true) = ''on'') WITH CHECK (current_setting(''app.platform_scope'', true) = ''on'')',
      t
    );
  END LOOP;
END $$;
