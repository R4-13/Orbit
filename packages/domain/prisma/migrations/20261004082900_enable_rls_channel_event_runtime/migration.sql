ALTER TABLE "connector_syncs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_syncs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "connector_syncs"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "intake_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "intake_events"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
