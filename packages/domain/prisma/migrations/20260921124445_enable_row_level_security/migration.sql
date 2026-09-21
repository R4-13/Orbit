-- Phase 15 (Security Hardening): Postgres Row-Level Security as a
-- database-level defense-in-depth line beneath the existing
-- application-layer tenant scoping (packages/domain/src/tenant-scope.ts,
-- ASSUMPTIONS #21, which explicitly deferred this to Phase 15).
--
-- Every table listed below has its own `tenant_id` column and is enabled
-- with FORCE ROW LEVEL SECURITY, so RLS applies even to the table-owning
-- application role (Postgres normally exempts table owners from RLS).
-- A single policy per table allows a row when either:
--   (a) `app.tenant_id` (a per-transaction session GUC, set via
--       `set_config(..., true)` = SET LOCAL semantics) matches the row's
--       tenant_id — the normal, tenant-scoped path used by
--       packages/domain/src/tenant-scope.ts's `forTenant()` extension; or
--   (b) `app.bypass_rls` is explicitly set to 'on' for that transaction —
--       used only by the small set of genuinely cross-tenant operations
--       that must run before a tenant/session context exists: tenant
--       bootstrap (TenantsService.bootstrapTenant), login/refresh/logout
--       (AuthService, which must look up a user/refresh token by a
--       tenant-independent key before it knows the tenant), and the
--       demo-data seed script.
--
-- Both session GUCs default to NULL/unset when not explicitly set, and an
-- unset `app.tenant_id` never equals any real tenant_id — so any query
-- path that forgets to go through forTenant()/the bypass helper sees
-- ZERO rows (fails closed) rather than leaking another tenant's data.
--
-- Deliberately NOT applied to role_permissions, user_roles or
-- refresh_tokens: none of those three tables has its own tenant_id
-- column (they reach their tenant only indirectly, via roles.tenant_id /
-- users.tenant_id) — see docs/ASSUMPTIONS.md Phase 15 for the reasoning
-- and the accepted scope boundary.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_runs', 'approvals', 'audit_logs', 'booking_proposals', 'cases',
    'companies', 'contacts', 'documents', 'email_messages', 'finance_transfers',
    'integrations', 'invoices', 'leads', 'meetings', 'opportunities',
    'policy_configs', 'roles', 'suppliers', 'tasks', 'tool_invocations', 'users'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I ' ||
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = current_setting(''app.tenant_id'', true)) ' ||
      'WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
