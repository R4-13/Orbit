-- Amendment 03 §12.3 — Kosten-Leitplanken der KI-Nutzung (Warnung, Soft-Limit, Hard-Limit) je Plattform, Mandant oder Profil.
-- Plattformtabelle ohne tenant_id (Verweis, kein Mandantenbesitz), RLS über app.platform_scope.

CREATE TABLE "ai_cost_limits" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "target_tenant_id" TEXT,
  "profile_key" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "warn_amount" DECIMAL(14,2),
  "soft_amount" DECIMAL(14,2),
  "hard_amount" DECIMAL(14,2),
  "hard_enforced" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "note" TEXT,
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_cost_limits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_cost_limits_scope_chk" CHECK ("scope" IN ('GLOBAL', 'TENANT', 'PROFILE')),
  CONSTRAINT "ai_cost_limits_target_chk" CHECK (
    ("scope" = 'GLOBAL' AND "target_tenant_id" IS NULL AND "profile_key" IS NULL) OR
    ("scope" = 'TENANT' AND "target_tenant_id" IS NOT NULL AND "profile_key" IS NULL) OR
    ("scope" = 'PROFILE' AND "profile_key" IS NOT NULL AND "target_tenant_id" IS NULL)
  ),
  CONSTRAINT "ai_cost_limits_amounts_chk" CHECK (
    ("warn_amount" IS NULL OR "warn_amount" > 0) AND ("soft_amount" IS NULL OR "soft_amount" > 0) AND ("hard_amount" IS NULL OR "hard_amount" > 0) AND
    ("warn_amount" IS NOT NULL OR "soft_amount" IS NOT NULL OR "hard_amount" IS NOT NULL) AND
    ("warn_amount" IS NULL OR "soft_amount" IS NULL OR "warn_amount" < "soft_amount") AND
    ("soft_amount" IS NULL OR "hard_amount" IS NULL OR "soft_amount" < "hard_amount") AND
    ("warn_amount" IS NULL OR "hard_amount" IS NULL OR "warn_amount" < "hard_amount")
  ),
  CONSTRAINT "ai_cost_limits_enforced_chk" CHECK ("hard_enforced" = false OR "hard_amount" IS NOT NULL)
);
CREATE UNIQUE INDEX "ai_cost_limits_scope_key_key" ON "ai_cost_limits"("scope_key");

ALTER TABLE "ai_cost_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_cost_limits" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_scope ON "ai_cost_limits"
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');
