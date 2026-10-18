-- Messlatte (Ist-Zustand), nur lesend. Aufruf:
--   docker exec -i orbit-postgres psql -U orbit -d orbit -v since="'2026-10-18 17:00:00'" -v slug="'musterwerk'" -f - < tools/messlatte/ist-bericht.sql
-- Zeigt je eingegangener Mail (seit :since) Einstufung, Vorgang, Bearbeitungsweg, Ergebnis und Wirkung nach außen.
\pset pager off
\pset format aligned
\echo '=== Eingänge und Vorgänge ==='
SELECT to_char((m.received_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin', 'HH24:MI:SS') AS eingang,
       left(m.subject, 34)                                             AS betreff,
       ie.relevance                                                    AS relevanz,
       ie.domain_category                                              AS kategorie,
       ie.status                                                       AS eingang_status,
       left(c.id, 8)                                                   AS vorgang,
       c.status                                                        AS status,
       c.orchestration_status                                          AS orch,
       CASE WHEN c.blueprint_key IS NOT NULL THEN 'ENGINE:' || c.blueprint_key
            WHEN EXISTS (SELECT 1 FROM process_plans p WHERE p.case_id = c.id) THEN 'ENGINE:frei'
            WHEN EXISTS (SELECT 1 FROM workflow_runs w WHERE w.case_id = c.id) THEN 'ALT'
            ELSE '-' END                                               AS weg,
       (SELECT count(*) FROM email_messages o WHERE o.case_id = c.id AND o.direction = 'OUTBOUND') AS mails_aus,
       (SELECT count(*) FROM tasks t WHERE t.case_id = c.id)           AS aufgaben,
       (SELECT count(*) FROM ai_usage_records u WHERE u.case_id = c.id) AS ki_aufrufe
FROM email_messages m
JOIN tenants t ON t.id = m.tenant_id AND t.slug = :slug
LEFT JOIN intake_events ie ON ie.email_message_id = m.id
LEFT JOIN cases c ON c.id = COALESCE(m.case_id, ie.case_id)
WHERE m.direction = 'INBOUND' AND m.created_at >= :since::timestamp
ORDER BY m.received_at;

\echo '=== Ausgehende Nachrichten seit Beginn ==='
SELECT to_char((m.sent_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin', 'HH24:MI:SS') AS gesendet,
       left(c.id, 8) AS vorgang, array_to_string(m.to_addresses, ',') AS an, left(m.subject, 50) AS betreff
FROM email_messages m
JOIN tenants t ON t.id = m.tenant_id AND t.slug = :slug
LEFT JOIN cases c ON c.id = m.case_id
WHERE m.direction = 'OUTBOUND' AND m.created_at >= :since::timestamp
ORDER BY m.sent_at;

\echo '=== KI-Aufrufe und Token seit Beginn ==='
SELECT profile_key, count(*) AS aufrufe, sum(input_tokens) AS eingabe, sum(output_tokens) AS ausgabe, round(avg(latency_ms)) AS ms_mittel
FROM ai_usage_records u JOIN tenants t ON t.id = u.tenant_id AND t.slug = :slug
WHERE u.created_at >= :since::timestamp GROUP BY 1 ORDER BY 2 DESC;
