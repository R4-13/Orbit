# Kunden-Simulator (Testwerkzeug)

Schickt realistische Testanfragen von einem Gmail-Testkonto („Tom“, der Dummy-Kunde) an ein anderes („Handwerker“, der Dummy-Betrieb), damit man ORBIT mit echten Mails
von außen ausprobieren kann – wie ein Kunde, der einfach eine Mail schreibt.

**Das ist ein Testwerkzeug, kein Produktbestandteil.** Es liegt bewusst weder im Mandanten- noch im Betreibercode (`apps/`), kennt ORBIT nicht, liest keine Einstellungen des
Projekts, braucht keine Pakete (nur Node ≥ 22) und ändert nichts außerhalb dieses Ordners und Toms Postfach. Es wird nicht mit der Anwendung ausgeliefert.

## Einrichtung (einmalig)

1. **Google-Cloud-Console** (dasselbe Projekt wie bei ORBIT genügt):
   - OAuth-Zustimmungsbildschirm: `tomorbit777@gmail.com` als **Testnutzer** eintragen (solange die App auf „Testing“ steht). Steht sie auf „In production“, ist das nicht nötig,
     und die Zustimmung läuft nicht nach 7 Tagen ab.
   - Anmeldedaten → *OAuth-Client-ID erstellen* → Typ **Desktop-App**. Client-ID (und Secret) notieren. (Alternativ den Web-Client von ORBIT verwenden und dort
     `http://127.0.0.1:8765` als Weiterleitungs-URI ergänzen.)
2. `cp .env.example .env.local` und ausfüllen (`SIM_GOOGLE_CLIENT_ID`, ggf. `SIM_GOOGLE_CLIENT_SECRET`; Absender und erlaubte Empfänger sind vorbelegt).
3. `node simulator.mjs auth` – gibt einen Link aus; im Browser als **tomorbit777** anmelden und zustimmen. Das Werkzeug prüft, dass das Token wirklich zu diesem Konto gehört,
   und speichert es nur dann in `.env.local`.

Die Berechtigung heißt „E-Mails lesen, schreiben, senden und löschen“ (`gmail.modify`). Gebraucht wird sie zum Senden, zum Beschriften und zum Aufräumen im Postfach von Tom –
nicht zum endgültigen Löschen (Mails kommen nur in den Papierkorb).

## Benutzung

```bash
node simulator.mjs status                              # Einstellungen, Zähler, Notaus
node simulator.mjs liste                               # die 20 Szenarien
node simulator.mjs senden --szenario notfall-rohrbruch # PROBELAUF: zeigt die Mail, sendet nichts
node simulator.mjs senden --szenario notfall-rohrbruch --senden    # wirklich senden
node simulator.mjs senden --art anfrage --anzahl 3 --abstand 30 --senden
node simulator.mjs lauf --alle-minuten 10 --stunden 2 --senden    # regelmäßig zufällige Anfragen
node simulator.mjs posteingang --anzahl 5   # Toms neueste empfangene Mails ansehen (nur lesen)
node simulator.mjs antworten --text "Ja, auch das Warmwasser."   # PROBELAUF: Tom antwortet auf die neueste Mail im selben Faden
node simulator.mjs antworten --text "…" --nr 2 --senden           # wirklich senden (auf die zweitneueste Mail)
node simulator.mjs aufraeumen            # Probelauf: wie viele Mails hat das Werkzeug in Toms Postfach?
node simulator.mjs aufraeumen --senden   # in den Papierkorb legen
node pruefen-entfernbar.mjs              # ist das Werkzeug restlos entfernbar?
```

Ohne `--senden` passiert **nie** etwas außer einer Anzeige. Tests des Werkzeugs: `node --test test/simulator.test.mjs` (ohne Netz, Google und Gmail sind nachgebaut).

## Sicherheitsregeln (fest eingebaut)

- **Probelauf ist die Vorgabe**; gesendet wird nur mit ausdrücklichem `--senden`.
- **Nur erlaubte Empfänger:** genau eine Adresse je Mail, und sie muss in `SIM_ALLOWED_RECIPIENTS` stehen; sonst Abbruch (auch im Probelauf). Ist die Liste leer, wird nichts gesendet.
- **Antworten nur an erlaubte Adressen:** `antworten` beantwortet nur Mails, deren Absender in `SIM_ALLOWED_RECIPIENTS` steht; eine Mail von jemand anderem im Posteingang wird nie beantwortet.
- **Nur von Toms Konto:** vor dem Senden fragt das Werkzeug Google, zu welchem Konto das Token gehört; weicht es von `SIM_FROM` ab, wird nichts gesendet.
- **Obergrenzen:** vorgabegemäß 20 Mails je Stunde und 100 je 24 Stunden (`SIM_MAX_PER_HOUR`/`_DAY`), höchstens 20 je Aufruf; die Zähler stehen als reine Zeitstempel in `.state.json`.
- **Notaus:** existiert im Ordner eine Datei namens `STOP`, wird nichts mehr gesendet (`lauf` endet sofort).
- **Kennzeichnung:** jede Mail trägt die Kopfzeile `X-Orbit-Simulation`, ein Gmail-Etikett „ORBIT-Simulation“ in Toms Postfach und am Ende des Textes den Hinweis
  „[Simulation] …“. (`--ohne-hinweis` lässt nur den Hinweis im Text weg, um die Wirkung eines völlig natürlichen Textes zu sehen; Kopfzeile und Etikett bleiben.)
- **Nie ein Zugang im Repository:** `.env.local`, `.state.json` und `STOP` stehen in `.gitignore`.

## Szenarien

`szenarien/szenarien.json`: Angebots- und Preisanfragen, Auskünfte, zwei Notfälle, Heizungsausfall bei Frost, Beschwerde, Bewerbung, **Eingangsrechnung mit PDF-Anhang**
(Textebene, ORBIT kann sie lesen), englische Anfrage, Statusnachfrage, mehrere Anliegen, Anfrage außerhalb des Angebots, Werbung, Phishing, eingeschleuste Anweisung, nur „Hallo?“.
Das Feld `erwartung` beschreibt grob, was ein gut eingestelltes ORBIT tun sollte – zur Orientierung beim Ansehen, nie als Prüfung. Eigene Szenarien: einfach in die Datei ergänzen
(Platzhalter `{{nr}}`, `{{datum}}`, `{{faellig}}` sind möglich).

Alle Mails kommen von derselben Adresse (Tom). ORBIT behandelt wiederholte Mails desselben Absenders deshalb teils als Fortsetzung – das ist realistisch, kann aber überraschen.

## Was **nicht** gebaut ist

- **Selbstständige Antworten:** `antworten` schickt eine Antwort, die man selbst formuliert (`--text`/`--datei`) – im selben Faden, mit Bezug auf die beantwortete Mail. Dass Tom ORBITs
  Rückfragen von selbst liest und beantwortet (ein Modell spielt Toms Rolle), ist nicht gebaut.
- Bewertung der Antworten von ORBIT: das Werkzeug sendet, es prüft nichts. (Die Qualitätsmessung der KI steht im Projekt unter `docs/evaluation/`.)

## Entwurfsentscheidungen

- **Außerhalb aller Arbeitsbereiche:** keine Abhängigkeit zu Mandanten- oder Betreibercode; ein Fehler in ORBIT darf den Absender nicht mit beeinflussen (Black-Box-Test).
- **Keine Pakete:** nur Node-Bordmittel (`fetch`, `crypto`, `http`, `node:test`); dadurch kein Eintrag in `pnpm-lock.yaml` und nichts, was beim Entfernen übrig bliebe.
- **Eigene Anmeldung für Tom** (OAuth „Desktop“ mit PKCE, nach der Google-Anleitung für native Apps) statt eines Betriebs in ORBIT: der Test kennt ORBITs Versandweg nicht und braucht
  keinen Test-Betrieb in der Datenbank.
- **Dokumentation nur hier:** damit `pruefen-entfernbar.mjs` „kein Verweis von außen“ sicher prüfen kann, steht nichts über das Werkzeug in `docs/` des Projekts.

## Entfernen

1. **Den Ordner `tools/customer-simulator/` löschen.** Das ist im Repository alles (`node pruefen-entfernbar.mjs` bestätigt, dass nichts anderes darauf verweist).
2. **Google-Zustimmung entziehen:** als tomorbit777 unter <https://myaccount.google.com/permissions> den Zugriff der App entfernen; den Desktop-OAuth-Client in der Cloud Console
   löschen und tomorbit777 als Testnutzer austragen.
3. **Mails in Toms Postfach:** vorher `node simulator.mjs aufraeumen --senden` (Papierkorb), oder in Gmail das Etikett „ORBIT-Simulation“ löschen und die Mails darunter entfernen.
4. **Spuren im System, das die Mails empfangen hat (nicht Teil des Werkzeugs und nicht von ihm löschbar):** die Mails im Postfach des Empfängers (Kopfzeile `X-Orbit-Simulation`,
   Absender `tomorbit777@gmail.com`), die daraus in ORBIT entstandenen Vorgänge, Kontakte, Aufgaben und Dokumente (alle hängen an der Absenderadresse
   `tomorbit777@gmail.com`) und die Datensätze in HubSpot (Kontakt mit dieser Adresse, zugehörige Deals und Notizen). In einer Entwicklungsumgebung genügt es, die Datenbank zurückzusetzen;
   sonst die Datensätze über ORBIT bzw. HubSpot löschen.

## Fehlersuche

- *„Die Zustimmung für Toms Konto ist abgelaufen oder widerrufen“* – `node simulator.mjs auth` erneut ausführen. Steht die Google-App auf „Testing“, passiert das alle 7 Tage.
- *„Es fehlt: SIM_…“* – `.env.local` ergänzen (siehe `.env.example`).
- *„Der Zugang gehört zu …, erwartet wird …“* – bei `auth` mit dem falschen Konto angemeldet; Token wurde nicht gespeichert.
- *Google meldet `access_denied`* – tomorbit777 ist nicht als Testnutzer eingetragen.
