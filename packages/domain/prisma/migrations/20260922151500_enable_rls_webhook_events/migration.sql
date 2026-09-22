-- Phase 19g (Security detail work): extends the Phase 15 Row-Level
-- Security defense-in-depth line (see
-- 20260921124445_enable_row_level_security/migration.sql for the full
-- rationale) to the new `webhook_events` table — it was created after
-- that one-time migration's table list was fixed, so it never got RLS
-- automatically. Same policy shape as every other tenant-scoped table.

ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_events"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
