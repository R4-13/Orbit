// Tests des Kunden-Simulators – ohne Netz und ohne Google: Gmail und Google werden nachgebaut. Ausführen: node --test test/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnv, readConfig, saveEnvValue, loadEnv, missing } from '../lib/env.mjs';
import { createGmail } from '../lib/gmail.mjs';
import { buildAuthUrl, createTokenSource } from '../lib/google-auth.mjs';
import { SendLedger, assertAllowedRecipient, bareAddress, stopRequested } from '../lib/guards.mjs';
import { buildMessage, encodeHeader, replyHeaders, replySubject, toRaw } from '../lib/mime.mjs';
import { buildPdf } from '../lib/pdf.mjs';
import { loadScenarios, render, select } from '../lib/scenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = join(ROOT, 'szenarien', 'szenarien.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'sim-test-'));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Mail: Umlaute im Betreff werden kodiert, der Text ist UTF-8, der Anhang steht im multipart/mixed', () => {
  assert.equal(encodeHeader('Rechnung'), 'Rechnung');
  assert.match(encodeHeader('Wärmepumpe'), /^=\?UTF-8\?B\?.+\?=$/);
  const plain = buildMessage({ from: { name: 'Tom Orbit', address: 'tom@example.com' }, to: 'a@example.com', subject: 'Größe', text: 'Grüße\nTom', headers: { 'X-Orbit-Simulation': 'x' } });
  assert.match(plain, /^From: "Tom Orbit" <tom@example\.com>\r\n/);
  assert.match(plain, /\r\nX-Orbit-Simulation: x\r\n/);
  assert.match(plain, /Content-Type: text\/plain; charset="UTF-8"/);
  const body = plain.split('\r\n\r\n')[1] ?? '';
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Grüße\r\nTom');
  const withFile = buildMessage({ from: { address: 'tom@example.com' }, to: 'a@example.com', subject: 'x', text: 'y', attachment: { filename: 'Rechnung.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4') } });
  assert.match(withFile, /Content-Type: multipart\/mixed; boundary="sim-/);
  assert.match(withFile, /Content-Disposition: attachment; filename="Rechnung\.pdf"/);
  assert.equal(Buffer.from(toRaw(plain), 'base64url').toString('utf8'), plain);
});

test('Antwort: Bezug auf die beantwortete Nachricht (In-Reply-To, References-Kette) und Betreff mit „Re:“', () => {
  assert.deepEqual(replyHeaders({ messageId: '<b@x>', references: '<a@x>' }), { 'In-Reply-To': '<b@x>', References: '<a@x> <b@x>' });
  assert.deepEqual(replyHeaders({ messageId: '<b@x>', references: '' }), { 'In-Reply-To': '<b@x>', References: '<b@x>' });
  assert.deepEqual(replyHeaders({ messageId: '', references: '' }), {});
  assert.equal(replySubject('Wärmepumpe'), 'Re: Wärmepumpe');
  assert.equal(replySubject('Re: Wärmepumpe'), 'Re: Wärmepumpe');
  assert.equal(replySubject('AW: Frage'), 'AW: Frage');
  assert.equal(replySubject('  '), 'Re: Ihre Nachricht');
  const mail = buildMessage({ from: { address: 'tom@example.com' }, to: 'a@example.com', subject: 'Re: x', text: 'y', headers: replyHeaders({ messageId: '<b@x>', references: '' }) });
  assert.ok(mail.includes('\r\nIn-Reply-To: <b@x>\r\n'));
});

test('PDF: gültiger Aufbau mit lesbarer Textebene', () => {
  const pdf = buildPdf(['RECHNUNG Nr. 1', 'Summe (brutto) 119,00 EUR', 'Grüße aus Köln']);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\(RECHNUNG Nr\. 1\) Tj/);
  assert.match(text, /\(Summe \\\(brutto\\\) 119,00 EUR\) Tj/); // Klammern maskiert
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), 'xref');
});

test('Schutz: genau ein erlaubter Empfänger; alles andere wird abgelehnt', () => {
  const allowed = ['handwerkernull@gmail.com'];
  assert.equal(assertAllowedRecipient('handwerkernull@gmail.com', allowed), 'handwerkernull@gmail.com');
  assert.equal(assertAllowedRecipient('Handwerker <HandwerkerNull@gmail.com>', allowed), 'handwerkernull@gmail.com');
  assert.throws(() => assertAllowedRecipient('fremd@example.com', allowed), /nicht erlaubt/);
  assert.throws(() => assertAllowedRecipient('handwerkernull@gmail.com, fremd@example.com', allowed), /genau ein Empfänger/);
  assert.throws(() => assertAllowedRecipient('kein-empfaenger', allowed), /Keine gültige/);
  assert.throws(() => assertAllowedRecipient('handwerkernull@gmail.com', []), /leer/);
  assert.equal(bareAddress('A <a@b.example>'), 'a@b.example');
});

test('Schutz: Obergrenzen je Stunde und Tag, nur Zeitstempel in der Datei; Notaus', () => {
  const dir = tmp();
  try {
    let now = 1_000_000_000_000;
    const ledger = new SendLedger(join(dir, 'state.json'), () => now);
    ledger.assertRoom({ perHour: 2, perDay: 3 });
    ledger.record();
    ledger.record();
    assert.throws(() => ledger.assertRoom({ perHour: 2, perDay: 3 }), /letzten Stunde/);
    now += 2 * 3_600_000; // zwei Stunden später: die Stundengrenze ist wieder frei, die Tagesgrenze noch nicht ganz
    ledger.assertRoom({ perHour: 2, perDay: 3 });
    ledger.record();
    assert.throws(() => ledger.assertRoom({ perHour: 2, perDay: 3 }), /24 Stunden/);
    now += 25 * 3_600_000;
    assert.deepEqual(ledger.counts(), { lastHour: 0, lastDay: 0 });
    assert.equal(stopRequested(join(dir, 'STOP')), false);
    writeFileSync(join(dir, 'STOP'), '');
    assert.equal(stopRequested(join(dir, 'STOP')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Szenarien: alle gültig, Platzhalter ersetzt, Anhang ist ein PDF, der Hinweis steht im Text', () => {
  const scenarios = loadScenarios(SCENARIOS);
  assert.ok(scenarios.length >= 15);
  for (const scenario of scenarios) {
    const mail = render(scenario, { now: new Date('2026-10-17T10:00:00Z'), random: () => 0.5 });
    assert.doesNotMatch(`${mail.subject}\n${mail.text}`, /\{\{/, scenario.id);
    assert.match(mail.text, /\[Simulation\]/);
    assert.doesNotMatch(render(scenario, { notice: false }).text, /\[Simulation\]/);
    if (scenario.anhang) {
      assert.ok(mail.attachment?.data.toString('latin1').startsWith('%PDF-'), scenario.id);
      assert.match(mail.attachment.filename, /\.pdf$/);
    }
  }
  const invoice = render(scenarios.find((s) => s.id === 'rechnung-lieferant'), { now: new Date('2026-10-17T10:00:00Z'), random: () => 0 });
  assert.equal(invoice.subject, 'Rechnung Nr. 10000');
  assert.match(invoice.text, /17\.10\.2026/);
  assert.match(invoice.text, /31\.10\.2026/);
  assert.deepEqual(select(scenarios, { art: 'notfall' }).map((s) => s.id).sort(), ['notfall-gasgeruch', 'notfall-rohrbruch']);
  assert.throws(() => select(scenarios, { id: 'gibt-es-nicht' }), /Kein Szenario/);
});

test('Einstellungen: Datei und Umgebung, Werte werden ohne andere Zeilen zu verändern gespeichert', () => {
  assert.deepEqual(parseEnv('# Kommentar\nA="1"\nB=zwei\n\nC = \'drei\'\n'), { A: '1', B: 'zwei', C: 'drei' });
  const dir = tmp();
  try {
    const file = join(dir, '.env.local');
    writeFileSync(file, 'SIM_FROM="tom@example.com"\n# Hinweis\n');
    saveEnvValue(file, 'SIM_REFRESH_TOKEN', 'geheim-1');
    saveEnvValue(file, 'SIM_REFRESH_TOKEN', 'geheim-2');
    const env = loadEnv(file, { SIM_MAX_PER_HOUR: '5', ANDERE: 'x' });
    assert.equal(env.SIM_FROM, 'tom@example.com');
    assert.equal(env.SIM_REFRESH_TOKEN, 'geheim-2');
    assert.equal(env.SIM_MAX_PER_HOUR, '5');
    assert.equal(env.ANDERE, undefined); // nur SIM_-Werte aus der Prozessumgebung
    const config = readConfig(env);
    assert.equal(config.perHour, 5);
    assert.deepEqual(missing(config, ['clientId', 'from', 'allowedRecipients']), ['SIM_GOOGLE_CLIENT_ID', 'SIM_ALLOWED_RECIPIENTS']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Google: Link mit PKCE, Erneuern des Tokens, abgelaufene Zustimmung wird verständlich gemeldet', async () => {
  const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:8765', challenge: 'abc', state: 'st', loginHint: 'tom@example.com' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.modify');
  assert.equal(url.searchParams.get('login_hint'), 'tom@example.com');

  let calls = 0;
  const ok = createTokenSource({ clientId: 'cid', refreshToken: 'r', fetchImpl: async () => (calls++, json(200, { access_token: 'tok', expires_in: 3600 })), now: () => 0 });
  assert.equal(await ok(), 'tok');
  assert.equal(await ok(), 'tok');
  assert.equal(calls, 1); // wird gemerkt
  const expired = createTokenSource({ clientId: 'cid', refreshToken: 'r', fetchImpl: async () => json(400, { error: 'invalid_grant' }) });
  await assert.rejects(expired(), /abgelaufen oder widerrufen.*auth/s);
});

test('Gmail: Senden, Etikett anlegen oder wiederfinden, Auflisten mit Seiten, Papierkorb', async () => {
  const calls = [];
  let labelExists = false;
  const fetchImpl = async (url, init) => {
    const path = String(url).replace('https://gmail.googleapis.com/gmail/v1/users/me', '');
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    if (path === '/messages/send') return json(200, { id: 'm1' });
    if (path === '/labels' && init.method === 'GET') return json(200, { labels: labelExists ? [{ id: 'L1', name: 'ORBIT-Simulation' }] : [] });
    if (path === '/labels') return json(200, { id: 'L9' });
    if (path.startsWith('/messages?labelIds=L1') && !path.includes('pageToken')) return json(200, { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' });
    if (path.includes('pageToken=p2')) return json(200, { messages: [{ id: 'c' }] });
    if (path.endsWith('/trash') || path.endsWith('/modify')) return json(200, {});
    return json(404, { error: { message: 'unbekannt' } });
  };
  const gmail = createGmail({ getToken: async () => 'tok', fetchImpl });
  assert.deepEqual(await gmail.send('RAW'), { id: 'm1' });
  assert.deepEqual(calls[0], { method: 'POST', path: '/messages/send', body: { raw: 'RAW' }, auth: 'Bearer tok' });
  await gmail.send('RAW2', 'thread-7'); // Antwort im selben Faden
  assert.deepEqual(calls[1]?.body, { raw: 'RAW2', threadId: 'thread-7' });
  assert.equal(await gmail.ensureLabel('ORBIT-Simulation'), 'L9'); // neu angelegt
  labelExists = true;
  assert.equal(await gmail.ensureLabel('ORBIT-Simulation'), 'L1'); // vorhanden
  assert.deepEqual(await gmail.listByLabel('L1'), ['a', 'b', 'c']);
  await gmail.trash('a');
  await gmail.addLabel('a', 'L1');
  assert.ok(calls.some((c) => c.path === '/messages/a/trash'));
  assert.deepEqual(calls.find((c) => c.path === '/messages/a/modify')?.body, { addLabelIds: ['L1'] });
  await assert.rejects(createGmail({ getToken: async () => 'tok', fetchImpl: async () => json(403, { error: { message: 'Insufficient Permission' } }) }).profile(), /403.*Insufficient Permission/);
});

test('Gmail: der Posteingang wird nur gelesen (Absender, Betreff, Datum, Anfang)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = String(url).replace('https://gmail.googleapis.com/gmail/v1/users/me', '');
    calls.push(`${init.method} ${path}`);
    if (path.startsWith('/messages?labelIds=INBOX')) return json(200, { messages: [{ id: 'x1' }] });
    return json(200, { threadId: 't9', snippet: 'Guten Tag …', payload: { headers: [{ name: 'From', value: 'handwerkernull@gmail.com' }, { name: 'Subject', value: 'Re: Frage' }, { name: 'Date', value: 'Sat, 17 Oct 2026 14:04:00 +0000' }, { name: 'Message-ID', value: '<abc@mail.gmail.com>' }, { name: 'References', value: '<first@x>' }] } });
  };
  const rows = await createGmail({ getToken: async () => 'tok', fetchImpl }).recentInbox(5);
  assert.deepEqual(rows, [{ id: 'x1', threadId: 't9', messageId: '<abc@mail.gmail.com>', references: '<first@x>', from: 'handwerkernull@gmail.com', subject: 'Re: Frage', date: 'Sat, 17 Oct 2026 14:04:00 +0000', snippet: 'Guten Tag …' }]);
  assert.ok(calls.every((c) => c.startsWith('GET ')), 'nur lesende Aufrufe');
});

/** Die Befehlszeile als Ganzes, mit leerer Umgebung (kein Netz nötig: nur Probelauf und Ablehnungen). */
function run(args, env = {}) {
  const dir = tmp();
  const result = spawnSync(process.execPath, [join(ROOT, 'simulator.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SIM_'))), SIM_ENV_FILE: join(dir, 'leer.env'), SIM_STATE_FILE: join(dir, 'state.json'), SIM_STOP_FILE: join(dir, 'STOP'), ...env },
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test('Befehlszeile: ohne --senden gibt es nur einen Probelauf, auch ohne Zugang', () => {
  const result = run(['senden', '--szenario', 'notfall-rohrbruch'], { SIM_FROM: 'tom@example.com', SIM_ALLOWED_RECIPIENTS: 'handwerkernull@gmail.com' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PROBELAUF/);
  assert.match(result.stdout, /Wasserrohrbruch/);
  assert.match(result.stdout, /Probelauf: nichts gesendet/);
});

test('Befehlszeile: ein nicht erlaubter Empfänger wird auch im Probelauf abgelehnt; echtes Senden ohne Zugang scheitert vor jedem Netzaufruf', () => {
  const denied = run(['senden', '--an', 'fremd@example.com'], { SIM_FROM: 'tom@example.com', SIM_ALLOWED_RECIPIENTS: 'handwerkernull@gmail.com' });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /nicht erlaubt/);
  const noToken = run(['senden', '--senden'], { SIM_FROM: 'tom@example.com', SIM_ALLOWED_RECIPIENTS: 'handwerkernull@gmail.com' });
  assert.notEqual(noToken.status, 0);
  assert.match(noToken.stderr, /SIM_REFRESH_TOKEN/);
  const noRecipients = run(['senden'], { SIM_FROM: 'tom@example.com' });
  assert.match(noRecipients.stderr, /SIM_ALLOWED_RECIPIENTS/);
  assert.notEqual(run(['gibtsnicht']).status, 0);
});

test('Befehlszeile: „lauf“ ohne --senden und mehr als erlaubt je Aufruf', () => {
  const env = { SIM_FROM: 'tom@example.com', SIM_ALLOWED_RECIPIENTS: 'handwerkernull@gmail.com' };
  assert.match(run(['lauf', '--alle-minuten', '5'], env).stderr, /braucht --senden/);
  const many = run(['senden', '--anzahl', '500', '--abstand', '0'], env);
  assert.equal(many.status, 0);
  assert.equal((many.stdout.match(/^• /gm) ?? []).length, 20); // höchstens 20 je Aufruf
});

test('Befehlszeile: „antworten“ braucht einen Text, sendet nie ohne Zugang und nie ohne erlaubten Empfänger', () => {
  const env = { SIM_FROM: 'tom@example.com', SIM_ALLOWED_RECIPIENTS: 'handwerkernull@gmail.com' };
  assert.match(run(['antworten'], env).stderr, /Antworttext/);
  const noToken = run(['antworten', '--text', 'Ja, bitte.'], env);
  assert.notEqual(noToken.status, 0);
  assert.match(noToken.stderr, /SIM_REFRESH_TOKEN/);
  assert.match(run(['antworten', '--text', 'Ja.'], { SIM_FROM: 'tom@example.com' }).stderr, /SIM_ALLOWED_RECIPIENTS/);
});
