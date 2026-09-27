ALTER TABLE "ai_provider_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_provider_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_provider_connections"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
