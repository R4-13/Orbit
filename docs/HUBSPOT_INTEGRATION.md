# HubSpot-Anbindung (CRM)

Status: **TESTED WITH MOCK** (Unit und E2E mit nachgebauter Schnittstelle) und **LIVE TESTED** gegen einen HubSpot-Testaccount am 17.10.2026
(`apps/api/scripts/hubspot-live-check.ts`). Nicht abgedeckt: mehrere Kundenaccounts über OAuth (siehe „Grenzen“).

## Zugang: Service-Schlüssel

HubSpot ersetzt die früheren privaten Apps durch **Service-Schlüssel** (kontoweite Zugangsberechtigung für Aufrufe von System zu System, als Bearer-Token;
<https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys>). Der **persönliche Zugriffsschlüssel** (für die
HubSpot-Entwickler-CLI) und der **Entwickler-API-Schlüssel** (nur für einzelne Sonderfunktionen) sind für diese Anbindung nicht geeignet.

Anlegen in HubSpot (Entwicklung → Schlüssel → Service-Schlüssel; Super-Admin oder Recht „Entwicklerwerkzeuge“): Berechtigungen
`crm.objects.contacts.read/write`, `crm.objects.companies.read/write`, `crm.objects.deals.read/write` – mehr nicht. Der Schlüssel wird nur einmal angezeigt.

In ORBIT: **Systeme & Verbindungen → HubSpot → Verbinden** und den Schlüssel einfügen. ORBIT prüft ihn vor dem Speichern (lesend, je Bereich) und nennt, was fehlt;
nichts wird gespeichert, solange er nicht stimmt. Der Schlüssel liegt AES-256-GCM-verschlüsselt im Tresor des Betriebs, wird nie wieder angezeigt und nie in
Antworten oder Protokollen ausgegeben. `HUBSPOT_SERVICE_KEY` in der `.env` dient nur dem Skript `hubspot-live-check.ts`, nie dem laufenden Betrieb (ein globaler
Schlüssel gäbe jedem Betrieb Zugriff auf denselben HubSpot-Account).

## Was ORBIT in HubSpot tut (alle Aufrufe aus der offiziellen Referenz, https://developers.hubspot.com/docs/api-reference)

| ORBIT | HubSpot |
|---|---|
| Kontakt abgleichen/anlegen | `POST /crm/v3/objects/contacts/search` (E-Mail, `EQ`), sonst `POST /crm/v3/objects/contacts` |
| Unternehmen abgleichen/anlegen | `POST /crm/v3/objects/companies/search` (Domain, `EQ`), sonst `POST /crm/v3/objects/companies` |
| Kontakt ↔ Unternehmen, Deal ↔ Kontakt/Unternehmen | `PUT /crm/v4/objects/{von}/{id}/associations/default/{nach}/{id}` (Standardverknüpfung, keine selbst gewählten Typkennungen) |
| Anfrage | `POST /crm/v3/objects/deals` in der ersten Phase der ersten Pipeline (`GET /crm/v3/pipelines/deals`); je Betrieb über `Integration.config` (`dealPipeline`, `dealStage`) einstellbar |
| Aktivität | `POST /crm/v3/objects/notes` am Kontakt (Verknüpfungstyp 202, „Note to contact“) |
| Verbindungstest | `GET /crm/v3/objects/{contacts,companies,deals}?limit=1` |

Grundsätze:

* **HubSpot führt.** Ein gefundener Kontakt oder ein gefundenes Unternehmen wird **nicht verändert** (kein Überschreiben von Namen durch E-Mail-Angaben).
* **Kein stilles Ausweichen.** Fehlt dem Schlüssel etwas, ist er abgelehnt oder ist HubSpot gestört, bekommt der Aufrufer einen benannten, bei Ausfall/Drosselung
  wiederholbaren Fehler. Es wird nie auf die Test-Ablage ausgewichen (sonst entstünden Datensätze, die HubSpot nie sieht). Ein abgelehnter Schlüssel setzt die
  Verbindung auf „Anmeldung erforderlich“.
* **Lesen wird bei Drosselung/Ausfall einmal wiederholt, Anlegen nie blind** (kein doppelter Datensatz).
* **Kundenverzeichnis:** HubSpot ist (nur für verbundene Betriebe) ein Kundenverzeichnis neben „Kontakte in ORBIT“. Eine Suche, die HubSpot nicht beantworten kann,
  ist „nicht erreichbar“ – nie „nicht gefunden“.
* **Nachweis:** der Betriebsnachweis führt das CRM eines verbundenen Betriebs als **echt (live)**, sonst weiter als simuliert.
* **Altbestand:** Kontakte und Unternehmen, die ORBIT vor der Anbindung angelegt hat (Kennung der Test-Ablage), werden beim ersten Bedarf in HubSpot gesucht bzw.
  angelegt und die HubSpot-Kennung in ORBIT festgehalten.

## Beobachtungen aus dem Test gegen den echten Account

* **Suchindex hinkt hinterher:** ein soeben angelegtes Unternehmen war erst nach ca. 7 Sekunden über die Suche auffindbar. Der Adapter merkt sich deshalb soeben
  angelegte Kontakte/Unternehmen 2 Minuten im Prozess. Zwischen verschiedenen Prozessen (API und Worker) gibt es dieses Gedächtnis nicht; ORBITs eigene
  Dublettenprüfung (Domain/E-Mail in den eigenen Tabellen) fängt den Normalfall ab.
* **HubSpot legt selbst Unternehmen an:** zu einem neuen Kontakt mit Firmen-E-Mail-Adresse legt HubSpot (je nach Account-Einstellung) automatisch ein Unternehmen zur
  Adress-Domain an bzw. ordnet es zu. Das ist eine HubSpot-Einstellung, kein Fehler von ORBIT; Testdaten müssen danach auch diese Unternehmen aufräumen (das tut das
  Prüfskript).
* Die Listen-Antwort der Pipelines enthält die Phasen je Pipeline (`results[].stages[]`), sortiert wird nach `displayOrder`.

## Grenzen

* **Ein Account je Betrieb, kein OAuth.** Ein Service-Schlüssel gilt für genau einen HubSpot-Account. Sollen sich viele Kunden mit ihrem eigenen HubSpot per Anmelde-
  knopf verbinden, ist eine projektbasierte App mit OAuth nötig (Client-ID/Secret, Redirect-URI; `HUBSPOT_CLIENT_ID` usw. sind dafür vorgesehen, aber ungenutzt).
* **Keine Webhooks** (Service-Schlüssel können sie nicht): Änderungen in HubSpot erkennt ORBIT nur bei der nächsten Suche, nicht von selbst.
* **Deals statt „Leads“:** HubSpots eigenes Leads-Objekt gibt es nur in bestimmten Tarifen und verlangt andere Berechtigungen.
* HubSpots Dokumentation nennt die Verknüpfungs-Pfade inzwischen auch mit Datumsversion (`/crm/objects/2026-09/...`); verwendet wird der bewährte
  `/crm/v4/...`-Pfad, der im Test funktioniert hat. Bei einer Abkündigung ist `HubSpotCrmConnector.associate` die einzige Stelle.
* Service-Schlüssel waren laut einer Quelle zeitweise in öffentlicher Beta; bei Änderungen von HubSpot ist der Zugang zu prüfen.

## Prüfen

```bash
set -a && source .env && set +a        # enthält HUBSPOT_SERVICE_KEY (nur für dieses Skript)
pnpm --filter @orbit/api exec ts-node scripts/hubspot-live-check.ts
```

Das Skript legt eindeutig gekennzeichnete Testdatensätze („ORBIT-Test …“) an, spielt den ganzen Weg durch und löscht alles wieder (HubSpot-Papierkorb, 90 Tage).
Nur gegen einen Testaccount ausführen.
