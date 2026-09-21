# DATEV-Anbindung

Status: **REQUIRES PROVIDER CREDENTIALS** (siehe §63,
`docs/IMPLEMENTATION_STATUS.md`). Diese Datei wird befüllt, sobald die
reale DATEV-Anbindung implementiert wird (Phase 7, Finance-Workflow) — bis
dahin ist `FinanceConnector` (`packages/integration-core/src/finance/`)
nur über `MockFinanceConnector` nutzbar (`FINANCE_CONNECTOR=mock`, Default).

## Warum DATEV ein Sonderfall gegenüber den anderen Connectoren ist

Anders als bei HubSpot/Twilio/Microsoft/Google reicht für DATEV keine
gewöhnliche OAuth-App-Registrierung: DATEV verlangt eine
Partnerschaft/Zulassung als Software-Hersteller (DATEV-Marktplatz-
/Entwicklerprogramm), bevor überhaupt Zugriff auf produktive
Schnittstellen-Dokumentation und Sandbox-Zugangsdaten möglich ist. Dieser
Prozess liegt außerhalb der Codebasis und kann nicht durch
Implementierungsarbeit allein gelöst werden — ein echter, dokumentierter
Blocker (§62 des Master-Prompts).

## Was hier ergänzt wird, sobald der Zugang vorliegt

- Konkrete Endpunkte/Scopes der DATEV-API, ausschließlich aus der
  offiziellen DATEV-Entwicklerdokumentation (niemals erraten oder aus
  Analogie zu anderen FiBu-Systemen abgeleitet — siehe CLAUDE.md).
- OAuth-Flow-Details (Redirect-URI-Anforderungen, Token-Lifetime,
  Refresh-Verhalten) für `DATEV_CLIENT_ID`/`DATEV_CLIENT_SECRET`/
  `DATEV_ENVIRONMENT`/`DATEV_REDIRECT_URI` (siehe `.env.example`).
- Mapping zwischen ORBIT-Domänenmodellen (`Supplier`, `Invoice`,
  `BookingProposal`, siehe `packages/domain/prisma/schema.prisma`) und den
  entsprechenden DATEV-Datenstrukturen (Konten, Belege, Buchungssätze).
- Sandbox-Testprotokoll: welche Testfälle gegen die DATEV-Sandbox laufen,
  bevor `DATEV_ENVIRONMENT=production` verwendet werden darf.

## Übergangslösung bis dahin

Die Fachlogik (Finance-Workflow, Phase 7) wird ausschließlich gegen
`FinanceConnector` (das providerunabhängige Interface) implementiert und
mit `MockFinanceConnector` verifiziert (siehe `docs/INTEGRATIONS.md`).
Sobald DATEV-Zugangsdaten vorliegen, entsteht eine `DatevFinanceConnector`-
Klasse, die dasselbe Interface implementiert — die Fachlogik ändert sich
dabei nicht.
