# Technische Pilotvorbereitung – Übergabenotiz (Zwischenstand, WIP)

**Branch:** `wip/pilot-technik-2026-11` · **Basis:** `78c4992` (main). **Dies ist keine Abnahme und keine Freigabe für Merge oder Deployment.** Keine Zugangsdaten in dieser Notiz.

## Stand der Arbeit

| Teil | Stand | Nachweis |
|---|---|---|
| Preiskatalog `packages/shared/src/ai-pricing.ts` (gpt-6-luna, Quelle `developers.openai.com/api/docs/pricing`, gelesen 02.11.2026) | umgesetzt | Unit-Test grün |
| Kostenwächter: Reservierung des schlimmsten Falls vor jedem Aufruf (`AiCostGuardrailService.reserveCall`, Tabelle `ai_cost_reservations`, Messung mit Kosten im ENV_BOOTSTRAP-Weg) | umgesetzt, **Gleichzeitigkeitstest ROT** | e2e `pilot-cost-control`: 7 von 8 grün; Mutationsprobe (Reservierungen ignorieren) macht den Test rot |
| Zusatzkontingent Schattenplanung (`ShadowQuotaService`, Tabellen `shadow_quota_grants`/`shadow_quota_ledger`), Ausgangszustand INACTIVE, Grundzähler unberührt | umgesetzt, **Wiederholungstest ROT** | e2e `shadow-quota`: 6 von 7 grün |
| Migration `20261102090000_cost_reservations_shadow_quota` | geschrieben, ohne Schemaabweichung geprüft, **in der Entwicklungsdatenbank NICHT angewendet** (nur in `orbit_e2e`) | `prisma migrate diff` |

## Zwei rote Tests (zu beheben, Erwartungen nicht abschwächen)

1. `pilot-cost-control` › gleichzeitige Aufrufe halten das Budget ein (zuvor grün, rot seit Umbenennung der Spalte auf `target_tenant_id`; Ursache nicht untersucht).
2. `shadow-quota` › Wiederholungen (Art REPEAT, laufende Nummer; Ursache nicht untersucht).

## Offene Arbeiten

W8 (Matrixparameter, Konsistenzprüfung, Trockenlauf; Fallzahlen inkl. Sonderprüfungen ableiten) · Anhangverarbeitung · Betriebsarbeiten (Backup-Zeitplan, Dokumentensicherung, Wiederherstellungsprüfung, Stopp-/Wiederanlaufprobe) · Google-Anleitung berichtigen · Verwaltungswerkzeuge (nur anzeigen, Änderung nur mit `--execute`) · Qualitätstor · Dokumentation und endgültiger Kontingent-/Kostenvorschlag.

## Nicht aktiviert

Kein Kostenlimit, kein Zusatzkontingent, keine Schattenplanung (Grundzähler 61 von 60 unverändert), keine externe Konfiguration, kein Pilot.
