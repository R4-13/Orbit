# AI-Modellprofile (Amendment 03 §8.4)

Ein Profil beschreibt **was** ein Aufruf braucht, nicht **wer** ihn bedient. Geschäftscode referenziert ausschließlich den Profilschlüssel (`AiProfileKey`, `@orbit/shared`).

| Profil | Zweck | Erforderliche Fähigkeiten | Fallback-Obergrenze | Aufrufer |
|---|---|---|---|---|
| `FAST_CLASSIFICATION` | Triage eingehender Nachrichten | chat, tool_use | SAME_PROVIDER | `SemanticTriageService`, Ausführungsnachweis, Simulations-Hook |
| `DOCUMENT_EXTRACTION` | strukturierte Fakten gewinnen | chat, tool_use, structured_output | SAME_PROVIDER | Referenzprozess-Werkzeug `resolve_context` |
| `COMPLEX_REASONING` | Planung, mehrstufiges Abwägen | chat, tool_use | SAME_PROVIDER | `PlannerService` |
| `BUSINESS_DRAFTING` | Formulierung geschäftlicher Texte | chat | SAME_PROVIDER | (noch kein Aufrufer – Entwürfe sind Vorlagen) |
| `COPILOT_INTERACTIVE` | Sonde im Dialog | chat, tool_use | SAME_PROVIDER | `CopilotRuntimeService` |
| `AGENT_TOOL_USE` | Agentenläufe unter Policy | chat, tool_use | SAME_PROVIDER | `AgentDefinitionResolverService` (Standard für Statusabfragen) |

Standardwerte stehen in `DEFAULT_PROFILE_DEFINITIONS`; `POST /platform/ai/bootstrap-from-environment` legt sie als **Version 1, veröffentlicht** an.

## Versionierung

* Eine Profilversion hat den Lebenszyklus `DRAFT → TESTING → PUBLISHED → DEPRECATED`. Ab `PUBLISHED` sind Zweck, Fähigkeiten, Fallback-Modus, Latenz- und Datenrichtlinienfelder **unveränderlich** – ein Datenbank-Trigger verhindert
  UPDATE (außer dem Übergang nach `DEPRECATED`) und DELETE, auch für die Anwendungsrolle.
* Eine Änderung ist eine neue Version (`POST /platform/ai/model-profiles`, nächste Versionsnummer, Entwurf) und wird per `POST …/versions/:v/publish` (Step-up, Begründung, Audit) veröffentlicht.
* Zur Laufzeit gilt die **höchste veröffentlichte** Version. Routen verweisen auf den Profilschlüssel, nicht auf eine Version.
* Der Fallback-Modus einer Route darf den des Profils nicht übersteigen (`NO < SAME_PROVIDER < APPROVED_CROSS_PROVIDER`).

## Offen

Testphase (`TESTING`) hat noch keine eigene Funktion (kein Shadow-/Canary-Betrieb gegen ein Profil); `maxLatencyMs` und `maxCostClass` aus der Spezifikation werden gespeichert bzw. nicht modelliert, aber im Routing noch nicht ausgewertet.
