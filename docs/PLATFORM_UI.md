# Plattform-Oberfläche (`/platform/*`)

Stand 07.10.2026 · Amendment 03 · Status: **TESTED LOCALLY** (Playwright gegen den Docker-Stack, `apps/web/e2e/platform.spec.ts`).

## Grundsätze

* **Eigener Bereich, eigene Sitzung.** `/platform/*` hat eine eigene Shell (keine Mandanten-Navigation, keine Sonde, kein Mandanten-Branding) und eine eigene Sitzung (Zugangstoken nur im Arbeitsspeicher, Refresh-Token als httpOnly-Cookie – **nichts im Browser-Speicher**). Die Mandanten-Oberfläche verlinkt den Plattformbereich nicht; ein Mandantenzugang kann sich dort nicht anmelden (andere Signatur, andere Zielgruppe).
* **Die Oberfläche ist Komfort, die API ist maßgeblich.** Weiterleitung und ausgeblendete Navigationspunkte folgen den Scopes aus der Anmeldung; jede Anfrage prüft der Server erneut (Sitzung, Rollen, Scopes aus der Datenbank).
* **Umgebung immer sichtbar.** Ein Kennzeichen in der Kopfzeile zeigt `development`/`staging`/`production` (Produktion rot).
* **Kritische Änderungen:** beschriebene Wirkung vor der Bestätigung, Pflichtbegründung (mindestens 5 Zeichen, geht ins Audit), erneute Passwortprüfung (Step-up) bei Bedarf. Optimistische Versionsprüfung (`expectedVersion`): ein zwischenzeitlich geänderter Stand führt zu einem verständlichen Konflikt statt zu einem stillen Überschreiben.
* **Keine erfundenen Werte.** Was die Plattform (noch) nicht kennt, steht unter „Noch nicht verfügbar“; Zugangsdaten werden nie angezeigt, nur ihr Zustand.

## Seiten

| Route | Inhalt | Schreibend |
|---|---|---|
| `/platform/login` | Betreiber-Anmeldung | – |
| `/platform` | Kennzahlen: Mandanten nach Zustand, Betreiberzugänge, Sitzungen, Audit-Ereignisse (24 h); **Hintergrundverarbeitung** (beide Warteschlangen: verbundene Worker, wartend/in Arbeit/zeitversetzt/fehlgeschlagen im Verlauf, Zustand „In Ordnung / Eingeschränkt / Steht still“, alle 15 s aktualisiert); „Noch nicht verfügbar“. Ist die Hintergrundverarbeitung nicht in Ordnung, steht ein **Banner auf jeder Plattformseite** (Stillstand = Alarm, Stau = Hinweis, jeweils mit dem Grund) | – |
| `/platform/tenants` | Mandantenliste mit Suche, Zustand, Sperren, Funktionsgruppen, Benutzerzahl (nur Stammdaten, keine Geschäftsdaten); **Zustand ändern** (Zustand, Sperrarten, Kohorten): Wirkungsvorschau → Begründung → Bestätigung gebunden an die Vorschau (Bestätigungs-Token) → Step-up | ja |
| `/platform/ai` | Anbieter, Modelle, Profile, Routen, Plattformverbindungen, Gesundheit, Nutzung (30 Tage, nur mit Kosten-Scope) | „Register aus der Umgebung anlegen“; **Profil veröffentlichen**; **Route anlegen** (inaktiv); **Route aktivieren** mit Vorprüfung (Vorbedingungen, betroffene Mandanten, ersetzte Route; eine nicht aktivierbare Route nennt ihre Gründe und lässt sich nicht bestätigen); **Route deaktivieren** – jeweils Begründung, Versionsprüfung, Step-up |
| `/platform/account` | Eigener Zugang: Angaben und **Passwort ändern** (bei erzwungenem Wechsel ist dies die einzige erreichbare Seite) (aktuelles Passwort wird erneut geprüft, Mindestlänge 14, muss sich unterscheiden; alle anderen Sitzungen enden sofort, die aktuelle bleibt) | ja |
| `/platform/identities` | Betreiberzugänge: Liste, **anlegen** (Rollen, Startpasswort ≥ 14 Zeichen, standardmäßig mit **erzwungenem Wechsel** bei der ersten Anmeldung), **Rollen ändern**, **Passwort zurücksetzen** (einmaliges Startpasswort nur in der Antwort, Sitzungen enden, Wechsel erzwungen), **deaktivieren** – Wirkung vorab (Sitzungen enden sofort), Begründung, Step-up; nur Owner | ja |
| `/platform/control` | Notschalter (auslösen/lösen), Anbindungskatalog mit Zustandswechsel und Wirkungsvorschau; je Connector, wie viele Verbindungen über alle Mandanten verbunden sind und wie viele **Aufmerksamkeit brauchen** (Anmeldung nötig, Fehler, eingeschränkt) – nur Zähler | ja (Step-up, Begründung) |
| `/platform/features` | Feature-Flags: Liste mit Standardwert, Zustand, Ausnahmen-Zahlen; **anlegen** (startet als Entwurf), **ändern** (Standardwert, Lebenszyklus, Mandantensichtbarkeit) mit aktueller Verteilung über alle Mandanten, Pflichtbegründung, Versionsprüfung, Step-up | ja |
| `/platform/support` | Support-Sitzungen: anfordern (begründet, befristet, ausdrückliche Zugriffsarten), **Vier-Augen-Freigabe** durch eine andere Person (Step-up), beenden, widerrufen; lesender Mandantenkontext nur für die **anfordernde** Person der aktiven Sitzung | ja |
| `/platform/audit` | unveränderliches Plattform-Audit, Filter Ereignistyp/Mandant, seitenweise | – |

## Bewusste Lücken

* Anbieter, Modelle, Profil-Entwürfe und Plattformverbindungen (Zugangsdaten) anlegen: **nur über die API** (die Oberfläche zeigt sie, zeigt aber nie Geheimnisse). Flag-Ausnahmen (Umgebung, Kohorte, Mandant) und der Zugriff auf Vorgangsinhalte in Support-Sitzungen (`case.payload.read`, `case.metadata.read`) ebenfalls nur über die API – Inhalte sehen bleibt bewusst eine Handlung außerhalb der Oberfläche.
* Kein MFA; Step-up ist Passwort-Re-Authentifizierung.
* **Sitzung:** das Zugangstoken (15 Minuten) lebt nur im Arbeitsspeicher des Tabs; das Refresh-Token steckt in einem httpOnly-Cookie (`orbit_platform_rt`, `SameSite=Strict`, Pfad nur `/api/v1/platform/auth`, Sitzungs-Cookie, `Secure` außer in Entwicklung/Test) und ist für Skripte der Seite unlesbar. Nach dem Neuladen stellt die Seite die Sitzung über das Cookie wieder her; mehrere Tabs serialisieren den Refresh (Web Locks). **Restrisiko:** ein Skript auf der Seite (XSS) kann den Refresh im Namen des Browsers auslösen, solange die Seite offen ist – es kann das Token aber nicht mitnehmen. Der Refresh über das Cookie verlangt den Header `X-Orbit-Platform-Cookie` (löst eine CORS-Vorabprüfung aus; fremde Seiten können ihn nicht setzen).

## Test

```bash
E2E_PLATFORM_EMAIL=<owner> E2E_PLATFORM_PASSWORD=<passwort> pnpm --filter @orbit/web exec playwright test e2e/platform.spec.ts
```

Ohne diese Variablen werden die Tests übersprungen (nie mit erfundenen Zugangsdaten). Abgedeckt: Weiterleitung ohne Sitzung, falsches Passwort und Mandantenzugang, Anmeldung und Sitzungsspeicher, Seiten ohne Fehlerzustand, Notschalter mit Step-up (Abbruch ändert nichts; auslösen und lösen; Audit-Eintrag), Mandantenzustand (Wirkung vorab, Pflichtbegründung, Vorschau verfällt bei Änderung, Funktionsgruppe setzen und entfernen, Audit), Feature-Flags (anlegen, aktivieren, zurückziehen, Audit), Domänentrennung, axe A/AA. `platform-ai.spec.ts`: Profil veröffentlichen, Route anlegen, Aktivierung wird vorab mit Gründen abgelehnt, nichts wird aktiv (die erfolgreiche Aktivierung braucht Verbindung und freigegebenes Modell und ist durch den API-E2E `platform-ai-governance` belegt). `platform-account.spec.ts`: Passwortwechsel (Vorabprüfung, falsches aktuelles Passwort, andere Sitzung endet, altes Passwort wertlos). `platform-identities.spec.ts`: anlegen, Rollen ändern (Sitzung endet sofort), deaktivieren (Anmeldung scheitert). `platform-support.spec.ts` deckt den Vier-Augen-Ablauf mit zwei Personen ab (die Support-Person legt der Test selbst an und deaktiviert sie wieder; offene Test-Sitzungen werden widerrufen).
