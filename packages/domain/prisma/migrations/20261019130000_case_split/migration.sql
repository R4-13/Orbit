-- FX-02 / FX-06 (Konzept Flexible Autonomie ADD-3.1/3.3, Entscheidung D8): Teilvorgänge einer Nachricht mit mehreren Anliegen. Die Beziehung zum Hauptvorgang ist eine eigene Spalte,
-- weil sie sonst nicht zuverlässig abfragbar und referenzgesichert abbildbar wäre (Governance §5.3, begründet in docs/ASSUMPTIONS.md #624).
ALTER TABLE "cases" ADD COLUMN "parent_case_id" TEXT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_parent_case_id_fkey" FOREIGN KEY ("parent_case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cases_tenant_id_parent_case_id_idx" ON "cases"("tenant_id", "parent_case_id");

-- Das Flag `process.split` legt fest, für welche Mandanten Nachrichten mit mehreren Anliegen in Teilvorgänge aufgeteilt werden. Standard AUS; nur der Betreiber schaltet es je Mandant ein.
INSERT INTO "platform_feature_flags" ("id", "key", "description", "lifecycle", "default_value", "environment_overrides", "cohort_overrides", "tenant_overrides", "owner", "expose_to_tenant", "version", "created_at", "updated_at")
VALUES (
  gen_random_uuid()::text,
  'process.split',
  'Aufteilung einer Nachricht mit mehreren Anliegen in verknüpfte Teilvorgänge (Konzept Flexible Autonomie ADD-3.1). Standard AUS.',
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
