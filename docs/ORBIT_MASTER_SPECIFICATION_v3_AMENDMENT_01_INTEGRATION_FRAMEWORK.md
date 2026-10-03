# ORBIT MASTER SPECIFICATION v3 — AMENDMENT 01
## Integration Setup & Connector Framework

**Projekt:** ZERIONUS / ORBIT  
**Dokumenttyp:** Verbindliches Amendment zur `ORBIT_MASTER_SPECIFICATION_v3.md`  
**Version:** 2.0  
**Status:** Entwicklungsfreigabe für Claude Code  
**Datum:** 03.10.2026  
**Gültigkeit:** Dieses Amendment ergänzt die `ORBIT_MASTER_SPECIFICATION_v3.md`. Für alle Themen zu Integrationen, Authentifizierung externer Systeme, Connectoren, Credential Handling, Guided Setup und Sonde-gestützter Systemanbindung hat dieses Amendment Vorrang, sofern eine Regelung der v3 hiervon abweicht. Alle übrigen Inhalte der v3 bleiben unverändert gültig.

## Verbindliche Generalitätsregel

Alle in dieser Spezifikation genannten Konten, E-Mail-Adressen, Unternehmensnamen, IDs, Provider-Konfigurationen und Beispieldaten dienen ausschließlich als **Beispiel-, Test- oder Abnahmedaten**.

Sie dürfen niemals:

- im Produktcode hardcodiert werden,
- als produktive Default-Werte verwendet werden,
- zu provider- oder kundenspezifischer Sonderlogik führen,
- die Mandantenfähigkeit einschränken,
- in fachlichen Workflows als feste Identitäten vorausgesetzt werden.

Insbesondere ist `handwerkernull@gmail.com` ausschließlich ein aktuelles Test-/Abnahmekonto für die Live-Validierung des generischen Gmail-Connectors.

Produktiv muss der Connector mit **jedem berechtigten Gmail- oder Google-Workspace-Konto** funktionieren. Die tatsächlich verbundene externe Identität wird dynamisch aus dem jeweiligen Provider-/OAuth-Kontext ermittelt und tenant-spezifisch gespeichert.

Dieses Prinzip gilt analog für alle zukünftigen Connectoren und alle in Spezifikationen verwendeten Beispielwerte.

---

# 1. Ziel des Amendments

ORBIT soll externe Systeme nicht über technische Freitext- oder JSON-Eingaben anbinden, sondern über ein generisches, multi-tenant-fähiges **Integration Setup & Connector Framework**.

Das Framework muss zwei Ziele gleichzeitig erfüllen:

1. **Kurzfristig:** Gmail wird als erster vollständig funktionsfähiger Referenz-Connector real angebunden. Für die technische Abnahme kann das aktuelle Testkonto `handwerkernull@gmail.com` verwendet werden. Dieses Konto ist **nicht Bestandteil der Produktlogik** und darf nicht hardcodiert werden.
2. **Strategisch:** Alle heutigen und zukünftigen Schnittstellen werden über dieselbe generische, providerunabhängige Connector-Architektur verwaltet. Ein Endkunde ohne IT-Kenntnisse muss Systeme über einfache Dialoge oder über den AI-Assistenten **Sonde** verbinden können.

Die technische Komplexität der jeweiligen API oder Authentifizierung darf nicht auf den Endanwender verlagert werden.

---

# 2. Verbindliche Produktprinzipien

## 2.1 Kein Credential-JSON für Endkunden

Freie JSON-Felder zur manuellen Eingabe technischer Zugangsdaten sind in der produktiven ORBIT-Oberfläche nicht zulässig.

Stattdessen muss jeder Connector definieren, welche Authentifizierungsart und welche Eingabefelder er benötigt. ORBIT rendert daraus den passenden Setup-Dialog.

Beispiele:

- Gmail / Microsoft 365 / HubSpot: OAuth 2.0 → Schaltfläche „Mit … verbinden“
- API-Key-Systeme: strukturiertes Feld „API Key“
- Legacy-Systeme: Server, Mandant, Benutzer, Secret/Passwort
- Spezialintegrationen: geführter Setup-Wizard

## 2.2 Minimal notwendige Berechtigungen

ORBIT darf nur die Berechtigungen anfordern, die für den aktivierten Use Case erforderlich sind.

Berechtigungen werden in einem Capability-/Permission-Modell abgebildet und können bei Bedarf schrittweise erweitert werden.

## 2.3 Multi-Tenant by Design

Alle Verbindungen, Tokens, Credentials, Sync-Zustände und Logs müssen eindeutig einem ORBIT-Tenant zugeordnet sein.

Es darf technisch nicht möglich sein, Credentials oder Daten eines Tenants über einen anderen Tenant abzurufen.

## 2.4 Sonde ist Setup-Assistent, nicht Integrations-Engine

Sonde darf:

- verwendete Systeme erfragen,
- bekannte Connectoren vorschlagen,
- Setup-Prozesse starten,
- Benutzer durch Berechtigungen führen,
- Verbindungsstatus erklären,
- Tests anstoßen,
- fehlende Berechtigungen erläutern,
- noch nicht unterstützte Systeme erfassen.

Sonde darf **keine unvalidierten Schnittstellen erfinden** und keine API-Endpunkte, Authentifizierungsverfahren oder Feldbelegungen halluzinieren.

Die technische Verbindung erfolgt ausschließlich über registrierte und validierte Connectoren.

## 2.5 Keine Beispiel- oder Testdaten im Produktcode

Beispielkonten, Beispielunternehmen, IDs, Testdaten und Demo-Werte sind niemals Bestandteil der fachlichen Produktdefinition.

Verbindlich:

- keine feste E-Mail-Adresse im Connector-Code,
- keine feste Tenant-ID,
- keine feste externe Account-ID,
- keine feste Provider-User-ID,
- keine feste Kunden-/Lieferantenidentität,
- keine Test-Credentials oder Test-Tokens in Code oder produktiven Konfigurationen,
- keine Sonderpfade für einzelne Testkonten.

Testdaten dürfen ausschließlich in klar getrennten:

- Test Fixtures,
- Seed-/Demo-Daten,
- manuellen Abnahmeskripten,
- Testdokumentationen

verwendet werden.

---

# 3. Zielarchitektur

```text
                         ORBIT
                           │
                 Integration Platform
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
 Connector Registry   Setup Engine      Credential Vault
        │                  │                  │
        │             Dynamic Forms       OAuth Tokens
        │             Guided Setup        API Keys
        │             Sonde Actions       Secrets
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                 Connector Runtime
                           │
     ┌────────────┬────────┼─────────┬─────────────┐
     │            │        │         │             │
   Gmail       M365     DATEV     Lexware      weitere
     │            │        │         │             │
   Google      Microsoft  APIs     APIs        APIs / Files
```

Das Framework besteht mindestens aus:

1. **Connector Registry**
2. **Connector Interface / SDK**
3. **Authentication Service**
4. **Credential Vault**
5. **Setup Engine**
6. **Capability & Permission Model**
7. **Connection Lifecycle Management**
8. **Sync / Event Runtime**
9. **Monitoring & Health**
10. **Audit Logging**
11. **Sonde Guided Setup Layer**

---

# 4. Connector Registry

Jeder Connector muss über standardisierte Metadaten registriert werden.

Mindestinformationen:

```yaml
id: gmail
name: Gmail
provider: Google
category: mail
status: active

authentication:
  type: oauth2

capabilities:
  - email.read
  - email.send
  - attachment.read
  - thread.read

setup:
  mode: guided
  sonde_supported: true

health_check:
  supported: true
```

Die Registry muss mindestens folgende Felder unterstützen:

- `id`
- `name`
- `provider`
- `category`
- `description`
- `icon`
- `status`
- `authentication.type`
- `required_fields`
- `optional_fields`
- `capabilities`
- `permissions/scopes`
- `setup.mode`
- `sonde_supported`
- `test_connection`
- `disconnect_supported`
- `sync_modes`
- `webhook_support`
- `polling_support`
- `documentation_reference`
- `version`

---

# 5. Unterstützte Authentifizierungstypen

Das Framework muss generisch mindestens folgende Verfahren unterstützen:

## 5.1 OAuth 2.0

Für z. B.:

- Google
- Microsoft
- HubSpot
- Salesforce

Funktionalität:

- Authorization URL erzeugen
- `state` gegen CSRF absichern
- PKCE unterstützen, soweit Provider/Flow dies vorsieht
- Callback empfangen
- Authorization Code gegen Tokens tauschen
- Access Token speichern
- Refresh Token speichern
- Token automatisch erneuern
- Re-Consent unterstützen
- Verbindung trennen / Tokens widerrufen, soweit Provider dies unterstützt

## 5.2 API Key

Das UI darf nur notwendige Felder anzeigen.

Beispiel:

```text
API Key
[********************************]

[Verbindung testen]
```

Secrets dürfen nach dem Speichern nicht im Klartext erneut angezeigt werden.

## 5.3 Benutzer / Secret

Für Legacy-Systeme:

- Server / Host
- optional Port
- Mandant / Company / Tenant ID
- Benutzer
- Passwort / Secret
- optionale Zusatzparameter

## 5.4 Custom / Guided Enterprise Setup

Für Integrationen mit komplexeren Voraussetzungen, z. B. Zertifikaten, Mandantenfreischaltung oder Provider-spezifischen Schritten.

Das Framework muss hierfür mehrstufige Setup-Wizards unterstützen.

---

# 6. Credential Vault & Security

Credentials sind sicherheitskritische Daten und müssen außerhalb normaler Business-Daten behandelt werden.

Die bestehende AES-256-GCM-Verschlüsselung der ORBIT-Codebasis darf und soll wiederverwendet werden. Sie gilt jedoch **nicht allein als vollständige Zielarchitektur** des Credential-Vault-Konzepts.

ORBIT muss eine generische Credential-/Secret-Store-Abstraktion bereitstellen, z. B.:

```typescript
interface CredentialVaultService {
  storeSecret(input: StoreSecretInput): Promise<CredentialReference>;
  readSecret(reference: CredentialReference): Promise<ResolvedSecret>;
  updateSecret(reference: CredentialReference, input: UpdateSecretInput): Promise<void>;
  deleteSecret(reference: CredentialReference): Promise<void>;
}
```

Für das MVP darf die konkrete Implementierung dieses Services intern weiterhin eine AES-256-GCM-verschlüsselte Datenbankspeicherung verwenden.

Die Architektur muss aber ermöglichen, später auf einen externen Secret Manager / Vault umzusteigen, ohne:

- Connector-Code umzubauen,
- Business-Services umzubauen,
- OAuth-Flows neu zu implementieren,
- die `IntegrationConnection`-Schnittstelle zu ändern.

Verbindliche Anforderungen:

- Speicherung verschlüsselt at rest
- keine Secrets im Frontend State persistieren
- keine Secrets in Application Logs
- keine Secrets in Error Messages
- kein Klartext in Analytics / Telemetrie
- Tenant-isolierte Speicherung
- Zugriff nur für benötigte Backend-Services
- Secret Rotation vorbereiten
- Credential-Versionierung ermöglichen
- Timestamp für Erstellung / letzte Aktualisierung
- Audit Events für Connect / Reconnect / Disconnect
- Zugriff auf Secrets ausschließlich über die Credential-/Secret-Store-Abstraktion
- Connectoren und Business-Services speichern oder lesen Secrets niemals direkt aus normalen Integrationstabellen

Empfohlene Datenstruktur:

```text
IntegrationConnection
├── id
├── tenant_id
├── connector_id
├── external_account_id
├── external_account_display_name
├── status
├── granted_capabilities
├── credential_reference
├── created_at
├── updated_at
├── last_success_at
├── last_error_at
└── last_error_code
```

`IntegrationConnection` speichert **keine Provider-Secrets oder Tokens direkt**. Es kennt ausschließlich eine `credential_reference`.

Die eigentlichen Secrets liegen hinter der Credential-/Secret-Store-Abstraktion.

Für das MVP kann die konkrete Secret-Store-Implementierung intern auf der bereits vorhandenen verschlüsselten Datenbankablage basieren. Die fachliche und Connector-seitige Architektur darf davon jedoch nicht abhängen.

---

# 7. Gmail als erster Referenz-Connector

## 7.1 Ziel

Der Gmail-Connector muss beliebige berechtigte Gmail- und Google-Workspace-Konten über Google OAuth 2.0 mit ORBIT verbinden können, ohne dass Gmail-Benutzername oder Passwort in ORBIT eingegeben werden.

Für die aktuelle technische Abnahme kann `handwerkernull@gmail.com` als Testkonto verwendet werden. Die Adresse ist kein Produktparameter und darf weder im Connector-Code noch in produktiver Konfiguration hardcodiert werden.

## 7.2 Provider-Konfiguration

ZERIONUS richtet einmalig für ORBIT ein Google Cloud Projekt ein.

ORBIT benötigt zentral:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

Diese Werte sind **plattformseitige ORBIT-Konfiguration** und werden nicht pro Endkunde abgefragt.

Sie dürfen nicht im Source Code, Repository, Frontend oder in Logs hinterlegt werden. Sie werden ausschließlich über die jeweilige lokale bzw. Deployment-Environment-/Secret-Konfiguration bereitgestellt.

## 7.2.1 Dynamische externe Kontoidentität

Nach erfolgreichem OAuth-Flow muss ORBIT die tatsächlich autorisierte Google-Identität dynamisch ermitteln.

Mindestens soweit vom Provider verfügbar:

```text
external_account_id
external_account_display_name
provider_tenant/domain
```

Für Gmail kann `external_account_display_name` beispielsweise die autorisierte E-Mail-Adresse sein.

Es gibt keine feste erwartete Gmail-Adresse in der Produktlogik.

## 7.3 Enduser Flow

```text
ORBIT Integrationen
       ↓
Gmail
       ↓
[Mit Google verbinden]
       ↓
Google Login / Kontoauswahl
       ↓
Google Consent
       ↓
ORBIT Callback
       ↓
Token Exchange
       ↓
Token verschlüsselt speichern
       ↓
Connection Test
       ↓
✓ Verbunden
```

Der Benutzer darf niemals aufgefordert werden, einen OAuth Refresh Token, Client Secret oder Credential JSON manuell zu erzeugen oder einzufügen.

## 7.4 Gmail Scopes

Für das MVP sollen Scopes minimal und use-case-orientiert gewählt werden.

Beispielhafte Capability-Zuordnung:

```text
email.read       → Gmail Readonly Scope
email.send       → Gmail Send Scope
email.modify     → nur bei tatsächlichem Bedarf
```

Das Capability-Modell soll ermöglichen, `email.send` erst dann anzufordern, wenn eine Funktion aktiv genutzt wird, die Senderechte benötigt.

## 7.5 Gmail MVP-Funktionen

Mindestens:

- Verbindung herstellen
- externes Konto erkennen und anzeigen
- Verbindung testen
- E-Mail-Liste lesen
- einzelne Nachricht lesen
- Thread lesen
- Anhänge lesen / herunterladen
- optional: Entwurf vorbereiten
- optional: E-Mail senden
- Token Refresh
- Disconnect
- Fehlerstatus anzeigen

## 7.6 Gmail UI

Nicht mehr:

```text
Zugangsdaten (JSON)
{ ... }
```

Sondern:

```text
Gmail
Google Gmail mit ORBIT verbinden

[ G  Mit Google verbinden ]
```

Nach Verbindung:

```text
Gmail
✓ Verbunden

Konto: <dynamisch ermitteltes Google-Konto>
Status: Aktiv
Letzte erfolgreiche Verbindung: <Timestamp>

[Verbindung testen]
[Neu verbinden]
[Trennen]
```

Beispiel für die aktuelle Testabnahme:

```text
Konto: handwerkernull@gmail.com
```

Dieser Wert stammt aus der real verbundenen Provider-Identität und darf niemals als fester UI- oder Codewert implementiert werden.

---

# 8. Dynamic Setup Engine

Das Frontend darf Setup-Formulare nicht vollständig hardcodieren.

Der Connector muss definieren können, welche Eingaben erforderlich sind.

Beispiel:

```yaml
authentication:
  type: api_key

fields:
  - key: api_key
    label: API Key
    type: secret
    required: true
```

Das Setup Engine Frontend erzeugt daraus automatisch den passenden Dialog.

Unterstützte Feldtypen mindestens:

- text
- secret
- url
- email
- number
- select
- multiselect
- checkbox
- certificate/file
- oauth_action

Validierungen müssen über Metadaten definierbar sein.

---

# 9. Capability & Permission Model

Ein Connector ist nicht nur „verbunden" oder „nicht verbunden".

ORBIT muss wissen, **was** diese Verbindung tun darf.

Beispiele:

```text
Gmail
├── email.read
├── email.send
├── attachment.read
└── thread.read
```

oder:

```text
CRM
├── customer.read
├── customer.create
├── customer.update
├── opportunity.read
└── opportunity.create
```

Capabilities werden genutzt für:

- Agentenberechtigungen
- Sonde-Aktionen
- UI-Freischaltung
- Human-in-the-Loop
- Scope-Anforderung
- Policy Enforcement

Ein Agent darf niemals eine Aktion ausführen, wenn die entsprechende Capability nicht vorhanden und freigegeben ist.

---

# 10. Connection Lifecycle

Eine Verbindung hat mindestens folgende Statuswerte:

```text
NOT_CONFIGURED
CONNECTING
CONNECTED
DEGRADED
AUTH_REQUIRED
ERROR
DISCONNECTED
```

Das System muss erkennen können:

- Token abgelaufen
- Refresh fehlgeschlagen
- Provider nicht erreichbar
- Berechtigung entzogen
- fehlender Scope
- falscher API Key
- Credential geändert
- Rate Limit

Der Benutzer erhält eine verständliche Meldung.

Beispiel:

> Ihre Gmail-Verbindung benötigt eine erneute Anmeldung. Es wurden keine Zugangsdaten verloren. Bitte verbinden Sie das Google-Konto erneut.

Keine rohe API-Fehlermeldung an Endanwender ausgeben.

---

# 11. Sonde Guided Integration Setup

## 11.1 Ziel

Sonde soll einen nicht-technischen Endanwender durch die Erfassung und Anbindung seiner Systemlandschaft führen.

Beispiel:

```text
Sonde:
Welche Systeme nutzen Sie heute für E-Mail, Kalender,
Buchhaltung, Kundenverwaltung und Telefonie?
```

Benutzer:

```text
Gmail, Google Kalender und Lexware.
```

Sonde:

```text
Ich habe passende Integrationen gefunden.
Beginnen wir mit Gmail.

[Mit Google verbinden]
```

## 11.2 Sonde Tooling

Sonde erhält keine Secrets.

Sonde interagiert mit dem Integration Framework ausschließlich über definierte Tools/Actions, z. B.:

- `list_connectors`
- `get_connector_requirements`
- `start_connector_setup`
- `get_connection_status`
- `test_connection`
- `request_additional_capability`
- `disconnect_connector`

Sensitive Credential-Eingaben werden vom Setup Engine UI behandelt, nicht im freien Chattext.

## 11.3 System Discovery

Sonde soll strukturiert mindestens folgende Kategorien abfragen können:

- E-Mail
- Kalender
- Telefonie
- Messenger
- CRM
- ERP
- Buchhaltung/FIBU
- Dokumente/Dateien
- Auftragsmanagement
- Shop/E-Commerce
- Banking/Zahlung
- sonstige Fachsysteme

Ergebnis ist eine Tenant-Systemlandkarte.

---

# 12. Umgang mit unbekannten Systemen

Wenn ein Benutzer ein System nennt, für das kein aktiver Connector existiert:

1. Sonde kennzeichnet das System als **nicht unterstützt / noch nicht verfügbar**.
2. ORBIT speichert den Bedarf strukturiert als Connector Request.
3. Optional darf ein Admin recherchierte Integrationsinformationen ergänzen.
4. Ein unbekanntes System wird niemals automatisch als funktionsfähig dargestellt.

Mögliche Status:

```text
KNOWN_AND_AVAILABLE
KNOWN_IN_DEVELOPMENT
KNOWN_NOT_SUPPORTED
UNKNOWN_REQUIRES_REVIEW
```

Später kann ein Connector Marketplace / Catalog daraus aufgebaut werden.

---

# 13. API Design für das Integration Framework

Beispielhafte interne API-Endpunkte:

```text
GET    /api/integrations/connectors
GET    /api/integrations/connectors/{connectorId}
GET    /api/integrations/connections
POST   /api/integrations/{connectorId}/connect
GET    /api/integrations/{connectorId}/callback
POST   /api/integrations/connections/{id}/test
POST   /api/integrations/connections/{id}/reconnect
DELETE /api/integrations/connections/{id}
GET    /api/integrations/connections/{id}/health
POST   /api/integrations/connections/{id}/capabilities
```

Provider-spezifische Details müssen hinter dem Connector Interface gekapselt sein.

Business-Services dürfen nicht direkt gegen Gmail-/Microsoft-/Provider-SDKs programmieren, sondern greifen über das ORBIT Integration Framework zu.

---

# 14. Connector Interface

Jeder Connector implementiert mindestens ein gemeinsames Interface.

Pseudo-Typisierung:

```typescript
interface OrbitConnector {
  metadata(): ConnectorMetadata;
  authType(): AuthType;
  startConnection(ctx: ConnectionContext): Promise<AuthStartResult>;
  completeConnection(ctx: CallbackContext): Promise<ConnectionResult>;
  testConnection(connectionId: string): Promise<HealthResult>;
  refreshAuthentication?(connectionId: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  getCapabilities(): Capability[];
}
```

Domänenspezifische Interfaces ergänzen dies, z. B.:

```typescript
interface MailConnector {
  listMessages(...): Promise<Message[]>;
  getMessage(...): Promise<Message>;
  getThread(...): Promise<Thread>;
  getAttachment(...): Promise<Attachment>;
  sendMessage?(...): Promise<SendResult>;
}
```

Dadurch können Agents und ORBIT Services mit einer standardisierten Mail-Schnittstelle arbeiten, unabhängig davon, ob Gmail oder Outlook dahinterliegt.

---

# 15. Event- und Sync-Modell

Connectoren müssen mindestens einen der folgenden Modi unterstützen können:

- Webhook / Push
- Polling
- On-Demand Query
- Batch Sync

Für Gmail ist ein MVP zunächst mit On-Demand und/oder Polling zulässig. Die Architektur muss spätere Push-/Webhook-Mechanismen ermöglichen.

Jeder Sync-Prozess benötigt:

- Tenant Context
- Connection ID
- Cursor / Delta State soweit verfügbar
- Retry Handling
- Idempotency
- Rate-Limit Handling
- Audit/Technical Logging

---

# 16. Datenhaltung und System-of-Record-Prinzip

ORBIT soll externe Stammdaten und Bewegungsdaten grundsätzlich nicht unnötig duplizieren.

Die bestehende v3-Regel bleibt gültig: Daten sollen soweit sinnvoll in Echtzeit oder bedarfsorientiert aus den zugrunde liegenden Systemen gelesen werden.

Das Integration Framework muss unterscheiden zwischen:

- referenzierten Daten
- gecachten Daten
- ORBIT-eigenen Prozessdaten
- temporären AI-Kontextdaten

Connectoren müssen deklarieren können, welche Daten dauerhaft, temporär oder gar nicht gespeichert werden dürfen.

---

# 17. Frontend / UX

## 17.1 Bereich „Systeme & Verbindungen"

Im Administrationsbereich wird ein einheitlicher Bereich geschaffen:

```text
Systeme & Verbindungen

✓ Gmail
  <verbundenes Google-Konto>
  Aktiv

○ Google Kalender
  Noch nicht verbunden

○ Lexware
  Noch nicht verbunden

[+ System hinzufügen]
[✨ Mit Sonde einrichten]
```

## 17.2 Connector Detail

Ein Connector zeigt mindestens:

- Name / Provider
- verbundenes Konto
- Status
- Fähigkeiten/Berechtigungen
- letzte erfolgreiche Aktivität
- Verbindung testen
- neu verbinden
- trennen

## 17.3 Zwei Setup-Modi

ORBIT unterstützt:

1. **Geführtes Setup mit Sonde**
2. **Direktes manuelles Setup für erfahrene Admins**

Beide Wege verwenden dieselbe Backend-Logik und dieselbe Connector Registry.

---

# 18. Migration der bestehenden Implementierung

Die aktuell vorhandene Gmail-/Connector-Darstellung mit frei editierbaren JSON Credentials darf nicht als produktiver Endzustand bestehen bleiben.

Claude Code soll:

1. bestehende Connector-Komponenten identifizieren,
2. aktuelle Mock-/Placeholder-Logik dokumentieren,
3. wiederverwendbare Teile erhalten,
4. technische Credential-Felder aus dem normalen Enduser-UI entfernen,
5. das neue Connector Interface einführen,
6. Gmail auf das neue Interface migrieren,
7. bestehende Tests anpassen,
8. Regressionen bei anderen ORBIT-Modulen vermeiden.

Keine Big-Bang-Neuschreibung, sofern bestehende Komponenten sinnvoll wiederverwendet werden können.

---

# 19. Entwicklungsphasen

## Phase 1 — Minimal Connector Core + Gmail

Muss jetzt umgesetzt werden.

Enthält:

- Connector Interface
- Connector Registry Basis
- Tenant Connection Model
- Secure Credential Reference
- generische Credential-/Secret-Store-Abstraktion
- MVP Secret-Store-Implementierung auf Basis der bestehenden AES-256-GCM-Verschlüsselung
- OAuth2 Basis-Service
- Gmail Connector
- Google OAuth Flow
- Gmail Read Access
- Connection Test
- Disconnect
- UI ohne JSON
- Logging / Audit

**Definition of Done:** Ein beliebiges berechtigtes Gmail-/Google-Workspace-Konto kann über „Mit Google verbinden" mit ORBIT verbunden werden und ORBIT kann mindestens E-Mails lesen. Für die aktuelle Live-Abnahme kann `handwerkernull@gmail.com` verwendet werden. Die erfolgreiche Abnahme mit diesem Konto beweist das generische Verhalten; sie darf keine konto-spezifische Implementierung voraussetzen.

## Phase 2 — Generic Integration Framework

Enthält:

- Dynamic Setup Forms
- API-Key Auth
- Credentials Auth
- Capability Model
- Health Monitoring
- standardisierte Fehlermeldungen
- Connector Versioning
- Registry Administration
- mehrere Connector-Kategorien

**Definition of Done:** Ein zweiter und dritter Connector können hinzugefügt werden, ohne die grundlegende Setup-/Credential-/Lifecycle-Architektur neu zu implementieren.

## Phase 3 — Sonde Guided Setup

Enthält:

- System Discovery Dialog
- Integration Tools für Sonde
- Systemlandkarte pro Tenant
- Guided Setup
- Status-/Fehlererklärung
- Connector Requests für unbekannte Systeme

**Definition of Done:** Ein nicht-technischer Benutzer kann in Sonde angeben, welche Systeme er nutzt, und bekannte Systeme über einen geführten Dialog anbinden.

---

# 20. Akzeptanzkriterien Gmail / Phase 1

Die Umsetzung gilt nur dann als abgeschlossen, wenn alle folgenden Kriterien erfüllt sind:

1. Nutzer kann in ORBIT „Gmail verbinden" auswählen.
2. Nutzer wird zum offiziellen Google-Login/Consent weitergeleitet.
3. ORBIT fragt kein Gmail-Passwort ab.
4. Nach Consent gelangt Nutzer zurück zu ORBIT.
5. ORBIT speichert Token sicher und tenant-isoliert.
6. ORBIT zeigt das verbundene Google-Konto an.
7. ORBIT kann mindestens Nachrichten aus Gmail abrufen.
8. Token Refresh funktioniert ohne erneutes Login, sofern Google dies erlaubt.
9. „Verbindung testen" liefert verständlichen Status.
10. „Trennen" deaktiviert die Verbindung und entfernt/invalidiert Credential-Referenzen gemäß Implementierung.
11. Secrets erscheinen nicht in Browser Logs, Server Logs oder UI.
12. Ungültige/entzogene Berechtigungen werden benutzerverständlich behandelt.
13. Das freie JSON-Credential-Feld ist für Gmail im Enduser-UI entfernt.
14. Multi-Tenant Isolation ist durch automatisierte Tests abgesichert.
15. Die verbundene externe Google-Identität wird dynamisch aus dem Provider-Kontext ermittelt.
16. Keine konkrete Gmail-Adresse ist im Produktcode oder in produktiver Konfiguration hardcodiert.
17. Der Connector funktioniert unabhängig von `handwerkernull@gmail.com`; dieses Konto darf ausschließlich als Test-/Abnahmedatum verwendet werden.

---

# 21. Akzeptanzkriterien Framework

1. Neue Connectoren nutzen ein gemeinsames Interface.
2. Authentifizierung ist vom fachlichen Connector-Code getrennt.
3. Credentials sind nicht Bestandteil normaler Business-Tabellen im Klartext.
4. Setup-UI kann aus Connector-Metadaten erzeugt werden.
5. Capabilities werden technisch geprüft und nicht nur angezeigt.
6. Sonde erhält keinen direkten Zugriff auf Secrets.
7. Connector-Status und Health sind tenantbezogen abrufbar.
8. Provider-spezifische Implementierung ist gekapselt.
9. Unbekannte Systeme werden niemals automatisch als kompatibel markiert.
10. Weitere Connectoren können ohne Änderung des Framework-Kerns ergänzt werden, sofern sie in die vorgesehenen Auth-/Capability-Muster passen.
11. Connectoren greifen auf Secrets ausschließlich über die generische Credential-/Secret-Store-Abstraktion zu.
12. Die konkrete physische Secret-Speicherung kann später gegen einen externen Vault/Secret Manager ausgetauscht werden, ohne Connector- oder Business-Code zu ändern.
13. Beispiel-, Test- und Abnahmedaten beeinflussen keine produktive Connector- oder Workflow-Logik.

---

# 22. Nicht-funktionale Anforderungen

## Security

- Least Privilege
- OAuth State Validation
- CSRF Schutz
- Secret Encryption
- Tenant Isolation
- Audit Logging
- sichere Fehlerausgabe
- keine Secrets in LLM Prompts

## Reliability

- Retry mit Backoff
- Rate Limit Handling
- Timeout Handling
- Health State
- Idempotency

## Maintainability

- Provider Adapter klar getrennt
- keine Gmail-spezifische Logik in generischen Business Services
- Tests pro Connector
- gemeinsame Contract Tests
- keine fest verdrahteten Testkonten oder Beispielidentitäten
- provider- und tenant-spezifische Identitäten ausschließlich daten-/konfigurationsgetrieben

## UX

- kein IT-Fachwissen voraussetzen
- keine technische Credential-Syntax für Enduser
- klare Statusanzeige
- geführte Fehlerbehebung
- mobile/responsive nutzbar

---

# 23. Claude-Code-Auftrag

Claude Code soll vor Implementierung:

1. die bestehende ORBIT Codebasis analysieren,
2. alle aktuellen Integration-/Connector-/Credential-Komponenten identifizieren,
3. dokumentieren, welche Teile wiederverwendet werden,
4. eine konkrete Umsetzungsplanung für Phase 1 erstellen,
5. keine bestehende funktionierende Architektur unnötig ersetzen,
6. danach Phase 1 implementieren,
7. Tests ergänzen,
8. Migration dokumentieren,
9. sicherstellen, dass sämtliche Beispielkonten und Testdaten ausschließlich in Test-/Abnahmekontexten vorkommen,
10. die Credential-/Secret-Store-Abstraktion vor Abschluss von Phase 1 implementieren.

Fehlende echte Provider Credentials blockieren **nicht** die generische Implementierung.

In diesem Fall muss Claude Code:

```text
Connector-Architektur implementieren
+
OAuth-/Auth-Flow implementieren
+
Mock/Contract Tests implementieren
+
Setup dokumentieren
+
Live-Validierung transparent als BLOCKED_BY_EXTERNAL_CREDENTIALS /
REQUIRES_PROVIDER_CREDENTIALS markieren
```

Erst der reale Token-Austausch bzw. Live-Test benötigt die plattformseitigen Provider Credentials.

Bei Konflikten mit der bisherigen Implementierung gilt:

> Bestehende Funktionalität erhalten, aber die Zielarchitektur dieses Amendments verbindlich herstellen.

Claude Code darf keine temporären Mock-Credentials als finale Lösung belassen.

---

# 24. Verbindliche Architekturentscheidung

**Gmail wird nicht als einmaliger Sonderfall implementiert.**

Gmail ist der erste reale Referenz-Connector des generischen ORBIT Integration Setup & Connector Frameworks.

Der Connector ist vollständig generisch zu implementieren. Konkrete Testkonten dienen ausschließlich der Verifikation.

Alle weiteren Integrationen sollen nach demselben Modell implementiert werden.

Damit wird verhindert, dass ORBIT für Gmail, Microsoft 365, DATEV, Lexware, HubSpot, Telefonie oder spätere Systeme jeweils eigene, voneinander unabhängige Setup- und Credential-Logik entwickelt.

---

# 25. Verhältnis zur ORBIT Master Specification v3

Dieses Dokument ist **kein Ersatz** der `ORBIT_MASTER_SPECIFICATION_v3.md`.

Es ist ein verbindliches Amendment mit engerem Scope.

Die gültige Dokumentenhierarchie lautet ab Freigabe:

```text
ORBIT_MASTER_SPECIFICATION_v3.md
        │
        └── AMENDMENT 01
            Integration Setup & Connector Framework
```

Bei zukünftiger Erstellung einer v4 sollen die Inhalte dieses Amendments vollständig in die neue Master Specification konsolidiert werden, damit wieder eine einzige vollständige Single Source of Truth besteht.

---

# 26. Änderungen gegenüber Amendment v1

Version 2.0 präzisiert die bestehende Zielarchitektur ohne Änderung des fachlichen Grundscopes.

Verbindlich ergänzt bzw. klargestellt wurden:

1. **Generality Requirement:** Alle Beispielkonten, E-Mail-Adressen, IDs und Demo-Daten sind ausschließlich Test-/Abnahmedaten.
2. **Kein Hardcoding:** `handwerkernull@gmail.com` und vergleichbare Beispielwerte dürfen niemals in Produktlogik oder produktiver Konfiguration fest verdrahtet werden.
3. **Dynamische externe Identität:** Verbundene Konten werden nach Authentifizierung dynamisch vom Provider ermittelt.
4. **Credential Vault Abstraction:** Die bestehende AES-256-GCM-Verschlüsselung wird wiederverwendet, aber hinter einer generischen Credential-/Secret-Store-Abstraktion gekapselt.
5. **MVP Secret Store:** Verschlüsselte DB-Speicherung ist als konkrete MVP-Implementierung zulässig; Connectoren dürfen nicht von dieser physischen Speicherung abhängen.
6. **Spätere Vault-Migration:** Wechsel auf externen Secret Manager / Vault muss ohne Umbau von Connector- oder Business-Code möglich sein.
7. **Provider Secrets:** Plattformseitige OAuth-Credentials dürfen nicht im Chat, Source Code, Repository, UI oder in Logs landen.
8. **Missing Credentials:** Fehlende Provider Credentials blockieren nur die Live-Validierung, nicht die generische Implementierung.
9. **Acceptance Criteria:** Gmail- und Framework-Abnahmekriterien wurden entsprechend erweitert.

---

# END OF AMENDMENT
