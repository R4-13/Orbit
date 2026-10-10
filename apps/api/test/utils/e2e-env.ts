/**
 * Läuft vor jeder E2E-Datei (jest `setupFiles`), also bevor die Controller importiert werden – die Drosselgrenzen werden beim Laden gelesen.
 * Die Anmelde-Drosselung ist eine Sicherheitsfunktion und bleibt in der Anwendung unverändert; eine ganze E2E-Suite meldet sich aber hunderte Male
 * von derselben Adresse an und würde sonst ab der Mitte mit 429 scheitern (die `.env` der Entwicklungsumgebung setzt bewusst die Betriebswerte).
 * Deshalb werden die Grenzen nur im Testprozess angehoben. Wer die Drosselung selbst testen will, setzt `E2E_KEEP_THROTTLE_LIMITS=1`.
 */
// Die Überwachung der Hintergrundverarbeitung läuft im Test nur auf Abruf (`tick()`), nicht im Takt: sonst entstünden Audit-Ereignisse mitten in anderen Tests.
process.env.PLATFORM_RUNTIME_MONITOR_SECONDS ??= '0';

if (process.env.E2E_KEEP_THROTTLE_LIMITS !== '1') {
  process.env.AUTH_RATE_LIMIT_MAX = '100000';
  process.env.PLATFORM_AUTH_RATE_LIMIT_MAX = '100000';
}

/**
 * Ein Testprozess darf nie echte Dienste von Google erreichen. Die E2E-Läufe teilen sich die Datenbank mit der Entwicklungsumgebung – samt echter Zugangsdaten eines
 * verbundenen Postfachs. Ein globaler Sweep (z. B. im Test zur Wiederaufnahme nach einem Neustart) kann Vorgänge fremder Mandanten voranbringen; ohne diese Sperre könnte
 * dabei eine echte Nachricht über das echte Postfach hinausgehen (so geschehen am 09.10.2026: zwei echte Rückfragen an Testadressen). Tests, die Google brauchen, ersetzen
 * `fetch` selbst (Double) oder setzen bewusst `E2E_ALLOW_GOOGLE=1`.
 */
const realFetch = globalThis.fetch;
const GOOGLE_HOSTS = /(^|\.)(googleapis\.com|google\.com)$/i;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // relative URLs gehen nicht an Google
  }
  if (process.env.E2E_ALLOW_GOOGLE !== '1' && GOOGLE_HOSTS.test(host)) {
    return Promise.reject(new Error(`Echte Google-Aufrufe sind im Testprozess gesperrt (${host}). Ein Double verwenden oder E2E_ALLOW_GOOGLE=1 setzen.`));
  }
  return realFetch(input, init);
}) as typeof fetch;

// Der Live-Abgleich wiederholt Schritte fremder Vorgänge, die im Hintergrund laufen; im Test nur dort, wo er ausdrücklich geprüft wird.
process.env.LIVE_UPGRADE_ENABLED ??= 'false';
// Meldungen an Mitarbeiter laufen im Test nur dort, wo sie ausdrücklich geprüft werden (sie würden sonst über den globalen Sweep an echte Adressen gehen).
process.env.ESCALATION_ENABLED ??= 'false';
