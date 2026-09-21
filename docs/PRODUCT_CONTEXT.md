# Product Context — Project ORBIT

## Was ist ORBIT?

ORBIT (Arbeitstitel — siehe README für die Namenskonvention) ist eine
Multi-Tenant-Cloud-Anwendung, die administrative Tätigkeiten in kleinen und
mittelständischen Unternehmen automatisiert. Der MVP fokussiert zwei
End-to-End-Geschäftsprozesse:

1. **Finance**: eingehende Rechnungen (per E-Mail) werden automatisch
   erkannt, extrahiert, gegen den Lieferantenstamm abgeglichen, auf
   Dubletten/Plausibilität geprüft, mit einem Buchungsvorschlag versehen,
   nach menschlicher Freigabe an die Finanzbuchhaltung (DATEV/Lexware)
   übergeben — mit vollständigem Audit Trail.
2. **Sales**: eingehende Interessentenkontakte (E-Mail/Telefon) werden
   erkannt, Kontakt/Unternehmen im CRM angelegt oder aktualisiert, ein Lead
   erzeugt, Folgeaufgaben und Terminvorschläge erstellt — ebenfalls mit
   vollständigem Audit Trail.

## Rolle im Software-Ökosystem des Kunden

ORBIT ersetzt **keine** bestehenden Systeme. Es ist eine
Intelligence-/Orchestrierungsschicht oberhalb bestehender Systems of
Record:

- DATEV / Lexware bleiben Accounting System of Record
- HubSpot bleibt CRM System of Record
- Microsoft 365 / Gmail bleiben Mail-/Kalender-System of Record

ORBIT übernimmt: Intake → Understanding → Orchestration → Automation →
Decision Preparation → Execution → Audit, mit Human-in-the-Loop an
kritischen Entscheidungspunkten (Policy Engine, §17).

## Zielgruppe

Kaufmännische Sachbearbeiter (Finance/Sales) in KMUs — **nicht**
Entwickler. Die UI vermeidet daher bewusst KI-/Entwicklerjargon (§57) und
stellt Ergebnisse ("Vorschlag", "Freigabe erforderlich", "Übertragen") statt
technischer Mechanik ("LLM chain", "tool invocation") dar.

## Nicht-Ziele des MVP

Siehe §60 des Master-Prompts: keine automatische Bankzahlung, keine
Lohnbuchhaltung, keine Steuererklärungen, kein vollautomatischer
Monatsabschluss, keine Anbindung an SAP/Salesforce/Pipedrive, kein
vollwertiges CPQ/ERP, keine native Mobile App, kein Kubernetes-Multi-Region-
Deployment. Diese Punkte sind mögliche spätere Erweiterungen.

## Architektur-Grundprinzip

Kein direkter LLM-Zugriff auf externe Systeme. Jede Aktion läuft über:

```
Agent → Tool Registry → Policy Engine → Authorization Check → Tool Gateway → Connector → External System
```

Siehe [`ARCHITECTURE.md`](ARCHITECTURE.md) und
[`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md) für Details.
