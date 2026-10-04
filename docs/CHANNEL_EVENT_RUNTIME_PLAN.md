# Channel Event Runtime — Umsetzungsplanung

Konkrete Umsetzungsplanung für die generische Channel-Event-Runtime, die
Connector-Eingänge (zuerst Gmail) in die bestehende Business-Intake-Pipeline
einspeist. Entstanden aus einer Nutzeranfrage nach der Live-Aktivierung der
echten Gmail-OAuth-Verbindung (`handwerkernull@gmail.com`) — die Frage "was
passiert, wenn eine E-Mail ankommt?" ergab: aktuell **nichts automatisch**
(siehe `docs/ASSUMPTIONS.md` Eintrag zum ursprünglichen Befund). Diese Datei
wird während der Umsetzung aktualisiert; der jeweils aktuelle Stand steht in
`docs/IMPLEMENTATION_STATUS.md`.

## Zielarchitektur (vom Nutzer vorgegeben, nach Rücksprache verbindlich)

```
External Channel Event
→ Channel/Connector Runtime (Poll/Push/Webhook-Adapter, je nach Connector-Capability)
→ Normalized IntakeEvent
→ Idempotency
→ Queue
→ Intake Service
→ Relevance/Triage
→ Domain Router
→ Durable Workflow Engine (WorkflowDefinition/WorkflowRun/WorkflowStepRun)
→ Agents/Tools (bestehender AgentRuntime/ToolRegistry, unverändert)
→ Policy Engine / Human-in-the-Loop wo nötig
→ Systems of Record (Case/Invoice/Lead/…)
→ Audit / Completion
```

Kein Connector-/Gmail-spezifischer Business-Routing-Code — die Trennung ist
strikt: Connector liefert Rohdaten, ein dünner Poll-Adapter normalisiert sie,
der generische Runtime-Kern kennt kein Gmail.

## Verbindliche Korrekturen aus der Nutzer-Rückmeldung (vor Umsetzungsbeginn)

1. **Durable Workflow Engine ist kein optionales Later-Refactoring** —
   eigener Pflicht-Increment G: Finance/Sales müssen am Ende über
   `WorkflowDefinition`/`WorkflowRun`/`WorkflowStepRun` laufen, nicht über
   `IntakeService`s heutigen hartcodierten `runAgentTurn()`-Pfad. Bis
   Increment G abgeschlossen UND getestet ist, bleibt der Finance-/Sales-
   Automatisierungsstatus ehrlich als `PARTIAL` dokumentiert — auch wenn der
   Gmail-Live-Fluss (Increment F) bereits funktioniert.
2. **Kein `Integration.config` als Laufzeit-Cursor-Speicher** — eigenes
   `ConnectorSync`-Modell (von §10 der Master-Spezifikation bereits als
   Modellname vorgesehen, bisher nie gebaut) für sich änderenden
   Sync-Zustand (Cursor, Zeitpunkte, Retry-Zähler). `Integration.config`
   bleibt reine, selten ändernde Konfiguration.
3. **`IntakeEvent` dupliziert keine Quelldaten** — nur Referenzen
   (`emailMessageId`, `documentIds`), normalisierte Metadaten
   (Sender/Empfänger als `PartyReference`-JSON, Betreff), Triage-/
   Klassifikations-Ergebnis, Verarbeitungsstatus, Korrelations-IDs. Der
   vollständige E-Mail-Body bleibt ausschließlich auf `EmailMessage`.
4. **Relevance/Triage vor Domain-Klassifikation**, exakt fünf Werte
   (`BUSINESS_ACTIONABLE`/`BUSINESS_INFORMATIONAL`/`NON_ACTIONABLE`/
   `PRIVATE_PERSONAL`/`UNKNOWN_REQUIRES_REVIEW`), deterministisch von
   Anwendungs-/Policy-Code ausgewertet (die KI liefert nur die Einstufung,
   nicht die Konsequenz).
5. **Trennung KI-Einschätzung vs. Ausführung**: der Triage-Agent bestimmt
   Relevanz/Routing-Empfehlung, führt aber selbst nie eine Business-Aktion
   aus — das bleibt Workflow-/Policy-Infrastruktur vorbehalten.
6. **Generischer Runtime bleibt channel-/connector-unabhängig** — Gmail ist
   der erste Adapter, kein Sonderfall im Kernpfad.
7. **Idempotenz-Grenze**: `tenantId` + `connection/provider` +
   externe Event-/Message-ID. Keine Logik hängt an einer konkreten
   Mailbox-Adresse — `handwerkernull@gmail.com` ist ausschließlich das
   Live-Test-/Abnahmekonto, nie ein Identitäts- oder Code-Anker.
8. **Betriebsstatus-Stufen** (verbindlich zu unterscheiden, auch in der
   Doku): `AUTHENTICATION_CONNECTED` → `INPUT_TRIGGER_ACTIVE` →
   `INTAKE_PIPELINE_ACTIVE` → `DOMAIN_WORKFLOW_ACTIVE` →
   `LIVE_END_TO_END_TESTED`. Ein erfolgreicher OAuth-Connect allein ist
   **niemals** gleichbedeutend mit einem funktionierenden automatischen
   Intake-Kanal.

## Bereits vorhandene, wiederverwendete Bausteine (Rechercheergebnis vor
Umsetzungsbeginn — siehe `docs/ASSUMPTIONS.md` für die vollständige Tabelle)

- `AgentRuntime`/`ToolRegistry`/`AgentDefinitionResolverService` — generisch,
  schlüsselbasiert, unverändert wiederverwendbar für einen 4. Triage-
  `AgentDefinition`-Eintrag.
- `WebhookIdempotencyService`/`WebhookEvent` — gebaut, bisher **ganz ohne
  Aufrufer** — unverändert wiederverwendbar für die Gmail-Message-Dedup.
- Der durable Workflow-Engine (`WorkflowRunnerService`, Queue, Processor,
  Approval-Pause/Resume, Retry) — vollständig gebaut und getestet, aber
  bisher nie an einen echten Trigger angeschlossen (eigener Kommentar im
  Code: "parallel, additive capability"). Keine Finance-/Sales-
  `WorkflowDefinition` existiert bisher irgendwo (nicht geseedet, nicht
  admin-angelegt) — das ist der konkrete Arbeitsauftrag für Increment G.
- `ConnectorRegistry`s `syncModes`/`pollingSupport`/`webhookSupport` — bisher
  rein Frontend-Anzeige, kein Laufzeit-Code liest sie. Dieser Runtime wird
  der erste echte Konsument.

## Increments (jeder einzeln lint-/typecheck-/testverifiziert und committet)

| Increment | Inhalt | Status |
|---|---|---|
| A | `IntakeEvent`+`ConnectorSync`-Datenmodell, `NormalizedIntakeEvent`/`PartyReference`/`AttachmentReference`-Typen, RLS, `TENANT_SCOPED_MODELS` | ✅ Abgeschlossen |
| B | Relevance/Triage-Stufe + Konvergenz von simuliertem/echtem Pfad auf `IntakeService.handleIntakeEvent()`; Domain-Routing als Lookup-Tabelle statt if/else | ✅ Abgeschlossen |
| C | `ChannelPollAdapter`-Interface + `GmailPollAdapter` (Cursor in `ConnectorSync`) | Offen |
| D | Generische Sync-Queue/-Processor/-Scheduler + Concurrency-Erweiterung + Idempotenz-Verdrahtung | Offen |
| E | Human-in-the-Loop-Pfad für `UNKNOWN_REQUIRES_REVIEW` | Offen |
| F | Echter Gmail→Intake→bestehender Finance/Sales-Pfad, Live-E2E gegen `handwerkernull@gmail.com`; Domain-Workflow-Status bleibt bewusst `PARTIAL` | Offen |
| G | **Pflicht-Increment**: Finance/Sales-Ausführung auf `WorkflowDefinition`/`WorkflowRun`/`WorkflowStepRun` migrieren, Restart-/Approval-/Idempotenz-Verhalten testen | Offen |
| H | Status-Sichtbarkeit (5 Stufen) + Doku + volle End-to-End-Regression | Offen |
