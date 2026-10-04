-- Amendment 02 section 9/14 - policy actions of the Business Process Framework.
-- Existing tenants only get rows for actions they do not have yet (never touches a tenant's configured mode);
-- new tenants receive them at bootstrap from DEFAULT_POLICY_CONFIG. Safe baseline: customer-facing mail needs approval.
INSERT INTO "policy_configs" ("id", "tenant_id", "action", "mode", "locked", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."id", a."action", a."mode"::"PolicyMode", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('context.lookup', 'AUTONOMOUS'),
  ('requirements.resolve', 'AUTONOMOUS'),
  ('pricing.resolve', 'AUTONOMOUS'),
  ('quote.create', 'AUTONOMOUS'),
  ('quote.render', 'AUTONOMOUS'),
  ('email.send.clarification', 'REQUIRE_APPROVAL'),
  ('email.send.quote_delivery', 'REQUIRE_APPROVAL')
) AS a("action", "mode")
ON CONFLICT ("tenant_id", "action") DO NOTHING;
