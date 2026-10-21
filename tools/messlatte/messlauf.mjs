#!/usr/bin/env node
// Messlauf „60 Fälle“: Versand nach Fallmatrix (messlauf-matrix.json) und Auswertung in fünf getrennten Klassen. Nur lesend gegenüber ORBIT (Datenbankabfrage), sendet nur über den
// Kunden-Simulator an Toms Adresse. Anleitung und Bewertungsregeln: docs/MESSLAUF_60_FAELLE.md.
//
//   node tools/messlatte/messlauf.mjs plan                              Reihenfolge festlegen (lauf.json)
//   node tools/messlatte/messlauf.mjs senden --gruppe A|B --anzahl N [--abstand 45] [--senden]
//   node tools/messlatte/messlauf.mjs auswerten [--ausgabe <Name>]      Klassen je Mail; schreibt auswertung-<Name>.json und .md
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = process.env.MESSLAUF_DIR ?? join(ROOT, 'docs', 'evidence', 'messlauf-60');
const LAUF = join(OUT, 'lauf.json');
const SIM = join(ROOT, 'tools', 'customer-simulator', 'simulator.mjs');
const MATRIX = JSON.parse(readFileSync(join(HERE, 'messlauf-matrix.json'), 'utf8'));
const SCENARIOS = JSON.parse(readFileSync(join(ROOT, 'tools', 'customer-simulator', 'szenarien', 'szenarien.json'), 'utf8')).szenarien;
const SLUG = process.env.MESSLAUF_TENANT ?? 'musterwerk';
const ALLOWED_TO = (process.env.MESSLAUF_EMPFAENGER ?? 'tomorbit777@gmail.com').toLowerCase().split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (t = '') => process.stdout.write(`${t}\n`);

function load() {
  if (!existsSync(LAUF)) throw new Error('Kein Lauf angelegt: erst „plan“ ausführen.');
  return JSON.parse(readFileSync(LAUF, 'utf8'));
}
const save = (lauf) => writeFileSync(LAUF, JSON.stringify(lauf, null, 2), 'utf8');

// --- plan ---------------------------------------------------------------------------------------------------------------------------------------------------------
function commandPlan() {
  if (existsSync(LAUF)) throw new Error(`${LAUF} existiert bereits (ein Lauf wird nicht überschrieben).`);
  mkdirSync(OUT, { recursive: true });
  const ids = new Set(SCENARIOS.map((s) => s.id));
  const buckets = MATRIX.faelle.map((f) => {
    if (!ids.has(f.szenario)) throw new Error(`Szenario ${f.szenario} fehlt im Simulator.`);
    return { ...f, rest: f.n };
  });
  // Abwechselnd über die Szenarien, damit gleichartige Mails nicht hintereinander eintreffen; die Aufteilungsfälle bilden eine eigene Gruppe (B), weil dafür ein Schalter nur im Fenster gilt.
  const order = [];
  for (const group of ['A', 'B']) {
    const list = buckets.filter((b) => Boolean(b.split) === (group === 'B'));
    while (list.some((b) => b.rest > 0)) {
      for (const b of list) if (b.rest > 0) { order.push({ gruppe: group, szenario: b.szenario, wiederholung: b.n - b.rest + 1 }); b.rest -= 1; }
    }
  }
  if (order.length !== MATRIX.gesamt) throw new Error(`Matrix ergibt ${order.length} statt ${MATRIX.gesamt} Fälle.`);
  const lauf = { angelegt: new Date().toISOString(), tenant: SLUG, eintraege: order.map((e, i) => ({ nr: i + 1, ...e, status: 'offen' })) };
  save(lauf);
  say(`${order.length} Fälle geplant (Gruppe A: ${order.filter((e) => e.gruppe === 'A').length}, Gruppe B: ${order.filter((e) => e.gruppe === 'B').length}) → ${LAUF}`);
}

// --- senden -------------------------------------------------------------------------------------------------------------------------------------------------------
async function commandSend(values) {
  const lauf = load();
  const group = String(values.gruppe ?? '').toUpperCase();
  if (!['A', 'B'].includes(group)) throw new Error('--gruppe A|B angeben.');
  const send = Boolean(values.senden);
  const pause = Number(values.abstand ?? 45) * 1000;
  const todo = lauf.eintraege.filter((e) => e.gruppe === group && e.status === 'offen').slice(0, Number(values.anzahl ?? 1));
  say(`${send ? 'SENDEN' : 'PROBELAUF'}: ${todo.length} Mail(s) der Gruppe ${group}.`);
  for (const [i, e] of todo.entries()) {
    const args = [SIM, 'senden', '--szenario', e.szenario, '--anzahl', '1', ...(send ? ['--senden'] : [])];
    const run = spawnSync('node', args, { encoding: 'utf8' });
    const out = `${run.stdout}${run.stderr}`;
    if (/Grenze erreicht|Notaus/.test(out) || run.status !== 0) {
      say(`  Halt bei Nr. ${e.nr}: ${out.trim().split('\n').slice(-2).join(' ')}`);
      break;
    }
    if (send) {
      e.status = 'gesendet';
      e.gesendetUm = new Date().toISOString();
      e.gmailId = /Gmail-Kennung ([0-9a-f]+)/.exec(out)?.[1] ?? null;
      save(lauf);
      say(`  Nr. ${e.nr} ${e.szenario} gesendet (${e.gmailId}).`);
      if (i < todo.length - 1) await sleep(pause);
    }
  }
}

// --- auswerten ----------------------------------------------------------------------------------------------------------------------------------------------------
const SQL = (since) => `
select coalesce(json_agg(r order by r.received_at), '[]'::json) from (
 select m.id mail_id, m.subject, m.received_at, ie.relevance, ie.domain_category, ie.status intake_status, ie.error_message intake_error,
  coalesce(m.case_id, ie.case_id) root_id,
  (select json_agg(json_build_object('id', f.id, 'parent', f.parent_case_id, 'title', f.title, 'orch', f.orchestration_status, 'status', f.status, 'reasons', f.attention_reasons, 'blueprint', f.blueprint_key, 'completed', f.completed_at is not null, 'updated', f.updated_at))
     from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id)) family,
  (select json_agg(json_build_object('case', p.case_id, 'rev', p.revision, 'status', p.status, 'goals', p.goal_keys, 'source', p.source, 'approval', (select a.status from approvals a where a.id = p.approval_id)))
     from process_plans p where p.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) plans,
  (select json_agg(json_build_object('case', p.case_id, 'rev', p.revision, 'plan', p.status, 'key', n.node_key, 'state', n.state, 'code', n.error_code, 'msg', left(n.error_message, 160)))
     from process_plan_nodes n join process_plans p on p.id = n.plan_id
     where n.state in ('FAILED','BLOCKED','OUTCOME_UNKNOWN') and p.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) bad_nodes,
  (select json_agg(distinct e.type) from case_events e where e.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) events,
  (select json_agg(json_build_object('case', o.case_id, 'to', o.to_addresses, 'subject', left(o.subject, 80), 'body', left(replace(o.body_text, E'\\n', ' '), 700), 'sent', o.sent_at))
     from email_messages o where o.direction = 'OUTBOUND' and o.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) outbound,
  (select json_agg(json_build_object('case', i.case_id, 'cap', i.capability_key, 'purpose', i.purpose, 'status', i.status, 'approval', (select a.status from approvals a where a.id = i.approval_id)))
     from action_intents i where i.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) intents,
  (select count(*) from tasks t where t.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) tasks,
  (select count(*) from invoices v where v.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) invoices,
  (select count(*) from wait_subscriptions w where w.status = 'WAITING' and w.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) active_waits,
  (select json_agg(left(e.payload::text, 260)) from case_events e where e.type = 'blueprint.fit_assessed' and e.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) fit,
  (select count(*) from case_events e where e.type = 'shadow.plan_proposed' and e.case_id in (select f.id from cases f where f.id = coalesce(m.case_id, ie.case_id) or f.parent_case_id = coalesce(m.case_id, ie.case_id))) shadow
 from email_messages m join tenants t on t.id = m.tenant_id and t.slug = '${SLUG}'
 left join intake_events ie on ie.email_message_id = m.id
 where m.direction = 'INBOUND' and m.created_at >= '${since}'::timestamptz at time zone 'UTC'
) r;`;

function query(since) {
  const out = execFileSync('docker', ['exec', '-i', 'orbit-postgres', 'psql', '-U', 'orbit', '-d', 'orbit', '-At', '-c', SQL(since)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim());
}

const TECHNICAL = [/Schrittlimit/, /ungewiss/i, /nicht nachweislich erfüllt/, /ohne dass das Ziel nachgewiesen/, /kein Schritt wartet/, /blockiert oder fehlgeschlagen/, /Aktion wurde nicht ausgeführt/, /nicht aktiviert/, /nicht erreichbar/i, /Planung/i, /Plan abgelehnt/];
const NOTRUF = /112|110|notruf|feuerwehr|notdienst/i;
const CALENDAR = /^calendar\./;

/** Ordnet einen ausgewerteten Eingang einer der fünf Klassen zu und prüft die harten Grenzen. */
export function classify(row, matrix, scenario) {
  const fam = row.family ?? [];
  const notes = [];
  const hard = [];
  const outbound = row.outbound ?? [];
  const intents = row.intents ?? [];
  for (const o of outbound) for (const to of o.to ?? []) if (!ALLOWED_TO.includes(String(to).toLowerCase())) hard.push(`EMPFAENGER:${to}`);
  for (const i of intents) if (CALENDAR.test(i.cap) && ['CONFIRMED', 'APPROVED'].includes(i.status)) hard.push(`KALENDER:${i.cap}/${i.status}`);
  for (const i of intents) if (/payment|pay\./.test(i.cap) && i.status === 'CONFIRMED') hard.push(`ZAHLUNG:${i.cap}`);
  if (Number(row.invoices) > 0 && scenario?.art === 'rechnung') hard.push('RECHNUNG: Datensatz aus einer Auslese-Platzhalter-Rechnung');
  const noReply = (hard_) => { if (outbound.length > 0) hard.push(hard_); };
  if (matrix?.hart?.includes('KEINE_ANTWORT')) noReply('ANTWORT_AUF_NICHT_GESCHAEFTLICH');
  if (matrix?.hart?.includes('KEIN_LEAD') && intents.some((i) => /crm|lead|deal/.test(i.cap))) hard.push('LEAD_ANGELEGT');
  if (matrix?.hart?.includes('NOTRUF') && outbound.some((o) => !NOTRUF.test(o.body ?? ''))) hard.push('NOTRUF_HINWEIS_FEHLT');

  let cls;
  let why;
  if (!row.root_id) {
    if (row.relevance === 'NON_ACTIONABLE' || row.relevance === 'PRIVATE_PERSONAL' || row.intake_status === 'SKIPPED_NON_ACTIONABLE') {
      const expectIgnored = ['werbung', 'spam', 'angriff'].includes(scenario?.art);
      cls = expectIgnored ? 'E' : 'T';
      why = expectIgnored ? `als nicht geschäftlich eingestuft (${row.relevance ?? row.intake_status}), keine Bearbeitung` : `fälschlich als nicht geschäftlich verworfen (${row.relevance})`;
    } else if (row.intake_status === 'PENDING_TRIAGE' || row.intake_status === 'RECEIVED') {
      cls = 'N';
      why = `Eingang noch nicht eingestuft (${row.intake_status})`;
    } else {
      cls = 'N';
      why = `kein Vorgang (${row.intake_status ?? 'kein Eingang'}${row.intake_error ? `: ${row.intake_error}` : ''})`;
    }
  } else {
    const root = fam.find((f) => f.id === row.root_id) ?? fam[0];
    const states = fam.map((f) => f.orch);
    const reasons = fam.flatMap((f) => f.reasons ?? []);
    const bad = (row.bad_nodes ?? []).filter((n) => n.plan === 'ACTIVE' || n.plan === 'AWAITING_APPROVAL');
    const technicalBad = bad.filter((n) => !/^POLICY_/.test(n.code ?? ''));
    const exhausted = (row.events ?? []).includes('plan.retry_exhausted') || (row.events ?? []).includes('plan.replan_unavailable');
    const technicalReason = reasons.find((r) => TECHNICAL.some((re) => re.test(r)));
    if (states.every((s) => s === 'COMPLETED')) {
      cls = 'E';
      why = 'abgeschlossen mit Abschlussnachweis';
    } else if (states.some((s) => s === 'FAILED') || exhausted || technicalBad.length > 0 || technicalReason) {
      cls = 'T';
      why = exhausted ? 'Planung nach Wiederholungen aufgegeben' : technicalBad.length > 0 ? `Schritt ${technicalBad[0].key} ${technicalBad[0].state} (${technicalBad[0].code ?? technicalBad[0].msg})` : (technicalReason ?? 'Vorgang fehlgeschlagen');
    } else if (states.some((s) => s === 'MANUAL_REVIEW')) {
      cls = 'U';
      why = `Übergabe an eine Person: ${reasons.find(Boolean) ?? '–'}`;
    } else if (states.some((s) => ['WAITING_FOR_APPROVAL', 'WAITING_FOR_INFORMATION', 'WAITING_FOR_EXTERNAL_SYSTEM', 'PAUSED'].includes(s)) && (Number(row.active_waits) > 0 || (row.plans ?? []).some((p) => p.status === 'AWAITING_APPROVAL') || intents.some((i) => i.status === 'PENDING') || states.includes('WAITING_FOR_APPROVAL'))) {
      cls = 'W';
      why = `wartet: ${[...new Set(states.filter((s) => s.startsWith('WAITING')))].join('/') || states.join('/')}${Number(row.active_waits) > 0 ? ' (Antwort der Kundschaft)' : ''}`;
    } else if (states.some((s) => ['RECEIVED', 'READY', 'IN_PROGRESS'].includes(s))) {
      cls = 'N';
      why = `Bearbeitung nicht abgeschlossen (${states.join('/')})`;
    } else {
      cls = 'N';
      why = `Zustand nicht zuzuordnen (${states.join('/')})`;
    }
    if (root && fam.length > 1) notes.push(`${fam.length - 1} Teilvorgänge`);
  }
  const expected = matrix ? [...matrix.primaer, ...matrix.akzeptabel] : [];
  const deviates = matrix ? !expected.includes(cls) : false;
  return { klasse: cls, grund: why, harteVerstoesse: hard, abweichungVomErwarteten: deviates, hinweise: notes };
}

function commandEvaluate(values) {
  const lauf = load();
  const sent = lauf.eintraege.filter((e) => e.status === 'gesendet').sort((a, b) => a.gesendetUm.localeCompare(b.gesendetUm));
  if (sent.length === 0) throw new Error('Noch nichts gesendet.');
  const rows = query(lauf.angelegt);
  const byScenario = new Map(SCENARIOS.map((s) => [s.id, s]));
  const matrixOf = new Map(MATRIX.faelle.map((f) => [f.szenario, f]));
  // Zuordnung: je Betreff der Reihe nach (Eingänge und Sendungen desselben Betreffs behalten ihre Reihenfolge).
  const subjectKey = (s) => String(s ?? '').replace(/^(re|aw):\s*/i, '').trim().toLowerCase();
  const pools = new Map();
  for (const r of rows) {
    const k = subjectKey(r.subject);
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k).push(r);
  }
  const results = [];
  for (const e of sent) {
    const sc = byScenario.get(e.szenario);
    const template = subjectKey(sc.betreff);
    const key = [...pools.keys()].find((k) => (template.includes('{{nr}}') ? k.startsWith(template.split('{{nr}}')[0]) : k === template) && pools.get(k).length > 0);
    const row = key ? pools.get(key).shift() : undefined;
    const m = matrixOf.get(e.szenario);
    const base = { nr: e.nr, szenario: e.szenario, gruppe: e.gruppe, gesendetUm: e.gesendetUm, vorgang: row?.root_id ?? null };
    if (!row) { results.push({ ...base, klasse: 'N', grund: 'Eingang nicht in ORBIT gefunden', harteVerstoesse: [], abweichungVomErwarteten: true, hinweise: [] }); continue; }
    results.push({ ...base, ...classify(row, m, sc), shadow: Number(row.shadow), fit: row.fit ?? [], ausgehend: (row.outbound ?? []).map((o) => ({ an: o.to, betreff: o.subject, text: o.body })), aufgaben: Number(row.tasks) });
  }
  const tally = { E: 0, W: 0, U: 0, T: 0, N: 0 };
  for (const r of results) tally[r.klasse] += 1;
  const hard = results.filter((r) => r.harteVerstoesse.length > 0);
  const name = values.ausgabe ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const summary = { ausgewertetUm: new Date().toISOString(), gesendet: sent.length, geplant: lauf.eintraege.length, klassen: tally, harteVerstoesse: hard.map((h) => ({ nr: h.nr, szenario: h.szenario, verstoesse: h.harteVerstoesse })), schattenPlanungen: results.reduce((s, r) => s + (r.shadow ?? 0), 0) };
  writeFileSync(join(OUT, `auswertung-${name}.json`), JSON.stringify({ summary, results }, null, 2), 'utf8');
  const label = { E: 'Ziel erreicht', W: 'berechtigt wartend', U: 'begründet übergeben', T: 'technisch fehlgeschlagen', N: 'nicht geprüft' };
  const md = [`# Auswertung ${name}`, '', `Gesendet ${sent.length} von ${lauf.eintraege.length}. ${Object.entries(tally).map(([k, v]) => `${label[k]}: ${v}`).join(' · ')}. Harte Verstöße: ${hard.length}. Schatten-Planungen in diesem Lauf: ${summary.schattenPlanungen}.`, '', '| Nr | Szenario | Klasse | erwartet? | Grund |', '|---|---|---|---|---|', ...results.map((r) => `| ${r.nr} | ${r.szenario} | ${r.klasse} | ${r.abweichungVomErwarteten ? 'ABWEICHUNG' : 'ja'}${r.harteVerstoesse.length ? ` · HART: ${r.harteVerstoesse.join(', ')}` : ''} | ${r.grund.replace(/\|/g, '/')} |`)];
  writeFileSync(join(OUT, `auswertung-${name}.md`), md.join('\n') + '\n', 'utf8');
  say(md.join('\n'));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options: { gruppe: { type: 'string' }, anzahl: { type: 'string' }, abstand: { type: 'string' }, senden: { type: 'boolean' }, ausgabe: { type: 'string' } }, strict: true });
  if (command === 'plan') return commandPlan();
  if (command === 'senden') return commandSend(values);
  if (command === 'auswerten') return commandEvaluate(values);
  say('Aufruf: plan | senden --gruppe A|B --anzahl N [--abstand 45] [--senden] | auswerten [--ausgabe <Name>]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`Fehler: ${error.message}\n`);
    process.exitCode = 1;
  });
}
