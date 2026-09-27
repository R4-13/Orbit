ALTER TABLE "agent_evaluation_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_evaluation_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_evaluation_cases"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
