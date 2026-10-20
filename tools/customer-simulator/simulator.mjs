#!/usr/bin/env node
// Kunden-Simulator: schickt realistische Testanfragen von einem Gmail-Testkonto („Tom“) an ein anderes („Handwerker“). Eigenständiges Werkzeug – kennt ORBIT nicht, liest keine
// Einstellungen des Projekts und verändert nichts außerhalb dieses Ordners (und Toms Postfach). Anleitung: README.md.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadEnv, missing, readConfig, saveEnvValue } from './lib/env.mjs';
import { createGmail } from './lib/gmail.mjs';
import { authorize, createTokenSource } from './lib/google-auth.mjs';
import { SendLedger, assertAllowedRecipient, stopRequested } from './lib/guards.mjs';
import { buildMessage, replyHeaders, replySubject, toRaw } from './lib/mime.mjs';
import { loadScenarios, render, select } from './lib/scenarios.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Die Dateien lassen sich für Tests umlenken; sonst liegen sie im Ordner des Werkzeugs.
const ENV_FILE = process.env.SIM_ENV_FILE ?? join(ROOT, '.env.local');
const STATE_FILE = process.env.SIM_STATE_FILE ?? join(ROOT, '.state.json');
const STOP_FILE = process.env.SIM_STOP_FILE ?? join(ROOT, 'STOP');
const SCENARIOS_FILE = join(ROOT, 'szenarien', 'szenarien.json');
const MAX_PER_COMMAND = 20;

const HELP = `Kunden-Simulator (Testwerkzeug)

  node simulator.mjs status                        Einstellungen und Zähler anzeigen
  node simulator.mjs liste [--art notfall]         Szenarien auflisten
  node simulator.mjs auth                          einmalig: Zustimmung für Toms Konto erteilen
  node simulator.mjs senden [Auswahl] [--senden]   Anfragen schicken (ohne --senden nur Probelauf)
  node simulator.mjs lauf   [Auswahl] --alle-minuten 10 [--stunden 2] --senden
                                                   regelmäßig zufällige Anfragen schicken
  node simulator.mjs posteingang [--anzahl 5]      Toms neueste empfangene Mails ansehen (nur lesen)
  node simulator.mjs antworten --text "…" [--nr 1] [--senden]
                                                   Tom antwortet im selben Faden auf eine empfangene Mail (Probelauf ohne --senden)
  node simulator.mjs aufraeumen [--seit <ISO>] [--senden]   gesendete Mails (mit --seit: nur seit dann, dazu die Antworten der erlaubten Empfänger) in Toms Postfach in den Papierkorb legen
  node simulator.mjs aufraeumen --nachrichten <Datei> [--senden]   nur die in der Datei genannten Nachrichten (RFC-Message-IDs, nachgewiesene Testzuordnung) – ein Zeitfenster allein genügt nie

Auswahl:  --szenario <Kennung> | --art <Art>   (ohne Angabe: zufällig)      --anzahl N (höchstens ${MAX_PER_COMMAND})
          --an <Adresse> (muss in SIM_ALLOWED_RECIPIENTS stehen)   --abstand <Sekunden> (Pause zwischen Mails, Standard 20)
          --ohne-hinweis (lässt den „[Simulation]“-Hinweis im Text weg; Kopfzeile und Etikett bleiben)
`;

const say = (text = '') => process.stdout.write(`${text}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function context() {
  const config = readConfig(loadEnv(ENV_FILE));
  return { config, ledger: new SendLedger(STATE_FILE) };
}

function requireConfig(config, needs) {
  const lacking = missing(config, needs);
  if (lacking.length > 0) throw new Error(`Es fehlt: ${lacking.join(', ')}. Siehe README.md (Einrichtung) und .env.example.`);
}

function gmailFor(config) {
  const getToken = createTokenSource({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken });
  return createGmail({ getToken });
}

/** Sicherheitsnetz: der Zugang gehört wirklich zum Konto, von dem gesendet werden soll – nie zu einem anderen. */
async function assertAccount(gmail, config) {
  const profile = await gmail.profile();
  if (String(profile.emailAddress).toLowerCase() !== config.from) throw new Error(`Der Zugang gehört zu ${profile.emailAddress}, erwartet wird ${config.from}. Es wird nichts gesendet.`);
}

function describe(mail, to) {
  const head = [`  Von:      ${mail.fromName}`, `  An:       ${to}`, `  Betreff:  ${mail.subject}`];
  if (mail.attachment) head.push(`  Anhang:   ${mail.attachment.filename} (${mail.attachment.data.length} Bytes)`);
  return [...head, '', ...mail.text.split('\n').map((line) => `  | ${line}`)].join('\n');
}

/** Schickt ein Szenario (oder zeigt es im Probelauf). */
async function deliver({ scenario, to, send, config, ledger, gmail, labelId, notice }) {
  const mail = render(scenario, { notice });
  const recipient = assertAllowedRecipient(to, config.allowedRecipients);
  say(`• ${scenario.id} (${scenario.art}) – ${scenario.titel}`);
  if (!send) {
    say(describe(mail, recipient));
    say('  → Probelauf: nichts gesendet.');
    return false;
  }
  if (stopRequested(STOP_FILE)) throw new Error('Notaus: die Datei STOP existiert. Löschen Sie sie, um wieder zu senden.');
  ledger.assertRoom({ perHour: config.perHour, perDay: config.perDay });
  const raw = toRaw(buildMessage({ from: { name: mail.fromName, address: config.from }, to: recipient, subject: mail.subject, text: mail.text, attachment: mail.attachment, headers: { 'X-Orbit-Simulation': `customer-simulator ${scenario.id} ${randomUUID().slice(0, 8)}` } }));
  const sent = await gmail.send(raw);
  ledger.record();
  await gmail.addLabel(sent.id, labelId).catch((error) => say(`  (Etikett nicht gesetzt: ${error.message})`));
  say(`  → gesendet an ${recipient} (Gmail-Kennung ${sent.id}).`);
  return true;
}

async function commandSend(values, { loop }) {
  const { config, ledger } = context();
  const send = Boolean(values.senden);
  requireConfig(config, send ? ['clientId', 'from', 'allowedRecipients', 'refreshToken'] : ['from', 'allowedRecipients']);
  const scenarios = select(loadScenarios(SCENARIOS_FILE), { id: values.szenario, art: values.art });
  const to = values.an ?? config.allowedRecipients[0];
  assertAllowedRecipient(to, config.allowedRecipients);
  const count = Math.min(Math.max(Number(values.anzahl ?? 1), 1), MAX_PER_COMMAND);
  const pause = Number(values.abstand ?? 20) * 1000;
  let gmail;
  let labelId;
  if (send) {
    gmail = gmailFor(config);
    await assertAccount(gmail, config);
    labelId = await gmail.ensureLabel(config.label);
  } else say('PROBELAUF – es wird nichts gesendet. Zum Senden --senden angeben.\n');

  if (!loop) {
    // Ohne Auswahl zufällig; mit Auswahl der Reihe nach (bei mehr Mails als Treffern reihum).
    const chosen = Boolean(values.szenario || values.art);
    const plan = Array.from({ length: count }, (_, i) => (chosen ? scenarios[i % scenarios.length] : pick(scenarios)));
    let sentCount = 0;
    for (const [index, scenario] of plan.entries()) {
      if (await deliver({ scenario, to, send, config, ledger, gmail, labelId, notice: !values['ohne-hinweis'] })) sentCount += 1;
      if (send && index < plan.length - 1) await sleep(pause);
    }
    say(`\n${send ? `${sentCount} Mail(s) gesendet.` : `${plan.length} Mail(s) im Probelauf gezeigt.`} Zähler: ${JSON.stringify(ledger.counts())}`);
    return;
  }

  if (!send) throw new Error('„lauf“ sendet regelmäßig und braucht --senden. Zum Ansehen genügt „senden“ ohne --senden.');
  const everyMs = Math.max(Number(values['alle-minuten'] ?? 10), 1) * 60_000;
  const until = Date.now() + Math.min(Math.max(Number(values.stunden ?? 2), 0.1), 24) * 3_600_000;
  say(`Lauf: alle ${everyMs / 60_000} Minuten eine Anfrage an ${to}, bis ${new Date(until).toLocaleTimeString('de-DE')}. Beenden: Strg+C oder Datei STOP anlegen.\n`);
  while (Date.now() < until) {
    if (stopRequested(STOP_FILE)) {
      say('Notaus erkannt (Datei STOP): Lauf beendet.');
      return;
    }
    try {
      await deliver({ scenario: pick(scenarios), to, send, config, ledger, gmail, labelId, notice: !values['ohne-hinweis'] });
    } catch (error) {
      if (/Grenze erreicht|Notaus/.test(error.message)) {
        say(`Lauf beendet: ${error.message}`);
        return;
      }
      say(`  Fehler: ${error.message} (weiter beim nächsten Takt)`);
    }
    await sleep(Math.min(everyMs, Math.max(until - Date.now(), 0)));
  }
  say('Lauf beendet (Zeit abgelaufen).');
}

async function commandCleanup(values) {
  const { config } = context();
  const send = Boolean(values.senden);
  requireConfig(config, ['clientId', 'from', 'refreshToken']);
  const gmail = gmailFor(config);
  await assertAccount(gmail, config);
  if (values.nachrichten) return cleanupByMessageIds(gmail, config, String(values.nachrichten), send);
  const labelId = await gmail.ensureLabel(config.label);
  let ids;
  if (values.seit) {
    // Eng begrenzt auf einen Zeitraum (Gmail-Suche "after:"): die vom Werkzeug gesendeten Mails UND die Antworten der erlaubten Empfänger darauf.
    const since = Math.floor(new Date(String(values.seit)).getTime() / 1000);
    if (!Number.isFinite(since)) throw new Error('--seit ist kein Zeitpunkt (z. B. 2026-10-18T16:39:00Z).');
    const queries = [`label:${config.label} after:${since}`, ...config.allowedRecipients.map((address) => `from:${address} after:${since}`)];
    ids = [...new Set((await Promise.all(queries.map((q) => gmail.search(q)))).flat())];
    say(`${ids.length} Mail(s) seit ${String(values.seit)} (vom Werkzeug gesendet oder Antworten der erlaubten Empfänger) in Toms Postfach.`);
  } else {
    ids = await gmail.listByLabel(labelId);
    say(`${ids.length} Mail(s) mit dem Etikett „${config.label}“ in Toms Postfach.`);
  }
  if (!send) {
    say('Probelauf: nichts verändert. Zum Aufräumen --senden angeben (die Mails kommen in den Papierkorb und sind dort 30 Tage wiederherstellbar).');
    return;
  }
  for (const id of ids) await gmail.trash(id);
  say(`${ids.length} Mail(s) in den Papierkorb gelegt. Das Etikett bleibt bestehen (in Gmail löschbar).\nDie Kopien im Postfach des Empfängers und alles, was ORBIT daraus gemacht hat, bleiben unberührt (siehe README.md, „Entfernen“).`);
}

/**
 * Aufräumen anhand konkreter Nachrichten: Die Datei nennt RFC-Message-IDs (Zeilen mit `|`-Spalten: die dritte Spalte; Zeilen mit # sind Kommentar). Jede ID wird in Toms Postfach gesucht;
 * gelöscht (Papierkorb) wird eine Nachricht nur, wenn ihre Message-ID genau übereinstimmt UND Tom Absender oder Empfänger ist. Alles andere bleibt unberührt und wird gemeldet.
 */
async function cleanupByMessageIds(gmail, config, file, send) {
  const wanted = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => (line.includes('|') ? line.split('|')[2] : line).trim())
    .filter(Boolean);
  const isTom = (value) => String(value).toLowerCase().includes(config.from.toLowerCase());
  const found = [];
  const unmatched = [];
  for (const rfc of wanted) {
    const ids = await gmail.search(`rfc822msgid:${rfc.replace(/^<|>$/g, '')}`);
    let matched = false;
    for (const id of ids) {
      const h = await gmail.headers(id);
      if (h.messageId.trim() === rfc && (isTom(h.from) || isTom(h.to))) {
        found.push(h);
        matched = true;
      }
    }
    if (!matched) unmatched.push(rfc);
  }
  say(`${wanted.length} Nachricht(en) in der Datei, ${found.length} in Toms Postfach eindeutig zugeordnet${unmatched.length ? `, ${unmatched.length} nicht gefunden (bereits entfernt oder nicht in diesem Postfach)` : ''}.`);
  for (const h of found) say(`  • ${h.subject} | von ${h.from.replace(/<.*>/, '<…>')} | ${h.id}`);
  if (!send) {
    say('Probelauf: nichts verändert. Zum Aufräumen --senden angeben (Papierkorb, 30 Tage wiederherstellbar).');
    return;
  }
  for (const h of found) await gmail.trash(h.id);
  say(`${found.length} Nachricht(en) in den Papierkorb gelegt. Nicht genannte Nachrichten bleiben unberührt.`);
}

async function commandAuth(values) {
  const { config } = context();
  requireConfig(config, ['clientId', 'from']);
  say(`Zustimmung für ${config.from} (Berechtigung „E-Mails lesen, schreiben, senden, löschen“ – gebraucht zum Senden, Beschriften und Aufräumen).`);
  const result = await authorize({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    port: Number(values.port ?? 8765),
    loginHint: config.from,
    onUrl: (url) => say(`\nÖffnen Sie diesen Link im Browser und melden Sie sich als ${config.from} an:\n\n${url}\n\nWarte auf die Zustimmung …`),
  });
  // Erst prüfen, ob das Token zu dem richtigen Konto gehört, bevor es gespeichert wird.
  const probe = createGmail({ getToken: createTokenSource({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: result.refreshToken }) });
  const profile = await probe.profile();
  if (String(profile.emailAddress).toLowerCase() !== config.from) throw new Error(`Angemeldet wurde ${profile.emailAddress}, erwartet wird ${config.from}. Das Token wird nicht gespeichert.`);
  saveEnvValue(ENV_FILE, 'SIM_REFRESH_TOKEN', result.refreshToken);
  say(`\nFertig: Zugang für ${profile.emailAddress} gespeichert (in .env.local, nicht in Git). Probe: node simulator.mjs senden --szenario oeffnungszeiten`);
}

async function commandInbox(values) {
  const { config } = context();
  requireConfig(config, ['clientId', 'from', 'refreshToken']);
  const gmail = gmailFor(config);
  await assertAccount(gmail, config);
  const rows = await gmail.recentInbox(Number(values.anzahl ?? 5));
  if (rows.length === 0) say('Der Posteingang von Tom ist leer.');
  for (const row of rows) say(`• ${row.date}
  Von:     ${row.from}
  Betreff: ${row.subject}
  Anfang:  ${row.snippet.slice(0, 200)}`);
}

/** Tom antwortet auf eine empfangene Mail (die neueste, oder --nr N) – im selben Gmail-Faden, mit Bezug auf deren Message-ID. Der Text kommt von Hand (--text oder --datei). */
async function commandReply(values) {
  const { config, ledger } = context();
  const send = Boolean(values.senden);
  const text = (values.datei ? readFileSync(values.datei, 'utf8') : values.text ?? '').trim();
  if (!text) throw new Error('Es fehlt der Antworttext: --text "…" oder --datei <Datei>.');
  requireConfig(config, ['clientId', 'from', 'allowedRecipients', 'refreshToken']);
  const gmail = gmailFor(config);
  await assertAccount(gmail, config);
  const rows = await gmail.recentInbox(Math.max(Number(values.nr ?? 1), 1));
  const original = rows[Math.max(Number(values.nr ?? 1), 1) - 1];
  if (!original) throw new Error('Im Posteingang von Tom gibt es keine Mail, auf die geantwortet werden könnte.');
  // Geantwortet wird nur an eine erlaubte Adresse – eine Mail von jemand anderem im Posteingang wird nie beantwortet.
  const recipient = assertAllowedRecipient(original.from, config.allowedRecipients);
  const subject = replySubject(original.subject);
  const body = values['ohne-hinweis'] ? text : `${text}

[Simulation] Diese Nachricht stammt aus einem Testwerkzeug.`;
  say(`• Antwort auf „${original.subject}“ (${original.date})`);
  say(describe({ fromName: config.from, subject, text: body }, recipient));
  if (!send) {
    say('  → Probelauf: nichts gesendet. Zum Senden --senden angeben.');
    return;
  }
  if (stopRequested(STOP_FILE)) throw new Error('Notaus: die Datei STOP existiert. Löschen Sie sie, um wieder zu senden.');
  ledger.assertRoom({ perHour: config.perHour, perDay: config.perDay });
  const labelId = await gmail.ensureLabel(config.label);
  const raw = toRaw(buildMessage({ from: { address: config.from }, to: recipient, subject, text: body, headers: { ...replyHeaders(original), 'X-Orbit-Simulation': `customer-simulator reply ${randomUUID().slice(0, 8)}` } }));
  const sent = await gmail.send(raw, original.threadId);
  ledger.record();
  await gmail.addLabel(sent.id, labelId).catch((error) => say(`  (Etikett nicht gesetzt: ${error.message})`));
  say(`  → gesendet an ${recipient} (Gmail-Kennung ${sent.id}). Zähler: ${JSON.stringify(ledger.counts())}`);
}

function commandList(values) {
  const scenarios = loadScenarios(SCENARIOS_FILE).filter((s) => !values.art || s.art === values.art);
  for (const s of scenarios) say(`${s.id.padEnd(24)} ${s.art.padEnd(12)} ${s.titel}${s.anhang ? '  [mit PDF-Anhang]' : ''}`);
  say(`\n${scenarios.length} Szenario(s).`);
}

function commandStatus() {
  const { config, ledger } = context();
  say(`Absender:          ${config.from || '(SIM_FROM fehlt)'}`);
  say(`Erlaubte Empfänger: ${config.allowedRecipients.join(', ') || '(keine – es wird nichts gesendet)'}`);
  say(`Grenzen:           ${config.perHour} je Stunde, ${config.perDay} je 24 Stunden`);
  say(`Gesendet:          ${JSON.stringify(ledger.counts())} (letzte Stunde / letzte 24 Stunden)`);
  say(`Zugang für Tom:    ${config.refreshToken ? 'eingerichtet' : 'fehlt – „node simulator.mjs auth“'}`);
  say(`Notaus:            ${stopRequested(STOP_FILE) ? 'AKTIV (Datei STOP vorhanden)' : 'aus'}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: { senden: { type: 'boolean' }, szenario: { type: 'string' }, art: { type: 'string' }, an: { type: 'string' }, anzahl: { type: 'string' }, abstand: { type: 'string' }, 'alle-minuten': { type: 'string' }, stunden: { type: 'string' }, port: { type: 'string' }, 'ohne-hinweis': { type: 'boolean' }, text: { type: 'string' }, datei: { type: 'string' }, nr: { type: 'string' }, seit: { type: 'string' }, nachrichten: { type: 'string' } },
    strict: true,
  });
  switch (command) {
    case 'status':
      return commandStatus();
    case 'liste':
      return commandList(values);
    case 'auth':
      return commandAuth(values);
    case 'senden':
      return commandSend(values, { loop: false });
    case 'lauf':
      return commandSend(values, { loop: true });
    case 'posteingang':
      return commandInbox(values);
    case 'antworten':
      return commandReply(values);
    case 'aufraeumen':
      return commandCleanup(values);
    default:
      say(HELP);
      if (command && command !== 'hilfe' && command !== '--help') process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Fehler: ${error.message}\n`);
  process.exitCode = 1;
});
