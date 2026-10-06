# Plattform-Connector-Registry (Amendment 03 §13, Governance GOV-04)

**Es gibt genau eine Connector-Registry:** den Katalog aus Amendment 01 (`CONNECTOR_REGISTRY` in `packages/integration-core/src/registry/connector-registry.ts`: Schlüssel, Authentifizierung,
Capabilities, Scopes, Setup, Version). Amendment 03 ergänzt darauf **nur den Plattformzustand** als Overlay: Tabelle `platform_connector_definitions` (`connector_key`, `lifecycle`, `reason`, `data_policy_refs`,
Version). Ohne Zeile gilt `ACTIVE` – das Verhalten bestehender Installationen ändert sich nicht.

| Zuständigkeit | Wer | Wie |
|---|---|---|
| Welche Connectoren existieren, Auth, Capabilities, Scopes | Plattform (Code + Katalog) | `CONNECTOR_REGISTRY` |
| Lifecycle `DRAFT/TESTING/ACTIVE/DEPRECATED/SUSPENDED/RETIRED`, Begründung, Version | Plattformbetrieb | `POST /platform/connectors/:key/lifecycle` |
| eigene Verbindungen, Konten, Reconnect/Disconnect | Mandanten-Admin | bestehende `/integrations/*` |

* **Rechte:** Sperren/Veralten/Zurückziehen (`SUSPENDED`, `DEPRECATED`, `RETIRED`) darf `connectors.suspend` (Security, Operator, Owner); jeder andere Übergang – insbesondere die Freigabe zurück auf `ACTIVE` – verlangt `connectors.write` (Operator, Release, Engineering, Owner). Security kann also sperren, aber nicht selbst wieder öffnen. Step-up, Begründung, `expectedVersion`.
* **Wirkung einer Sperre (`SUSPENDED`/`RETIRED`, OCF-01 – getestet):** Keine neuen Verbindungen (`503`, verständliche Meldung); Capabilities mit diesem Connector sind für **alle** Mandanten nicht ausführbar („Der Connector GMAIL ist plattformweit vorübergehend gesperrt (…Grund…)“), der Orchestrator führt solche Schritte als „wartet auf externes System“; bestehende Verbindungen und Historie bleiben; der Mandanten-Katalog (`GET /integrations/connectors`) zeigt `platformStatus`.
* **Vorschau:** `GET /platform/connectors/:key/impact` nennt aktive Verbindungen und betroffene Mandanten (nur Zähler).
* Mandanten können Connector-Definitionen nicht ändern (es gibt keinen Mandantenpfad; Plattformrouten weisen Mandanten-Tokens ab – OCF-02 getestet).
* Der Mock-/Simulationsmodus für Versand (`OUTBOUND_MAIL_MODE=simulated`) bleibt von einer Gmail-Sperre unberührt (es wird nichts gesendet).

## Offen

Versionierte Connector-Releases (mehrere gleichzeitig zugelassene Versionen je Connector), Aktivierung einer neuen Version mit Mandantenkohorten, Health-Verträge (`healthContractRef`) und laufende Aktionen kontrolliert beenden (heute: neue Aktionen werden blockiert, laufende Schritte laufen aus bzw. scheitern ehrlich).
