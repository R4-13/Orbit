# Demo-Daten — Musterwerk GmbH

`pnpm prisma:seed` (siehe `packages/domain/prisma/seed.ts`) legt einen
vollständigen Demo-Mandanten "Musterwerk GmbH" (Slug `musterwerk`) an. Der
Seed ist idempotent: ein erneuter Lauf löscht den vorherigen
`musterwerk`-Mandanten (kaskadierend) und legt ihn frisch an.

Voraussetzung: `DATABASE_URL` zeigt auf eine migrierte Datenbank
(`pnpm prisma:deploy` bzw. `pnpm prisma:migrate` vorher ausgeführt).

## Login

Alle Demo-Nutzer haben dasselbe Passwort: **`Musterwerk#2026!`**

| E-Mail | Rolle | Name |
|---|---|---|
| `admin@musterwerk.example` | Tenant-Admin | Anna Admin |
| `finance@musterwerk.example` | Finance-Sachbearbeiterin | Frank Finanz |
| `sales@musterwerk.example` | Sales-Sachbearbeiterin | Sina Sales |
| `approval@musterwerk.example` | Freigeberin | Alex Approve |
| `viewer@musterwerk.example` | Nur-Lese-Zugriff | Vera View |

## Was ist enthalten

**Finance** (vier Vorgänge, die die wichtigsten Zustände des
Rechnungsworkflows zeigen — siehe `docs/ASSUMPTIONS.md` Phase 7):

- **Papier & Büro GmbH** — aktiver Lieferant, eine vollständig durchgelaufene
  Rechnung (RE-2026-0312, freigegeben, gebucht, an die FiBu übertragen)
- **IT-Service Nord GmbH** — aktiver Lieferant, eine freigegebene Rechnung
  (INV-8842), die noch auf die Übertragung wartet
- **Schmidt Werkzeugbau KG** — Lieferant mit Status "Freigabe erforderlich"
  (`PENDING_APPROVAL`), zugehörige Rechnung wartet auf die
  Lieferantenfreigabe
- Eine erkannte **Dublette**: zwei Rechnungen mit identischer Nummer
  (RE-2026-0455) und identischem Betrag — eine bereits verarbeitet, die
  zweite als "Mögliche Dublette" markiert

**Sales** (zwei Vorgänge + ein bereits abgeschlossener Lead):

- **Nordwind Immobilien GmbH** / Julia Nord — qualifizierter Lead, offene
  Opportunity ("Büroausstattung Nordwind", Phase Angebot), vorgeschlagener
  Beratungstermin
- **Café Sonnenschein** / Markus Berg — neuer, telefonisch eingegangener
  Lead, Opportunity in der Qualifizierung, bereits bestätigter Termin
- Petra Klein — bereits konvertierter Lead (Web-Anfrage) ohne offenen
  Vorgang, als Beispiel für einen abgeschlossenen Fall

Jede wesentliche Aktion (Nutzer-/Lieferanten-/Rechnungs-/Lead-Anlage,
Freigaben, FiBu-Übertragung, Dubletten-Erkennung) erzeugt einen passenden
Eintrag im Audit-Log — insgesamt 26 Einträge nach dem Seed-Lauf.

## Bekannte Einschränkung

Die Demo-Rechnungen haben keine hinterlegten Dokumente (PDFs) — `Document`-
und `Invoice.documentId` bleiben leer, da dafür echte Datei-Uploads nach
MinIO nötig wären (siehe `docs/ASSUMPTIONS.md` #74 für die Begründung).
Alle übrigen Felder (Beträge, Status, Verknüpfungen) sind vollständig.
