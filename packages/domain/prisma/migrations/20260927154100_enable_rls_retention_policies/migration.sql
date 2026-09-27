ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_policies"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
