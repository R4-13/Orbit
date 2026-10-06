-- Amendment 03 §6, §13–§15 / Phase OPS-3 — Mandantenlebenszyklus mit feingranularen Sperren, Feature Flags, Kill Switches, Connector-Lifecycle.
-- Plattformtabellen ohne tenant_id, per RLS an app.platform_scope gebunden (ADR OPS-A4).

ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'PROVISIONING';
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'OFFBOARDING';
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

CREATE TYPE "PlatformFlagLifecycle" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'RETIRED');
CREATE TYPE "PlatformConnectorLifecycle" AS ENUM ('DRAFT', 'TESTING', 'ACTIVE', 'DEPRECATED', 'SUSPENDED', 'RETIRED');

-- Mandant: Kohorten (Rollouts) und Sperrarten (LOGIN, AUTOMATION, CONNECTORS, BILLING, SECURITY_QUARANTINE). Der Lebenszyklus bleibt `status`.
ALTER TABLE "tenants"
  ADD COLUMN "feature_cohorts" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "suspension_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lifecycle_note" TEXT;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_suspension_scopes_chk"
  CHECK ("suspension_scopes" <@ ARRAY['LOGIN', 'AUTOMATION', 'CONNECTORS', 'BILLING', 'SECURITY_QUARANTINE']::TEXT[]);

CREATE TABLE "platform_feature_flags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "lifecycle" "PlatformFlagLifecycle" NOT NULL DEFAULT 'DRAFT',
  "default_value" JSONB NOT NULL,
  "environment_overrides" JSONB NOT NULL DEFAULT '[]',
  "cohort_overrides" JSONB NOT NULL DEFAULT '[]',
  "tenant_overrides" JSONB NOT NULL DEFAULT '[]',
  "owner" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "expose_to_tenant" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_feature_flags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_feature_flags_key_chk" CHECK ("key" ~ '^[a-z][a-z0-9_.-]{2,80}$')
);
CREATE UNIQUE INDEX "platform_feature_flags_key_key" ON "platform_feature_flags"("key");

CREATE TABLE "platform_kill_switches" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "engaged" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "changed_by_user_id" TEXT,
  "changed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_kill_switches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_kill_switches_key_key" ON "platform_kill_switches"("key");

-- Governance-Overlay auf dem EINEN Connector-Katalog (integration-core CONNECTOR_REGISTRY): keine zweite Registry. Ohne Zeile gilt ACTIVE (verhaltenserhaltend).
CREATE TABLE "platform_connector_definitions" (
  "id" TEXT NOT NULL,
  "connector_key" TEXT NOT NULL,
  "lifecycle" "PlatformConnectorLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT,
  "data_policy_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "changed_by_user_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_connector_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_connector_definitions_connector_key_key" ON "platform_connector_definitions"("connector_key");

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_feature_flags', 'platform_kill_switches', 'platform_connector_definitions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY platform_scope ON %I USING (current_setting(''app.platform_scope'', true) = ''on'') WITH CHECK (current_setting(''app.platform_scope'', true) = ''on'')',
      t
    );
  END LOOP;
END $$;

-- Der Laufzeitpfad liest Kill Switches, Connector-Zustand und Flags in eng begrenzten Diensten (PlatformControlService) im Plattform-Scope.
