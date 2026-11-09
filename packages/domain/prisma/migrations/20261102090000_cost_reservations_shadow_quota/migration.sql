-- Pilotvorbereitung: (1) Kostenreservierungen für laufende KI-Aufrufe (durchgesetztes Kostenlimit rechnet Verbrauch plus offene Aufrufe),
-- (2) zusätzliches Schattenplanungs-Kontingent als protokollierte Entscheidung (Ausgangszustand INACTIVE; der bisherige Zähler bleibt unberührt).

CREATE TABLE "ai_cost_reservations" (
  "id" TEXT NOT NULL,
  "target_tenant_id" TEXT NOT NULL,
  "profile_key" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(14,6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "released_at" TIMESTAMP(3),
  CONSTRAINT "ai_cost_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_cost_reservations_status_chk" CHECK ("status" IN ('RESERVED', 'RELEASED')),
  CONSTRAINT "ai_cost_reservations_amount_chk" CHECK ("amount" >= 0)
);
CREATE INDEX "ai_cost_reservations_status_expires_at_idx" ON "ai_cost_reservations"("status", "expires_at");
CREATE INDEX "ai_cost_reservations_target_tenant_id_status_idx" ON "ai_cost_reservations"("target_tenant_id", "status");
ALTER TABLE "ai_cost_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_cost_reservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_scope ON "ai_cost_reservations"
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

CREATE TABLE "shadow_quota_grants" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "decided_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INACTIVE',
  "activated_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shadow_quota_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shadow_quota_grants_status_chk" CHECK ("status" IN ('INACTIVE', 'ACTIVE', 'REVOKED')),
  CONSTRAINT "shadow_quota_grants_amount_chk" CHECK ("amount" >= 1 AND "amount" <= 100)
);
CREATE INDEX "shadow_quota_grants_tenant_id_status_idx" ON "shadow_quota_grants"("tenant_id", "status");
ALTER TABLE "shadow_quota_grants" ADD CONSTRAINT "shadow_quota_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shadow_quota_ledger" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "grant_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "case_event_id" TEXT,
  "kind" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shadow_quota_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shadow_quota_ledger_kind_chk" CHECK ("kind" IN ('FIRST', 'REPEAT')),
  CONSTRAINT "shadow_quota_ledger_state_chk" CHECK ("state" IN ('RESERVED', 'DONE', 'UNAVAILABLE'))
);
CREATE UNIQUE INDEX "shadow_quota_ledger_tenant_id_case_id_attempt_key" ON "shadow_quota_ledger"("tenant_id", "case_id", "attempt");
CREATE INDEX "shadow_quota_ledger_grant_id_idx" ON "shadow_quota_ledger"("grant_id");
ALTER TABLE "shadow_quota_ledger" ADD CONSTRAINT "shadow_quota_ledger_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "shadow_quota_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mandantenisolation wie bei allen Mandantentabellen (RLS)
ALTER TABLE "shadow_quota_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shadow_quota_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shadow_quota_grants"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "shadow_quota_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shadow_quota_ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shadow_quota_ledger"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
