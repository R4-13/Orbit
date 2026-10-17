#!/usr/bin/env node
// Prüft, ob dieses Werkzeug restlos entfernt werden kann: außerhalb seines Ordners darf nichts auf es verweisen (keine Konfiguration, keine Doku, keine Pakete, kein Code),
// und es darf keine eigenen Pakete mitbringen. Aufruf aus dem Ordner:  node pruefen-entfernbar.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).trim();
const OWN = relative(REPO, HERE).split(sep).join('/');
const NEEDLES = ['customer-simulator', 'customer_simulator', 'Kunden-Simulator', 'tools/customer'];
const problems = [];

// 1. Verweise von außen: jede verfolgte Datei außerhalb des eigenen Ordners.
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
for (const file of tracked) {
  if (file.startsWith(`${OWN}/`)) continue;
  const path = join(REPO, file);
  if (!existsSync(path) || statSync(path).size > 2_000_000) continue;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // Binärdatei
  const hit = NEEDLES.find((needle) => text.includes(needle));
  if (hit) problems.push(`${file}: verweist auf „${hit}“`);
}

// 2. Keine eigenen Pakete: kein package.json, keine node_modules im Ordner.
const entries = readdirSync(HERE);
if (entries.includes('package.json')) problems.push(`${OWN}/package.json: das Werkzeug soll ohne fremde Pakete auskommen`);
if (entries.includes('node_modules')) problems.push(`${OWN}/node_modules: vorhanden`);

// 3. Keine Importe aus dem übrigen Projekt (relative Pfade, die den Ordner verlassen).
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));
}
for (const file of walk(HERE).filter((f) => f.endsWith('.mjs'))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)) {
    const target = join(dirname(file), match[1] ?? '');
    if (relative(HERE, target).startsWith('..')) problems.push(`${relative(REPO, file)}: importiert aus dem Projekt (${match[1]})`);
  }
}

if (problems.length === 0) {
  console.log(`In Ordnung: außerhalb von ${OWN}/ verweist nichts auf das Werkzeug, es bringt keine Pakete mit und importiert nichts aus dem Projekt.\nEntfernen: den Ordner löschen (und die Hinweise in README.md, „Entfernen“, für Google und die Postfächer beachten).`);
} else {
  console.error(`Nicht restlos entfernbar:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
