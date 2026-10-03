ALTER TABLE "integration_credential_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_credential_secrets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_credential_secrets"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
