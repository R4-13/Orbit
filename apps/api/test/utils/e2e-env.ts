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
