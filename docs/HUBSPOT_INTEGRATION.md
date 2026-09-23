# HubSpot-Anbindung (CRM)

Status: **REQUIRES PROVIDER CREDENTIALS** (siehe §63,
`docs/IMPLEMENTATION_STATUS.md`). Diese Datei wird befüllt, sobald eine
reale HubSpot-Anbindung implementiert wird — bis dahin ist
`CrmConnector` (`packages/integration-core/src/crm/`) nur über
`MockCrmConnector` nutzbar (`CRM_CONNECTOR=mock`, Default).

## Voraussetzung: HubSpot-App-Registrierung

Eine reale Anbindung braucht eine im HubSpot Developer Account
registrierte private oder öffentliche App mit den passenden CRM-Scopes
(`crm.objects.contacts.*`, `crm.objects.companies.*`,
`crm.objects.deals.*` — exakte Scope-Namen werden erst bei der
Implementierung aus der offiziellen HubSpot-API-Referenz festgelegt,
niemals erraten, siehe CLAUDE.md) sowie `HUBSPOT_CLIENT_ID`/
`HUBSPOT_CLIENT_SECRET`/`HUBSPOT_REDIRECT_URI` (siehe `.env.example`).
Das ist ein administrativer Vorgang außerhalb der Codebasis und kann
nicht durch Implementierungsarbeit allein gelöst werden — ein echter,
dokumentierter Blocker (§62 des Master-Prompts).

## Was hier ergänzt wird, sobald der Zugang vorliegt

- Konkrete HubSpot-API-Endpunkte für `CrmConnector.upsertContact()`
  (CRM Contacts API, Suche über `email`-Property vor Anlage),
  `upsertCompany()` (CRM Companies API, Suche über `domain`),
  `createLead()` (Deals-Pipeline-Zuordnung) und `logActivity()`
  (Engagements/Timeline-API) — ausschließlich aus der offiziellen
  HubSpot-API-Referenz.
- OAuth-Flow-Details (Redirect-URI-Anforderungen, Token-Refresh,
  Rate-Limit-Header-Handling — HubSpot meldet verbleibende Aufrufe pro
  10-Sekunden-Fenster).
- Mapping zwischen ORBIT-Domänenmodellen (`Contact`, `Company`, `Lead`,
  `Opportunity`, siehe `packages/domain/prisma/schema.prisma`) und den
  entsprechenden HubSpot-Objekten (Contact, Company, Deal) — inkl. der
  bereits im Schema vorgesehenen `crmExternalId`-Felder, die die
  externe HubSpot-ID halten.
- Duplikat-Erkennungsverhalten: HubSpot hat eigene Merge-/
  Duplikat-Logik, die mit der ORBIT-seitigen Matching-Logik in
  `CompaniesService`/`ContactsService` (Matching über `domain`/`email`)
  abgeglichen werden muss, um keine widersprüchlichen Datensätze zu
  erzeugen.

## Übergangslösung bis dahin

Die Fachlogik (Sales-Workflow, Phase 8, Sales-Agent-Tools) wird
ausschließlich gegen `CrmConnector` implementiert und mit
`MockCrmConnector` verifiziert (siehe `docs/INTEGRATIONS.md`). Sobald
HubSpot-Zugangsdaten vorliegen, entsteht eine `HubSpotCrmConnector`-
Klasse, die dasselbe Interface implementiert — die Fachlogik (Company →
Contact → Lead → Opportunity, Folgeaufgaben-Erzeugung) ändert sich dabei
nicht.
