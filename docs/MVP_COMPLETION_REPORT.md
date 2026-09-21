# MVP Completion Report — Project ORBIT

Abschlussbericht nach Phase 17 des Master-Entwicklungsplans (siehe
`CLAUDE.md`). Fasst zusammen, was gebaut, live verifiziert und bewusst
nicht getan wurde — als Entscheidungsgrundlage, nicht als Ersatz für die
Detaildokumente, auf die jeder Abschnitt verlinkt.

## Was funktioniert (live verifiziert)

Zwei vollständige End-to-End-Geschäftsprozesse laufen gegen eine echte
Postgres-Instanz (inkl. Row-Level Security), echtes MinIO und einen echten
Next.js/NestJS-Stack — nicht nur gegen Mocks in Unit-Tests:

- **Finance**: Rechnung hochladen (echter Presigned-URL-Upload zu MinIO) →
  OCR-Extraktion (Mock) → Dublettenprüfung → Lieferantenabgleich mit
  Freigabe-Flow → Buchungsvorschlag → menschliche Freigabe →
  FiBu-Transfer (Mock-Connector) — inklusive der korrekten 403-Ablehnung,
  wenn kein Lieferant zugeordnet ist.
- **Sales**: Firma/Kontakt anlegen → Lead erzeugen (erstellt automatisch
  eine Folgeaufgabe) → Lead qualifizieren → Terminvorschlag →
  Terminbestätigung → Aufgabe abschließen.
- **Frontend**: Login/Logout, App-Shell mit rollenbasierter Navigation,
  Dashboard, alle Finance-/Sales-Seiten, Freigaben-Übersicht —
  durchgängig gegen die echte API getestet, nicht gegen Fixtures.
- **Multi-Tenancy** mit zwei unabhängigen Verteidigungslinien (Prisma-
  Client-Extension + Postgres Row-Level Security), live gegen echte
  Cross-Tenant-Zugriffsversuche verifiziert (fail-closed bestätigt).
- **RBAC**: sechs Rollen, granulare Permission-Strings, live über 401/403-
  Fälle in den E2E-Suiten geprüft.
- **146 automatisierte Tests**: 121 Unit-Tests (Vitest/Jest) + 15 API-E2E-
  Tests (Jest/Supertest gegen echte Postgres/MinIO) + 10 Frontend-E2E-Tests
  (Playwright gegen den echten laufenden Stack) — alle grün, mehrfach
  wiederholt zur Idempotenz-Prüfung.

Details je Komponente: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).
Architektur: [`ARCHITECTURE.md`](ARCHITECTURE.md) /
[`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).

## Was bewusst nicht fertig ist

Nichts davon ist ein übersehener Fehler — jeder Punkt ist in
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) mit Begründung dokumentiert:

1. **Reale Drittanbieter-Anbindungen** (DATEV, Lexware, Microsoft 365,
   Google, HubSpot, Twilio) — Interfaces + Mocks fertig, reale Adapter
   brauchen Provider-Credentials, die in dieser Umgebung nicht verfügbar
   waren (§62: Mock-Connector + vollständige Schnittstelle statt Erfinden
   von API-Verhalten).
2. **Agent-Runtime nicht live verdrahtet** — `packages/agent-core` ist
   fertig und unit-getestet, aber es gibt kein `AgentModule`, keinen
   HTTP-Endpunkt, der die LLM→Tool→Policy-Schleife tatsächlich ausführt.
   Beide Workflows oben laufen als direkte, RBAC-gated Service-Aufrufe.
3. **Echte OCR** (Tesseract) — folgt direkt aus Punkt 2 (nie ausgewählt,
   da `OCR_PROVIDER=tesseract` mangels Implementierung beim Boot
   fehlschlagen würde).
4. **E-Mail-Eingang/Inbox** — kein Mail-Connector-Workflow, deshalb keine
   Inbox-UI.
5. **CI-Erweiterungen aus Phase 14/15** (MinIO-Service, RLS-Rollen-Setup,
   Playwright-Install, Server-Start für Frontend-E2E) sind gegen das
   lokale Docker-Äquivalent, aber **nicht gegen einen echten
   GitHub-Actions-Runner** verifiziert — diese Umgebung hatte keinen
   Zugriff auf einen.
6. **`next build` unter Windows** ohne aktivierten Entwicklermodus
   (Docker-Build unbetroffen).

## Sicherheitsstand

Row-Level Security (Phase 15) ist die auffälligste Härtung, aber zwei
weitere Funde waren mindestens so wichtig:

- `ThrottlerGuard` war seit Phase 3 konfiguriert, aber **nie tatsächlich
  angewendet** — Rate-Limiting war die ganze Zeit wirkungslos. Jetzt
  global aktiv plus ein strengeres Limit für Login/Refresh.
- Der E2E-Test-Bootstrap registrierte nie den `OrbitExceptionFilter` —
  jeder `OrbitError` (403/404/…) wäre in einem Test als nackte 500
  durchgegangen, unbemerkt bis die ersten echten Workflow-E2E-Tests
  geschrieben wurden.

Beide zeigen denselben Punkt: **echte End-to-End-Tests gegen echte
Infrastruktur finden Klassen von Bugs, die Unit-Tests mit gemocktem
Prisma strukturell nicht finden können** — das war der Hauptgrund, warum
Phase 14 vor Phase 15 kam, nicht danach.

Offen für einen späteren Härtungs-Pass: httpOnly-Cookie statt
`localStorage`-JWT (bewusst zurückgestellt, siehe ASSUMPTIONS #92),
Dependency-Vulnerability-Scanning in der CI-Pipeline.

## Empfohlene nächste Schritte

In ungefährer Prioritätsreihenfolge, falls das Projekt über diesen MVP
hinausgeht:

1. **Ein Provider-Credential-Set beschaffen** (mindestens DATEV oder
   Lexware) und den ersten realen Finance-Connector fertig implementieren
   — validiert den gesamten Connector-Abstraktionslayer gegen ein echtes
   System, nicht nur gegen die eigene Mock-Implementierung.
2. **`AgentModule` bauen** (siehe die drei konkreten Schritte in
   `AGENT_ARCHITECTURE.md`) — erst dann liefert die bereits fertige
   Agent-Core-Infrastruktur tatsächlichen Nutzen.
3. **CI-Erweiterungen gegen einen echten GitHub-Actions-Runner
   verifizieren** — die lokale Docker-Verifikation war sorgfältig, aber
   kein Ersatz für den echten Runner.
4. **Dependency-Audit in die CI-Pipeline aufnehmen.**

## Verifikationsmethodik dieser Session

Jede in `IMPLEMENTATION_STATUS.md` als `LIVE TESTED` markierte Zeile wurde
tatsächlich gegen laufende Infrastruktur ausgeführt (Docker-Postgres,
-Redis, -MinIO), nicht nur gegen Mocks — inklusive direkter `psql`-
Verifikation der Row-Level-Security-Policies und eines isolierten
Wegwerf-Containers für den Frisches-Volume-Fall. Wo das nicht möglich war
(reale Provider-APIs, ein echter GitHub-Actions-Runner), ist das explizit
als `REQUIRES PROVIDER CREDENTIALS` bzw. "nicht live verifiziert"
gekennzeichnet, statt stillschweigend als fertig zu gelten (§63).
