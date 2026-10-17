// Anmeldung bei Google für Toms Konto (OAuth 2.0 für Desktop-Programme, „Loopback“-Weg mit PKCE) und Erneuern des Zugangstokens.
// Quelle: https://developers.google.com/identity/protocols/oauth2/native-app
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** `gmail.modify` erlaubt Senden, Beschriften und in den Papierkorb legen – aber kein endgültiges Löschen. */
export const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

const base64url = (buffer) => buffer.toString('base64url');

export function buildAuthUrl({ clientId, redirectUri, challenge, state, loginHint }) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_URL}?${params}`;
}

/**
 * Führt die Zustimmung durch: öffnet einen lokalen Empfänger auf 127.0.0.1, gibt den Link aus (der Aufrufer zeigt ihn), wartet auf die Rückkehr und tauscht den Code gegen
 * ein Refresh-Token. Das Token wird nur zurückgegeben, nie ausgegeben.
 */
export async function authorize({ clientId, clientSecret, port, loginHint, onUrl, fetchImpl = fetch, timeoutMs = 300_000 }) {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/') {
      response.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (error || !code || url.searchParams.get('state') !== state) {
      response.end('<p>Die Zustimmung wurde nicht erteilt oder ist ungültig. Sie können dieses Fenster schließen.</p>');
      rejectCode(new Error(error ? `Google meldet: ${error}` : 'Ungültige Rückmeldung (Code oder Prüfwert fehlt).'));
      return;
    }
    response.end('<p>Fertig. Sie können dieses Fenster schließen und zum Terminal zurückkehren.</p>');
    resolveCode(code);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  const redirectUri = `http://127.0.0.1:${actualPort}`;
  onUrl(buildAuthUrl({ clientId, redirectUri, challenge, state, loginHint }));
  const timer = setTimeout(() => rejectCode(new Error('Zeit abgelaufen: keine Zustimmung innerhalb von 5 Minuten.')), timeoutMs);
  try {
    const code = await codePromise;
    const body = new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (clientSecret) body.set('client_secret', clientSecret);
    const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await response.json();
    if (!response.ok) throw new Error(`Token-Austausch fehlgeschlagen: ${data.error ?? response.status}${data.error_description ? ` (${data.error_description})` : ''}`);
    if (!data.refresh_token) throw new Error('Google hat kein Refresh-Token geliefert (bitte die Zustimmung erneut erteilen).');
    return { refreshToken: data.refresh_token, grantedScope: data.scope ?? '' };
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

/** Liefert Zugangstokens aus dem Refresh-Token; ein abgelaufener oder widerrufener Zugang wird verständlich gemeldet. */
export function createTokenSource({ clientId, clientSecret, refreshToken, fetchImpl = fetch, now = () => Date.now() }) {
  let cached;
  return async () => {
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    const body = new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' });
    if (clientSecret) body.set('client_secret', clientSecret);
    const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error === 'invalid_grant') throw new Error('Die Zustimmung für Toms Konto ist abgelaufen oder widerrufen. Bitte „node simulator.mjs auth“ erneut ausführen (bei Google im Status „Testing“ läuft sie nach 7 Tagen ab).');
      throw new Error(`Google hat das Zugangstoken nicht erneuert: ${data.error ?? response.status}`);
    }
    cached = { token: data.access_token, expiresAt: now() + Number(data.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}
