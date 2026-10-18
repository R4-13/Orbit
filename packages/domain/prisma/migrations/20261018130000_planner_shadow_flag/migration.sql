-- Konzept Flexible Autonomie §9 Schritt 1 (Schattenbetrieb): Das Flag `planner.shadow` legt fest, für welche Mandanten der freie Planer zu Vorgängen des bisherigen Wegs
-- mitplant, ohne etwas auszuführen. Standard AUS; nur der Betreiber schaltet es je Mandant ein (Mandanten-Override). Für Mandanten nicht sichtbar.
INSERT INTO "platform_feature_flags" ("id", "key", "description", "lifecycle", "default_value", "environment_overrides", "cohort_overrides", "tenant_overrides", "owner", "expose_to_tenant", "version", "created_at", "updated_at")
VALUES (
  gen_random_uuid()::text,
  'planner.shadow',
  'Schattenbetrieb des Vorgangs-Agenten: der freie Planer plant zu Vorgängen des bisherigen Wegs mit und bewertet den Plan, führt aber nichts aus (Konzept Flexible Autonomie §9 Schritt 1). Standard AUS.',
  'ACTIVE'::"PlatformFlagLifecycle",
  'false'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'platform-owner',
  false,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
