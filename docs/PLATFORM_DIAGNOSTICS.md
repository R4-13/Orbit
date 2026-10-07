# Platform Diagnostics und Business-Projektion (Amendment 03 §17, Amendment 02 v1.2 §35)

## Zwei Projektionen, ein Domänenzustand (GOV-07)

| | Business Projection | Diagnostic Projection |
|---|---|---|
| Endpunkte | `GET /cases/:id/orchestration`, `…/nodes/:nodeId` | `GET /platform/diagnostics/cases/:caseId?tenantId=&reason=` |
| Berechtigung | Mandant: `case.read` | Plattform: `platform.diagnostics.read` (Owner, Operator, Support, Security, Engineering, Auditor) |
| Typ | `CaseNodeDetail`, `CaseGraphView` (`@orbit/shared`) | `OrchestrationDiagnosticProjection` (`@orbit/shared`) |
| Datenquelle | Plan, Knoten, Fakten, Ledger – autorisiert, mandantengebunden | dieselben Tabellen (Plan, Knoten, ActionIntent/Receipt, AgentRun, ToolInvocation, CaseCorrelation) – **kein zweiter Speicher** |

**Business enthält nicht** (BP-42/43, OPS-19): interne Fehlercodes, Roh-Output eines Schritts, Payload-Hashes, Anbieter-Referenzen (Gmail-IDs), Versuchszähler, Run-/Tool-IDs, Prompt-/Token-/Providerdaten.
Es zeigt stattdessen: Zustand mit Erklärung, geschwärzte einzeilige Fehlerbeschreibung, Fakten mit Herkunft, Vorschau, Nachweis „vorhanden/kein Nachweis“ (`evidenceAvailable`), „Wiederholt“.
Die Fehlertexte stammen aus Werkzeugen, die fachliche deutsche Meldungen werfen; zusätzlich werden sie geschwärzt (`redactString`), auf die erste Zeile und 300 Zeichen gekürzt. Unerwartete Fehler tragen eine generische Meldung.

**Diagnose enthält:** Planrevisionen (Hash, Quelle, Zeiten), Knoten (Zustand, Versuche, Fehlercode, geschwärzte Meldung, Ausführungsmodus, Run-Bezug), Aktionen (Capability, Status, Payload-Hash, Idempotenzschlüssel, Receipts inkl.
Anbieter-Referenz), Agent-Läufe mit Werkzeugaufrufen (Name, Status, Policy-Aktion/-Modus – **ohne Ein-/Ausgaben**), Korrelationen. `providerRuns` (Modelllauf-Metadaten) wird mit der AI-Nutzung verknüpft, sobald Läufe einem Case
zugeordnet werden (aktuell leer – nicht erfunden).

**Beide enthalten keine Chain-of-Thought** und keine Secrets; die Diagnose enthält zudem **keine Fachinhalte** (keine Mailtexte, Entwürfe, Angebotsinhalte, Tool-Payloads).

## Zugriffsregeln der Diagnose

* Mandant und Begründung (≥ 5 Zeichen) sind Pflicht; **jeder** Zugriff wird als `PLATFORM_DIAGNOSTICS_READ` mit Akteur, Mandant, Case und Begründung auditiert (OPS-33).
* Mandantenscharf über `forTenantId`; „anderer Mandant“ und „existiert nicht“ liefern dieselbe 404-Antwort (kein Orakel über fremde IDs, OPS-32).
* Tiefere Einsicht (Payloads) gibt es nur über eine zeitlich begrenzte, scopebasierte Support-Session (Amendment 03 §18, Phase OPS-5 – **noch nicht umgesetzt**). Bis dahin ist Payload-Zugriff nicht möglich.

## Redaction

Zentral in `packages/shared/src/redaction.ts`: sensible Schlüsselnamen und Wertmuster (Bearer/Basic, `sk-…`, JWT, PEM-Blöcke, URL-Zugangsdaten, `api_key=…`), zyklensicher, tiefenbegrenzt, Kürzung langer Texte. Genutzt vom Plattform-Audit,
der Business-Projektion (Eingaben, Fakten, Meldungen) und der Diagnose.

## Offen

Laufsuche nach Support-ID/Correlation-ID über alle Objekte (`/platform/diagnostics/{correlationId}`), Diagnose-Export (`PLATFORM_DIAGNOSTIC_EXPORTED`) und Plattform-UI (Phase OPS-4).
