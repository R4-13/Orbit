ALTER TABLE "tenant_brandings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_brandings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_brandings"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
