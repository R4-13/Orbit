-- Autonomie-Ausbau: neue Regeln für alle bestehenden Mandanten. Die bewusst gewählte Stufe bleibt erhalten:
--   Rückfragen autonom (Ausgewogen oder höher)  => Bestätigung/Statusauskunft und frei geplante Abläufe autonom
--   Angebotsversand autonom (Hochautomatisiert) => zusätzlich Auskunft aus dem Betriebswissen autonom
-- Alles andere bleibt bei der vorsichtigen Grundeinstellung (Freigabe erforderlich). Mandanten ohne diese Hinweise ändern ihr Verhalten nicht.
INSERT INTO "policy_configs" ("id", "tenant_id", "action", "mode", "locked", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."id", a."action",
       CASE
         WHEN a."action" IN ('staff.notify', 'knowledge.answer') THEN 'AUTONOMOUS'
         WHEN a."action" IN ('email.send.acknowledgement', 'process.plan.activate') AND COALESCE(clar."mode"::text, 'REQUIRE_APPROVAL') = 'AUTONOMOUS' THEN 'AUTONOMOUS'
         WHEN a."action" = 'email.send.information' AND COALESCE(quote."mode"::text, 'REQUIRE_APPROVAL') = 'AUTONOMOUS' THEN 'AUTONOMOUS'
         ELSE 'REQUIRE_APPROVAL'
       END::"PolicyMode",
       false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES ('process.plan.activate'), ('email.send.acknowledgement'), ('email.send.information'), ('staff.notify'), ('knowledge.answer')) AS a("action")
LEFT JOIN "policy_configs" clar ON clar."tenant_id" = t."id" AND clar."action" = 'email.send.clarification'
LEFT JOIN "policy_configs" quote ON quote."tenant_id" = t."id" AND quote."action" = 'email.send.quote_delivery'
ON CONFLICT ("tenant_id", "action") DO NOTHING;
