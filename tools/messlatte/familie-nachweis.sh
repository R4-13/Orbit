#!/bin/bash
# Sichert den Nachweis einer aufgeteilten Nachricht (Hauptvorgang + Teilvorgänge) als JSON – nur lesend; vor der ID-genauen Bereinigung auszuführen.
# Aufruf: bash tools/messlatte/familie-nachweis.sh <Hauptvorgang-ID> <Ausgabedatei>
# Inhalt je Vorgang: Status, Angaben (aktuell), Pläne mit Schritten, Nachrichten (ein-/ausgehend), Aufgaben, Freigaben, Aktionsabsichten, Ereignisse (Typ + Nutzlast, gekürzt).
P="$1"; OUT="$2"
if ! [[ "$P" =~ ^[0-9a-f-]{36}$ ]] || [ -z "$OUT" ]; then echo "Aufruf: familie-nachweis.sh <volle Hauptvorgang-ID> <Ausgabedatei>"; exit 1; fi
q() { docker exec -i orbit-postgres psql -U orbit -d orbit -At -c "$1"; }
CASES="select id from cases where id='$P' or parent_case_id='$P'"
q "select jsonb_pretty(json_build_object(
  'erstelltAm', now(),
  'hauptvorgang', '$P',
  'vorgaenge', (select json_agg(json_build_object(
      'id', c.id, 'elternvorgang', c.parent_case_id, 'titel', c.title, 'status', c.orchestration_status, 'hinweise', c.attention_reasons, 'erstellt', c.created_at,
      'angaben', (select coalesce(json_agg(json_build_object('schluessel', f.key, 'wert', f.value, 'status', f.status, 'quelle', f.source_type)), '[]'::json) from case_facts f where f.case_id=c.id and f.is_current),
      'plaene', (select coalesce(json_agg(json_build_object('revision', p.revision, 'status', p.status, 'quelle', p.source, 'ziele', p.goal_keys, 'schritte', (select coalesce(json_agg(json_build_object('schluessel', n.node_key, 'art', n.type, 'titel', n.title, 'zustand', n.state, 'fehler', n.error_message) order by n.node_key), '[]'::json) from process_plan_nodes n where n.plan_id=p.id)) order by p.revision), '[]'::json) from process_plans p where p.case_id=c.id),
      'nachrichten', (select coalesce(json_agg(json_build_object('richtung', m.direction, 'an', m.to_addresses, 'von', m.from_address, 'betreff', m.subject, 'text', m.body_text, 'zeit', m.created_at) order by m.created_at), '[]'::json) from email_messages m where m.case_id=c.id),
      'aufgaben', (select coalesce(json_agg(json_build_object('titel', t.title, 'beschreibung', t.description, 'status', t.status) order by t.created_at), '[]'::json) from tasks t where t.case_id=c.id),
      'aktionen', (select coalesce(json_agg(json_build_object('faehigkeit', i.capability_key, 'zweck', i.purpose, 'status', i.status, 'schritt', i.node_key, 'freigabe', (select json_build_object('status', a.status, 'grund', a.reason, 'entschieden', a.decided_at) from approvals a where a.id=i.approval_id)) order by i.created_at), '[]'::json) from action_intents i where i.case_id=c.id),
      'ereignisse', (select coalesce(json_agg(json_build_object('nr', e.sequence, 'typ', e.type, 'nutzlast', left(e.payload::text, 600)) order by e.sequence), '[]'::json) from case_events e where e.case_id=c.id)
    ) order by c.created_at) from cases c where c.id in ($CASES))
)::jsonb)" > "$OUT"
echo "gesichert: $OUT ($(wc -c < "$OUT") Bytes)"
