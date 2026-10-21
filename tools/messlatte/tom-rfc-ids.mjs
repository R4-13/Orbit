#!/usr/bin/env node
// Liest (nur lesend) die RFC-Message-IDs und Etiketten gesendeter Mails aus Toms Postfach – Eingabe: Gmail-Kennungen aus docs/evidence/messlauf-60/lauf.json (Nummern der Fälle).
//   node tools/messlatte/tom-rfc-ids.mjs 9 34 35
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, readConfig } from '../customer-simulator/lib/env.mjs';
import { createGmail } from '../customer-simulator/lib/gmail.mjs';
import { createTokenSource } from '../customer-simulator/lib/google-auth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lauf = JSON.parse(readFileSync(join(ROOT, 'docs', 'evidence', 'messlauf-60', 'lauf.json'), 'utf8'));
const config = readConfig(loadEnv(join(ROOT, 'tools', 'customer-simulator', '.env.local')));
const gmail = createGmail({ getToken: createTokenSource({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken }) });
for (const nr of process.argv.slice(2).map(Number)) {
  const entry = lauf.eintraege.find((e) => e.nr === nr);
  if (!entry?.gmailId) { console.log(`Nr. ${nr}: keine Gmail-Kennung`); continue; }
  const h = await gmail.headers(entry.gmailId);
  console.log(JSON.stringify({ nr, szenario: entry.szenario, gesendetUm: entry.gesendetUm, gmailId: entry.gmailId, rfc: h.messageId, labels: h.labels, an: h.to, betreff: h.subject }));
}
