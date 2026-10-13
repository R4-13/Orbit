/**
 * Google-spezifische OAuth2/Gmail-API-Konstanten — jede URL hier wurde
 * gegen die offizielle Google-Dokumentation verifiziert (niemals geraten,
 * CLAUDE.md):
 *
 * - Autorisierungs-/Token-/Revoke-Endpunkte:
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 * - Gmail-Scopes: https://developers.google.com/gmail/api/auth/scopes
 * - Gmail-REST-Endpunkte (`users.getProfile`/`users.messages.list`/
 *   `users.messages.get`/`users.messages.attachments.get`):
 *   https://developers.google.com/gmail/api/reference/rest/v1/users
 *
 * Nur der `gmail.readonly`-Scope wird angefordert — `email.send` ist laut
 * Amendment §7.4/§7.5 ausdrücklich optional für Phase 1 und wird bewusst
 * noch nicht umgesetzt (siehe docs/ASSUMPTIONS.md); das Capability-Modell
 * soll `email.send` erst anfordern, wenn eine sendende Funktion tatsächlich
 * aktiv genutzt wird (§7.4: "Minimal notwendige Berechtigungen").
 */
export const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/**
 * Sending (Amendment 02 reference process): requested only when the tenant explicitly connects with send permission
 * ("Minimal notwendige Berechtigungen", Integration Amendment §7.4). Scope list: https://developers.google.com/gmail/api/auth/scopes;
 * endpoint `users.messages.send`: https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send
 */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/**
 * Verfügbarkeit lesen (Terminvorschläge für Vor-Ort- und Telefontermine): nur Frei/Belegt, keine Termininhalte. Scope und Endpunkt `freebusy.query`
 * (POST https://www.googleapis.com/calendar/v3/freeBusy) laut offizieller Dokumentation:
 * https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
 */
export const GOOGLE_CALENDAR_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
/**
 * Termine anlegen (Termin buchen): `events.insert` (POST /calendars/{calendarId}/events) verlangt laut offizieller Dokumentation u. a. diesen Scope; ein Termin kann mit
 * eigener Kennung (`id`, Zeichen a–v und 0–9, mindestens 5) angelegt werden – eine Wiederholung ergibt dann `409 Conflict` statt einer Dublette.
 * https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
 */
export const GOOGLE_CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
