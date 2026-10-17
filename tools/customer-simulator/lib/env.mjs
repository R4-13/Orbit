// Einstellungen nur aus der Datei `.env.local` im Ordner des Werkzeugs (und der Prozessumgebung). Es wird nie die `.env` des Projekts gelesen.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, index).trim()] = value;
  }
  return out;
}

export function loadEnv(file, processEnv = process.env) {
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...Object.fromEntries(Object.entries(processEnv).filter(([key]) => key.startsWith('SIM_'))) };
}

/** Setzt oder ersetzt einen Wert in der Datei (legt sie bei Bedarf an), ohne andere Zeilen zu verändern. */
export function saveEnvValue(file, key, value) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const next = `${key}="${value}"`;
  const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));
  if (index >= 0) lines[index] = next;
  else lines.push(next);
  writeFileSync(file, `${lines.filter((l, i) => l !== '' || i < lines.length - 1).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** Die Einstellungen mit Vorgaben; fehlende Pflichtangaben werden benannt. */
export function readConfig(env) {
  return {
    clientId: env.SIM_GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.SIM_GOOGLE_CLIENT_SECRET ?? '',
    from: (env.SIM_FROM ?? '').trim().toLowerCase(),
    fromName: env.SIM_FROM_NAME ?? 'Tom Orbit',
    allowedRecipients: (env.SIM_ALLOWED_RECIPIENTS ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
    refreshToken: env.SIM_REFRESH_TOKEN ?? '',
    perHour: Number(env.SIM_MAX_PER_HOUR ?? 20),
    perDay: Number(env.SIM_MAX_PER_DAY ?? 100),
    label: env.SIM_LABEL ?? 'ORBIT-Simulation',
  };
}

export function missing(config, needs) {
  const names = { clientId: 'SIM_GOOGLE_CLIENT_ID', from: 'SIM_FROM', refreshToken: 'SIM_REFRESH_TOKEN (erzeugt „auth“)', allowedRecipients: 'SIM_ALLOWED_RECIPIENTS' };
  return needs.filter((key) => (Array.isArray(config[key]) ? config[key].length === 0 : !config[key])).map((key) => names[key]);
}
