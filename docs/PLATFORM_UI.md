# Plattform-Oberfläche (`/platform/*`)

Stand 07.10.2026 · Amendment 03 · Status: **TESTED LOCALLY** (Playwright gegen den Docker-Stack, `apps/web/e2e/platform.spec.ts`).

## Grundsätze

* **Eigener Bereich, eigene Sitzung.** `/platform/*` hat eine eigene Shell (keine Mandanten-Navigation, keine Sonde, kein Mandanten-Branding) und einen eigenen Sitzungsspeicher (`sessionStorage`, Schlüssel `orbit.platform.auth`). Die Mandanten-Oberfläche verlinkt den Plattformbereich nicht; ein Mandantenzugang kann sich dort nicht anmelden (andere Signatur, andere Zielgruppe).
* **Die Oberfläche ist Komfort, die API ist maßgeblich.** Weiterleitung und ausgeblendete Navigationspunkte folgen den Scopes aus der Anmeldung; jede Anfrage prüft der Server erneut (Sitzung, Rollen, Scopes aus der Datenbank).
* **Umgebung immer sichtbar.** Ein Kennzeichen in der Kopfzeile zeigt `development`/`staging`/`production` (Produktion rot).
* **Kritische Änderungen:** beschriebene Wirkung vor der Bestätigung, Pflichtbegründung (mindestens 5 Zeichen, geht ins Audit), erneute Passwortprüfung (Step-up) bei Bedarf. Optimistische Versionsprüfung (`expectedVersion`): ein zwischenzeitlich geänderter Stand führt zu einem verständlichen Konflikt statt zu einem stillen Überschreiben.
* **Keine erfundenen Werte.** Was die Plattform (noch) nicht kennt, steht unter „Noch nicht verfügbar“; Zugangsdaten werden nie angezeigt, nur ihr Zustand.

## Seiten

| Route | Inhalt | Schreibend |
|---|---|---|
| `/platform/login` | Betreiber-Anmeldung | – |
| `/platform` | Kennzahlen: Mandanten nach Zustand, Betreiberzugänge, Sitzungen, Audit-Ereignisse (24 h), „Noch nicht verfügbar“ | – |
| `/platform/tenants` | Mandantenliste mit Suche, Zustand, Sperren, Benutzerzahl (nur Stammdaten, keine Geschäftsdaten) | nein (siehe Lücken) |
| `/platform/ai` | Anbieter, Modelle, Profile, Routen, Plattformverbindungen, Gesundheit, Nutzung (30 Tage, nur mit Kosten-Scope) | „Register aus der Umgebung anlegen“ (Step-up) |
| `/platform/control` | Notschalter (auslösen/lösen), Anbindungskatalog mit Zustandswechsel und Wirkungsvorschau | ja (Step-up, Begründung) |
| `/platform/audit` | unveränderliches Plattform-Audit, Filter Ereignistyp/Mandant, seitenweise | – |

## Bewusste Lücken

* Mandantenzustand ändern (Sperren, Kohorten; API mit Vorschau + Bestätigungs-Token vorhanden), Feature-Flags, KI-Routen/Profile pflegen, Betreiberzugänge verwalten und Support-Sitzungen bedienen: **nur über die API**, noch nicht in der Oberfläche.
* Kein MFA; Step-up ist Passwort-Re-Authentifizierung.
* Der Sitzungsspeicher ist `sessionStorage` (MVP-Vereinfachung wie beim Mandanten-Token-Speicher): ein XSS auf dieser Herkunft könnte Token lesen. Eine httpOnly-Cookie-Sitzung wäre der nächste Härtungsschritt (Sicherheitshärtung).

## Test

```bash
E2E_PLATFORM_EMAIL=<owner> E2E_PLATFORM_PASSWORD=<passwort> pnpm --filter @orbit/web exec playwright test e2e/platform.spec.ts
```

Ohne diese Variablen werden die Tests übersprungen (nie mit erfundenen Zugangsdaten). Abgedeckt: Weiterleitung ohne Sitzung, falsches Passwort und Mandantenzugang, Anmeldung und Sitzungsspeicher, Seiten ohne Fehlerzustand, Notschalter mit Step-up (Abbruch ändert nichts; auslösen und lösen; Audit-Eintrag), Domänentrennung, axe A/AA.
