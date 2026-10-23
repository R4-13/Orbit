-- Sichert alle Vorgänge eines Betriebs seit einem Zeitpunkt (nur lesend) als ein JSON-Dokument: Vorgang, Angaben, Nachrichten, Pläne, Wirkungen, Aufgaben, Hinweise, Freigaben, Ereignistypen.
-- Aufruf: docker exec -i orbit-postgres psql -U orbit -d orbit -At -v slug="'musterwerk'" -v since="'2026-10-23 16:50'" -f - < tools/messlatte/vorgaenge-sichern.sql > sicherung.json
WITH t AS (SELECT id FROM tenants WHERE slug = :slug),
c AS (SELECT * FROM cases WHERE tenant_id = (SELECT id FROM t) AND created_at > :since::timestamptz)
SELECT json_build_object(
  'gesichertUm', now(),
  'vorgaenge', COALESCE((SELECT json_agg(json_build_object(
    'id', c.id, 'titel', c.title, 'status', c.orchestration_status, 'eltern', c.parent_case_id, 'ergebnis', c.outcome, 'hinweise', c.attention_reasons, 'erstellt', c.created_at,
    'angaben', (SELECT COALESCE(json_agg(json_build_object('schluessel', f.key, 'wert', f.value, 'status', f.status, 'aktuell', f.is_current, 'quelle', f.source_ref) ORDER BY f.key, f.revision), '[]') FROM case_facts f WHERE f.case_id = c.id),
    'nachrichten', (SELECT COALESCE(json_agg(json_build_object('id', m.id, 'richtung', m.direction, 'von', m.from_address, 'an', m.to_addresses, 'betreff', m.subject, 'text', left(m.body_text, 3000), 'rfc', m.rfc_message_id, 'antwortAuf', m.in_reply_to, 'gmail', m.provider_message_id, 'zeit', m.created_at) ORDER BY m.created_at), '[]') FROM email_messages m WHERE m.case_id = c.id),
    'plaene', (SELECT COALESCE(json_agg(json_build_object('revision', p.revision, 'status', p.status, 'ziele', p.goal_keys, 'anliegen', p.requested_outcomes, 'erklaerung', p.explanation, 'knoten', (SELECT json_agg(json_build_object('knoten', n.node_key, 'zustand', n.state, 'fehler', n.error_message)) FROM process_plan_nodes n WHERE n.plan_id = p.id)) ORDER BY p.revision), '[]') FROM process_plans p WHERE p.case_id = c.id),
    'wirkungen', (SELECT COALESCE(json_agg(json_build_object('faehigkeit', a.capability_key, 'zweck', a.purpose, 'status', a.status, 'zeit', a.updated_at) ORDER BY a.created_at), '[]') FROM action_intents a WHERE a.case_id = c.id),
    'aufgaben', (SELECT COALESCE(json_agg(json_build_object('titel', k.title, 'beschreibung', k.description, 'quelle', k.source)), '[]') FROM tasks k WHERE k.case_id = c.id),
    'aufmerksamkeit', (SELECT COALESCE(json_agg(json_build_object('zustaendigkeit', i.responsibility, 'zustand', i.state, 'art', i.kind, 'grund', i.reason)), '[]') FROM attention_items i WHERE i.case_id = c.id),
    'freigaben', (SELECT COALESCE(json_agg(json_build_object('status', ap.status, 'grund', ap.reason, 'beantragt', ap.requested_at, 'entschieden', ap.decided_at, 'entschiedenVon', ap.decided_by_user_id)), '[]') FROM approvals ap WHERE ap.entity_id IN (SELECT id::text FROM action_intents WHERE case_id = c.id)),
    'ereignisse', (SELECT string_agg(e.type, ' ' ORDER BY e.sequence) FROM case_events e WHERE e.case_id = c.id)
  ) ORDER BY c.created_at) FROM c), '[]')
);
