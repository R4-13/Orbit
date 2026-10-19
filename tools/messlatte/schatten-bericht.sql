-- Schattenbetrieb: Auswertung der Schattenplanungen eines Betriebs (nur lesend). Aufruf:
--   docker exec -i orbit-postgres psql -U orbit -d orbit -v slug="'musterwerk'" -f - < tools/messlatte/schatten-bericht.sql
-- Bewertet wird die PLANUNG (nicht die Ausführung). „Dient der Plan dem Geschäftsziel?“ steht als goalFit; NEEDS_REVIEW heißt: ein Mensch urteilt (Bewertungsbogen unten).
\pset pager off
\echo '=== Übersicht ==='
WITH s AS (
  SELECT e.case_id, e.created_at, e.payload
  FROM case_events e JOIN tenants t ON t.id = e.tenant_id AND t.slug = :slug
  WHERE e.type = 'shadow.plan_proposed'
)
SELECT count(*)                                                                         AS schattenplanungen,
       count(*) FILTER (WHERE (payload->>'available') = 'true')                          AS geplant,
       count(*) FILTER (WHERE (payload->>'available') = 'false')                         AS nicht_verfuegbar_oder_grenze,
       count(*) FILTER (WHERE (payload->'rating'->>'passed') = 'true')                   AS ohne_beanstandung,
       count(*) FILTER (WHERE payload->'rating'->'goalFit'->>'verdict' = 'FITS')         AS dient_dem_ziel,
       count(*) FILTER (WHERE payload->'rating'->'goalFit'->>'verdict' = 'PARTIAL')      AS teilweise,
       count(*) FILTER (WHERE payload->'rating'->'goalFit'->>'verdict' = 'MISSES')       AS verfehlt,
       count(*) FILTER (WHERE payload->'rating'->'goalFit'->>'verdict' = 'NEEDS_REVIEW') AS mensch_urteilt,
       count(*) FILTER (WHERE (payload->'rating'->>'needsPlanApproval') = 'true')        AS braeuchte_planfreigabe
FROM s;

\echo '=== Je Art des Anliegens ==='
SELECT coalesce(payload->>'category', '(unbekannt)') AS art, count(*) AS n,
       count(*) FILTER (WHERE (payload->'rating'->>'passed') = 'true') AS ohne_beanstandung,
       count(*) FILTER (WHERE payload->'rating'->'goalFit'->>'verdict' = 'FITS') AS dient_dem_ziel,
       count(*) FILTER (WHERE payload->'rating'->'goalFit'->>'verdict' = 'NEEDS_REVIEW') AS mensch_urteilt
FROM case_events e JOIN tenants t ON t.id = e.tenant_id AND t.slug = :slug
WHERE e.type = 'shadow.plan_proposed' AND (payload->>'available') = 'true'
GROUP BY 1 ORDER BY 2 DESC;

\echo '=== Häufigste Beanstandungen ==='
SELECT v->>'code' AS beanstandung, count(*) AS n
FROM case_events e JOIN tenants t ON t.id = e.tenant_id AND t.slug = :slug,
     jsonb_array_elements(e.payload->'rating'->'violations') v
WHERE e.type = 'shadow.plan_proposed' GROUP BY 1 ORDER BY 2 DESC;

\echo '=== Vergleich mit der tatsächlichen Ausführung (Wirkungen) ==='
SELECT left(e.case_id, 8) AS vorgang,
       coalesce(e.payload->>'category', '-') AS art,
       (SELECT string_agg(DISTINCT p, ', ') FROM jsonb_array_elements_text(e.payload->'rating'->'plannedEffects') p) AS geplant_im_schatten,
       (SELECT string_agg(DISTINCT i.capability_key || coalesce('/' || i.purpose, ''), ', ') FROM action_intents i WHERE i.case_id = e.case_id AND i.status = 'CONFIRMED' AND i.capability_key IN ('email.send','calendar.book','crm.lead.create','staff.notify','task.create')) AS tatsaechlich_ausgefuehrt
FROM case_events e JOIN tenants t ON t.id = e.tenant_id AND t.slug = :slug
WHERE e.type = 'shadow.plan_proposed' AND (e.payload->>'available') = 'true' ORDER BY e.created_at;

\echo '=== Bewertungsbogen (ein Mensch urteilt: dient der Plan dem Geschäftsziel?) ==='
SELECT left(e.case_id, 8) AS vorgang,
       coalesce(e.payload->>'category', '-') AS art,
       e.payload->'rating'->'goalFit'->>'verdict' AS automatisch,
       left(c.title, 50) AS vorgangstitel,
       left(e.payload->>'explanation', 160) AS plan_erklaerung,
       (SELECT string_agg(n->>'type' || coalesce(':' || (n->>'capability'), '') || coalesce('/' || (n->>'purpose'), ''), ' → ') FROM jsonb_array_elements(e.payload->'nodes') n) AS schritte,
       left(array_to_string(ARRAY(SELECT jsonb_array_elements_text(e.payload->'rating'->'goalFit'->'reasons')), ' | '), 140) AS begruendung
FROM case_events e JOIN tenants t ON t.id = e.tenant_id AND t.slug = :slug LEFT JOIN cases c ON c.id = e.case_id
WHERE e.type = 'shadow.plan_proposed' AND (e.payload->>'available') = 'true' ORDER BY e.created_at;

\echo '=== Verbrauch der Schattenplanungen ==='
SELECT count(*) AS aufrufe, coalesce(sum(u.input_tokens), 0) AS eingabe_token, coalesce(sum(u.output_tokens), 0) AS ausgabe_token
FROM ai_usage_records u JOIN tenants t ON t.id = u.tenant_id AND t.slug = :slug
WHERE u.profile_key = 'COMPLEX_REASONING' AND u.case_id IN (SELECT e.case_id FROM case_events e WHERE e.type = 'shadow.plan_proposed' AND e.tenant_id = t.id);
