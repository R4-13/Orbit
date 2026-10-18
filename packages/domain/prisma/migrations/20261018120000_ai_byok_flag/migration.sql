-- Konzept Flexible Autonomie §8.3 (Entscheidung D1, 18.10.2026): Ein eigener KI-Schlüssel (BYOK) ist eine vom Betreiber je Mandant freigegebene Option, Standard AUS.
-- Das Flag `ai.byok` wird angelegt (AKTIV, Standardwert false, für Mandanten sichtbar, damit die Oberfläche den Zustand zeigen kann).
-- Bestandsschutz: Mandanten, die heute eine aktive eigene Verbindung haben (`byok_active_since` gesetzt), erhalten einen Mandanten-Override AN – ihr Verhalten ändert sich
-- durch die Einführung der Sperre nicht still. Der Betreiber sieht diese Overrides in der Flag-Vorschau je Mandant und kann sie zurücknehmen. Vorhandene Verbindungen und
-- Zugangsdaten werden in keinem Fall gelöscht oder verändert.
INSERT INTO "platform_feature_flags" ("id", "key", "description", "lifecycle", "default_value", "environment_overrides", "cohort_overrides", "tenant_overrides", "owner", "expose_to_tenant", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  'ai.byok',
  'Eigener KI-Schlüssel (BYOK) für einen Mandanten freigegeben. Standard AUS; Freigabe nur durch den Betreiber (Amendment 03 §10, Konzept Flexible Autonomie §8.3).',
  'ACTIVE'::"PlatformFlagLifecycle",
  'false'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('tenantId', c."tenant_id", 'value', true) ORDER BY c."tenant_id")
       FROM "ai_provider_connections" c
      WHERE c."byok_active_since" IS NOT NULL),
    '[]'::jsonb
  ),
  'platform-owner',
  true,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
ON CONFLICT ("key") DO NOTHING;
