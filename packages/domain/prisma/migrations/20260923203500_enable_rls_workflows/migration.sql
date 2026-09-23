-- Orchestrierung (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3): extends the
-- Phase 15 Row-Level Security defense-in-depth line (see
-- 20260921124445_enable_row_level_security/migration.sql for the full
-- rationale) to the four new tables from 20260923203348_add_workflow_definitions
-- — they were created after that one-time migration's table list was
-- fixed, so they never got RLS automatically. Same policy shape as every
-- other tenant-scoped table.

ALTER TABLE "workflow_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_definitions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "workflow_step_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_step_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_step_definitions"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_runs"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "workflow_step_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_step_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_step_runs"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
