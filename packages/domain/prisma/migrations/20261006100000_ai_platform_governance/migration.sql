-- Amendment 03 §8–§12 / Phase OPS-2 — AI Platform Governance (Provider-/Modell-Registry, versionierte Profile, Routen, Plattformverbindungen,
-- Health, Usage). Plattformtabellen haben bewusst KEIN tenant_id und sind per RLS an app.platform_scope gebunden (ADR OPS-A4).
-- ai_usage_records ist mandantengebunden (RLS) und im Plattform-Scope lesbar.

CREATE TYPE "AIProviderLifecycle" AS ENUM ('DRAFT', 'VALIDATING', 'ACTIVE', 'DEPRECATED', 'SUSPENDED', 'RETIRED');
CREATE TYPE "AIModelLifecycle" AS ENUM ('VALIDATING', 'APPROVED', 'DEPRECATED', 'BLOCKED', 'RETIRED');
CREATE TYPE "AIModelProfileLifecycle" AS ENUM ('DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED');
CREATE TYPE "AIFallbackMode" AS ENUM ('NO_FALLBACK', 'SAME_PROVIDER_FALLBACK', 'APPROVED_CROSS_PROVIDER_FALLBACK');
CREATE TYPE "AIConnectionLifecycle" AS ENUM ('CONFIGURING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'REVOKED');
CREATE TYPE "AIHealthStatus" AS ENUM ('UP', 'DEGRADED', 'RATE_LIMITED', 'DOWN', 'DISABLED', 'UNKNOWN');

CREATE TABLE "ai_provider_definitions" (
  "provider_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "adapter_key" TEXT NOT NULL,
  "lifecycle" "AIProviderLifecycle" NOT NULL DEFAULT 'DRAFT',
  "supported_credential_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "supported_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "supported_capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "data_policy_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_definitions_pkey" PRIMARY KEY ("provider_key")
);

CREATE TABLE "ai_model_definitions" (
  "id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "provider_model_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "lifecycle" "AIModelLifecycle" NOT NULL DEFAULT 'VALIDATING',
  "capability_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "context_limit" INTEGER,
  "tool_use_supported" BOOLEAN NOT NULL DEFAULT false,
  "structured_output_supported" BOOLEAN NOT NULL DEFAULT false,
  "region_availability" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "data_policy_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "cost_input_per_mtok" DECIMAL(14,6),
  "cost_output_per_mtok" DECIMAL(14,6),
  "cost_currency" TEXT NOT NULL DEFAULT 'EUR',
  "evaluation_status" TEXT NOT NULL DEFAULT 'NONE',
  "approved_at" TIMESTAMP(3),
  "deprecated_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_model_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_model_definitions_evaluation_chk" CHECK ("evaluation_status" IN ('NONE', 'PASSED', 'FAILED'))
);
CREATE UNIQUE INDEX "ai_model_definitions_provider_key_provider_model_id_key" ON "ai_model_definitions"("provider_key", "provider_model_id");
ALTER TABLE "ai_model_definitions" ADD CONSTRAINT "ai_model_definitions_provider_key_fkey" FOREIGN KEY ("provider_key") REFERENCES "ai_provider_definitions"("provider_key") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_model_profiles" (
  "id" TEXT NOT NULL,
  "profile_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "required_capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "fallback_mode" "AIFallbackMode" NOT NULL DEFAULT 'NO_FALLBACK',
  "max_latency_ms" INTEGER,
  "required_data_policy_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lifecycle" "AIModelProfileLifecycle" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_model_profiles_profile_key_version_key" ON "ai_model_profiles"("profile_key", "version");

-- Veröffentlichte Profilversionen sind unveränderlich (Amendment 03 §8.4): erlaubt ist nur der Übergang PUBLISHED -> DEPRECATED.
CREATE FUNCTION "ai_model_profiles_published_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published AI model profile versions cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."profile_key" IS DISTINCT FROM OLD."profile_key"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
     OR NEW."required_capabilities" IS DISTINCT FROM OLD."required_capabilities"
     OR NEW."fallback_mode" IS DISTINCT FROM OLD."fallback_mode"
     OR NEW."max_latency_ms" IS DISTINCT FROM OLD."max_latency_ms"
     OR NEW."required_data_policy_refs" IS DISTINCT FROM OLD."required_data_policy_refs"
     OR (NEW."lifecycle" NOT IN ('PUBLISHED', 'DEPRECATED'))
     OR (OLD."lifecycle" = 'DEPRECATED' AND NEW."lifecycle" <> 'DEPRECATED') THEN
    RAISE EXCEPTION 'Published AI model profile versions are immutable (create a new version instead)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_model_profiles_published_immutable"
  BEFORE UPDATE OR DELETE ON "ai_model_profiles"
  FOR EACH ROW WHEN (OLD."lifecycle" IN ('PUBLISHED', 'DEPRECATED'))
  EXECUTE FUNCTION "ai_model_profiles_published_immutable"();

CREATE TABLE "ai_provider_routes" (
  "id" TEXT NOT NULL,
  "model_profile_key" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "tenant_scope" TEXT,
  "primary_model_id" TEXT NOT NULL,
  "fallback_model_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "fallback_mode" "AIFallbackMode" NOT NULL DEFAULT 'NO_FALLBACK',
  "traffic_percent" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "active_from" TIMESTAMP(3),
  "active_until" TIMESTAMP(3),
  "policy_version" TEXT NOT NULL DEFAULT '1',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_routes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_routes_traffic_chk" CHECK ("traffic_percent" BETWEEN 0 AND 100)
);
CREATE INDEX "ai_provider_routes_model_profile_key_environment_idx" ON "ai_provider_routes"("model_profile_key", "environment");
-- höchstens eine aktive Route je Profil, Umgebung und Mandantenscope (globale Route: tenant_scope IS NULL)
CREATE UNIQUE INDEX "ai_provider_routes_active_uq" ON "ai_provider_routes"("model_profile_key", "environment", COALESCE("tenant_scope", '')) WHERE "active";
ALTER TABLE "ai_provider_routes" ADD CONSTRAINT "ai_provider_routes_primary_model_id_fkey" FOREIGN KEY ("primary_model_id") REFERENCES "ai_model_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_ai_connections" (
  "id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "region_key" TEXT,
  "credential_type" TEXT NOT NULL DEFAULT 'API_KEY',
  "secret_ref" TEXT NOT NULL,
  "lifecycle" "AIConnectionLifecycle" NOT NULL DEFAULT 'CONFIGURING',
  "last_validated_at" TIMESTAMP(3),
  "last_health_status" TEXT,
  "allowed_profile_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_ai_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_ai_connections_secret_ref_chk" CHECK ("secret_ref" ~ '^(vault|env):.+')
);
CREATE UNIQUE INDEX "platform_ai_connections_provider_key_environment_key" ON "platform_ai_connections"("provider_key", "environment");
ALTER TABLE "platform_ai_connections" ADD CONSTRAINT "platform_ai_connections_provider_key_fkey" FOREIGN KEY ("provider_key") REFERENCES "ai_provider_definitions"("provider_key") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_provider_health" (
  "id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "model_ref" TEXT NOT NULL DEFAULT '*',
  "environment" TEXT NOT NULL,
  "status" "AIHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "last_success_at" TIMESTAMP(3),
  "last_failure_at" TIMESTAMP(3),
  "last_error_class" TEXT,
  "avg_latency_ms" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_provider_health_provider_key_model_ref_environment_key" ON "ai_provider_health"("provider_key", "model_ref", "environment");

CREATE TABLE "ai_usage_records" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "profile_key" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "model_id" TEXT,
  "route_id" TEXT,
  "environment" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_class" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "latency_ms" INTEGER,
  "estimated_cost" DECIMAL(14,6),
  "cost_currency" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_usage_records_tenant_id_created_at_idx" ON "ai_usage_records"("tenant_id", "created_at");
CREATE INDEX "ai_usage_records_profile_key_created_at_idx" ON "ai_usage_records"("profile_key", "created_at");
CREATE INDEX "ai_usage_records_provider_key_created_at_idx" ON "ai_usage_records"("provider_key", "created_at");
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BYOK-Absicht (Amendment 03 §10): ab erstem erfolgreichen Verbinden gilt NO_FALLBACK. Bestand: aktuell verbundene Mandanten sind BYOK.
ALTER TABLE "ai_provider_connections" ADD COLUMN "byok_active_since" TIMESTAMP(3);
UPDATE "ai_provider_connections" SET "byok_active_since" = COALESCE("last_tested_at", "updated_at") WHERE "status" = 'CONNECTED';

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_provider_definitions', 'ai_model_definitions', 'ai_model_profiles', 'ai_provider_routes', 'platform_ai_connections', 'ai_provider_health']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY platform_scope ON %I USING (current_setting(''app.platform_scope'', true) = ''on'') WITH CHECK (current_setting(''app.platform_scope'', true) = ''on'')',
      t
    );
  END LOOP;
END $$;

-- Der ORBIT-Managed-Auflösungspfad (Resolver) liest die Registry im Laufzeitkontext eines Mandanten: lesend im Plattform-Scope über einen
-- eng begrenzten Dienstpfad (PrismaService.withPlatformScope), nie über Mandantenclients. Usage wird im Mandantenkontext geschrieben.
ALTER TABLE "ai_usage_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_usage_records"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
