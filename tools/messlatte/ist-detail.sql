-- Messlatte (Ist-Zustand), Detailansicht je Vorgang seit :since, nur lesend. Aufruf wie ist-bericht.sql.
\pset pager off
\echo '=== Plan-Schritte je Vorgang ==='
SELECT left(c.id, 8) AS vorgang, p.revision AS rev, p.status AS plan, p.source AS quelle, n.node_key AS schritt, n.type, n.state, coalesce(n.error_code, '') AS fehler,
       coalesce(n.execution_mode, '') AS modus
FROM cases c
JOIN tenants t ON t.id = c.tenant_id AND t.slug = :slug
JOIN process_plans p ON p.case_id = c.id
JOIN process_plan_nodes n ON n.plan_id = p.id
WHERE c.created_at >= :since::timestamp
ORDER BY c.created_at, p.revision, n.node_key;

\echo '=== Entwürfe (Kundentexte) ==='
SELECT left(c.id, 8) AS vorgang, d.purpose, d.status, left(d.subject, 40) AS betreff, left(replace(d.body_text, E'\n', ' / '), 220) AS text
FROM communication_drafts d JOIN cases c ON c.id = d.case_id JOIN tenants t ON t.id = c.tenant_id AND t.slug = :slug
WHERE c.created_at >= :since::timestamp ORDER BY c.created_at, d.created_at;

\echo '=== Aufgaben ==='
SELECT left(c.id, 8) AS vorgang, k.status, k.source, left(k.title, 70) AS titel
FROM tasks k JOIN cases c ON c.id = k.case_id JOIN tenants t ON t.id = c.tenant_id AND t.slug = :slug
WHERE c.created_at >= :since::timestamp ORDER BY c.created_at, k.created_at;

\echo '=== Aufmerksamkeit / Hinweise ==='
SELECT left(c.id, 8) AS vorgang, a.kind, a.responsibility AS zustaendig, a.emergency AS notfall, a.state, left(coalesce(a.reason, ''), 90) AS grund
FROM attention_items a JOIN cases c ON c.id = a.case_id JOIN tenants t ON t.id = c.tenant_id AND t.slug = :slug
WHERE c.created_at >= :since::timestamp ORDER BY c.created_at;

\echo '=== Offene Hinweise im Vorgang (attention_reasons) ==='
SELECT left(c.id, 8) AS vorgang, c.orchestration_status AS orch, array_to_string(c.attention_reasons, ' | ') AS hinweise, c.business_goals AS ziele
FROM cases c JOIN tenants t ON t.id = c.tenant_id AND t.slug = :slug
WHERE c.created_at >= :since::timestamp ORDER BY c.created_at;

\echo '=== Einstufung je Eingang (Triage) ==='
SELECT to_char((m.received_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS zeit, left(m.subject, 30) AS betreff, d.status AS entscheidung, d.applied_relevance AS relevanz,
       coalesce(d.result->>'category', '-') AS kategorie, coalesce(d.result->>'urgency', '-') AS dringlichkeit, coalesce(d.result->>'senderRoleHypothesis', '-') AS absender_rolle,
       coalesce(d.result->'riskFlags'::text, '[]'::jsonb)::text AS risiko, left(coalesce(d.result->>'conciseReason', d.failure_reason, ''), 150) AS begruendung
FROM email_messages m JOIN tenants t ON t.id = m.tenant_id AND t.slug = :slug
LEFT JOIN intake_events ie ON ie.email_message_id = m.id LEFT JOIN intake_decisions d ON d.intake_event_id = ie.id
WHERE m.direction = 'INBOUND' AND m.created_at >= :since::timestamp ORDER BY m.received_at;
