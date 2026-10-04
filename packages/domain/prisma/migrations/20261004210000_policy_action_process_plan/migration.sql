-- Amendment 02 section 11 - policy action for the AI process planner (default AUTONOMOUS: planning has no effect; every action in a plan stays policy-gated).
INSERT INTO "policy_configs" ("id", "tenant_id", "action", "mode", "locked", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."id", 'process.plan', 'AUTONOMOUS'::"PolicyMode", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
ON CONFLICT ("tenant_id", "action") DO NOTHING;
