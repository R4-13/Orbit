#!/bin/bash
# Zeigt den Stand eines Vorgangs im Betrieb (nur lesend): Status, aktive Pläne/Schritte, ausgehende Nachrichten, Freigaben, Schatten-Bewertung.
# Aufruf: bash tools/messlatte/vorgang-stand.sh <vollständige-Vorgangs-ID>
C="$1"
if ! [[ "$C" =~ ^[0-9a-f-]{36}$ ]]; then echo "Aufruf: vorgang-stand.sh <volle Vorgangs-ID>"; exit 1; fi
q() { docker exec -i orbit-postgres psql -U orbit -d orbit -At -F ' | ' -c "$1"; }
echo "== Vorgang"; q "select orchestration_status, title, attention_reasons, parent_case_id from cases where id='$C'"
echo "== Pläne und Schritte"; q "select p.revision, p.status, p.goal_keys, n.node_key, n.state, left(coalesce(n.error_message,''),90) from process_plans p join process_plan_nodes n on n.plan_id=p.id where p.case_id='$C' order by p.revision, n.node_key"
echo "== Ausgehende Nachrichten"; q "select to_addresses, left(subject,60), left(replace(body_text,E'\n',' '),500) from email_messages where case_id='$C' and direction='OUTBOUND' order by created_at"
echo "== Freigaben (Aktionen)"; q "select a.status, left(a.reason,110) from approvals a where a.entity_id in (select id::text from action_intents where case_id='$C')"
echo "== Aufgaben / Hinweise"; q "select 'Aufgabe', title, due_date from tasks where case_id='$C' union all select 'Hinweis', reason, null from attention_items where case_id='$C'"
echo "== Schatten-Bewertung"; q "select payload->'rating'->'goalFit'->>'verdict', payload->'rating'->>'needsPlanApproval', payload->'rating'->'plannedEffects' from case_events where case_id='$C' and type='shadow.plan_proposed'"
echo "== Ereignisse"; q "select string_agg(type, ' ' order by sequence) from case_events where case_id='$C'"
