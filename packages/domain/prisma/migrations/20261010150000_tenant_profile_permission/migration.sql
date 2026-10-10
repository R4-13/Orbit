-- Neue Berechtigung tenant.profile.manage für bestehende Mandanten: Rollen speichern ihre Berechtigungen als Zeilen (nicht aus dem Code abgeleitet),
-- neue Mandanten erhalten sie beim Anlegen. Nur die Rollen, die in DEFAULT_ROLE_PERMISSIONS alle Berechtigungen außer TENANT_MANAGE tragen.
INSERT INTO "role_permissions" ("id", "role_id", "permission")
SELECT gen_random_uuid()::text, r."id", 'tenant.profile.manage'
FROM "roles" r
WHERE r."name" IN ('TENANT_ADMIN', 'SYSTEM_ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id" AND rp."permission" = 'tenant.profile.manage');
