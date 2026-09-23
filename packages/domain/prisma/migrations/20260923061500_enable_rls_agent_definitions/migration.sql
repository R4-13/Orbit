-- Agenten-Konfiguration (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1):
-- extends the Phase 15 Row-Level Security defense-in-depth line (see
-- 20260921124445_enable_row_level_security/migration.sql for the full
-- rationale) to the two new tables from
-- 20260923061319_add_agent_definitions — they were created after that
-- one-time migration's table list was fixed, so they never got RLS
-- automatically. Same policy shape as every other tenant-scoped table.

ALTER TABLE "agent_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_definitions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "agent_definition_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_definition_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_definition_versions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
