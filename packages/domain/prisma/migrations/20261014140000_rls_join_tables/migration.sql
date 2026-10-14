-- Mandantenisolation auch für Tabellen ohne eigene tenant_id (MST-13): sie erreichen ihren Mandanten über die Elterntabelle
-- (roles.tenant_id bzw. users.tenant_id). Dieselbe Regel wie bei allen Mandantentabellen: nur mit gesetztem app.tenant_id des Elternteils oder mit app.bypass_rls
-- (Anmeldung, Mandantenanlage, Seed). Ohne Kontext sieht eine Abfrage keine Zeile (fail closed).

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permissions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_permissions"."role_id" AND r."tenant_id" = current_setting('app.tenant_id', true)))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_permissions"."role_id" AND r."tenant_id" = current_setting('app.tenant_id', true)));

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_roles"
  USING (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "user_roles"."user_id" AND u."tenant_id" = current_setting('app.tenant_id', true)))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "user_roles"."user_id" AND u."tenant_id" = current_setting('app.tenant_id', true)));

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "refresh_tokens"
  USING (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "refresh_tokens"."user_id" AND u."tenant_id" = current_setting('app.tenant_id', true)))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "refresh_tokens"."user_id" AND u."tenant_id" = current_setting('app.tenant_id', true)));
