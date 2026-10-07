# Process-Blueprint-Schema (Version 1.0)

Ein Blueprint ist ein **deklaratives, versioniertes Datenpaket** (`BlueprintDefinitionSchema`, strikt: unbekannte
ausführungsrelevante Schlüssel werden abgelehnt; rein beschreibende Zusätze gehören in `metadata`). Er enthält keinen Code
und keinen Prompt.

## Felder

| Feld | Bedeutung |
|---|---|
| `schemaVersion` | `"1.0"` |
| `key`, `version` | `GROSSBUCHSTABEN_UNTERSTRICH`, `MAJOR.MINOR.PATCH`; eine veröffentlichte Version ist unveränderlich (Hash-geprüft) |
| `title`, `description`, `goals[]` | Fachliche Beschreibung und Ziele (Plan-Ziele müssen daraus stammen) |
| `triggers[]` | `communication.received` |
| `intentHints[]` | Triage-Kategorien, die diesen Prozess starten (Hinweis, nicht Entscheidung) |
| `requiredFacts[]` | `{key, type, question?, validation?, when?}` – Typen aus der Fakt-Typ-Registry (`email`, `string`, `number`, `money`, …) |
| `dynamicRequirements` | Capability, die zusätzliche Anforderungen aus freigegebenen Regeln ermittelt |
| `allowedCapabilities[]` | Schlüssel aus dem Capability-Katalog; der Planer darf nichts anderes verwenden |
| `maxAutonomy` | Obergrenze; die wirksame Policy kann nur strenger sein |
| `planMode` | `FIXED` (Referenzgraph unverändert), `CONSTRAINED_ADAPTIVE` (KI darf bei Neuplanung anpassen, Referenzgraph als Rückfall), `AD_HOC` (KI plant, Mensch bestätigt vor jeder Ausführung) |
| `referenceGraph` | `{nodes[], edges[]}` – derselbe Knoten-/Kantentyp wie ein konkreter Plan |
| `constraints` | nur bekannte Schlüssel: `forbid_unverified_prices`, `require_policy_before_writes`, `prevent_duplicate_deliveries`, `require_human_resolution_for_fact_conflicts` |
| `limits` | `maxPlannerCalls`, `maxReplans`, `maxSteps`, `maxAutoQuestions`, `maxRuntimeHours`, `maxActionsPerCase` (Standard 20, Obergrenze 50), `maxConsecutiveCapabilityFailures` (Standard 3, Obergrenze 10). Ein Blueprint darf Grenzen nur **verschärfen**; Standards und Plattformobergrenzen stehen in `packages/shared/src/process-schemas/limits.ts` (`effectiveLimits`). `maxActionsPerCase` zählt alle Aktionen mit Wirkung (intern und extern) über alle Planrevisionen; wiederholte Ausführung derselben Aktion zählt nicht doppelt. |
| `waitRules[]` | Warteregeln mit `timeoutPolicyRef` |
| `completionCriteria` | Ausdruck, der deterministisch ausgewertet wird |
| `goalCriteria` | optional: Ausdruck je Ziel (Schlüssel = Eintrag aus `goals`). Ziele ohne Eintrag folgen `completionCriteria`. Abgeschlossen wird erst, wenn die Abschlusskriterien **und** alle Zielkriterien erfüllt sind; jede Bewertung steht als Ereignis `completion.evaluated` (erfüllt oder nicht) mit Zielstatus und Nachweisen im Vorgang |

## Knotentypen (geschlossene Menge)

`INTERPRET`, `RESOLVE_CONTEXT`, `EVALUATE_REQUIREMENTS`, `DECISION`, `PREPARE`, `ACTION`, `APPROVAL`, `WAIT_EVENT`, `REASSESS`, `MANUAL_TASK`, `COMPLETE`.
Ein Knoten hat `id`, `title`, optional `capability`, typisierte `inputs` (`fact` / `stepOutput` / `config` / `sourceRef` / `literal`),
`preconditions`, `onFailure` (`FAIL` | `REVIEW` | `SKIP`), `retry`, `timeout`, `config` (z. B. `purpose`, `eventType`).

## Ausdrucksgrammatik

`all`, `any`, `not`, `eq`, `gt`, `exists`, `requirementSatisfied`, `capabilityAvailable`, `receiptConfirmed`, `factEquals` (Kurzform).
Kein `eval`, kein JavaScript, kein SQL, keine freien Operatoren; Tiefenlimit 8; Pfadzugriff nur auf eigene Eigenschaften
(`__proto__`, `constructor` abgelehnt); `gt` auf Nicht-Zahlen wirft statt `false` zu liefern.

## Lebenszyklus

`DRAFT → VALIDATING → TESTING → STAGED → PUBLISHED → SUSPENDED/DEPRECATED → ARCHIVED`. Nur `DRAFT` ist änderbar. Vor jedem
Aufstieg wird erneut statisch geprüft (Schema, Capabilities, Referenzgraph durch den Plan-Validator, Abschlusskriterien).
Neue Fälle starten nur mit einer **veröffentlichten und für den Mandanten aktivierten** Version. Ein laufender Case bleibt
bei der Version, mit der er gestartet wurde.

## Plan-Validator (§11.3)

Elf Prüfungen: Schema/Größe · Blueprint-Scope · Bindings/Abhängigkeiten · Erreichbarkeit/Zyklen/Terminalpfade ·
Pflichtangaben/Quellenvertrauen · Ausführbarkeit/Berechtigung/Policy-Zuordnung · keine erfundenen Empfänger/Preise ·
Idempotenz/Bestätigung je externer Wirkung · kein Wiederholen bestätigter Wirkungen beim Replanning · prüfbare Abschluss- und
Wartebehandlung · Limits. Fehler tragen stabile Codes (`CYCLE`, `INVENTED_PARAMETER`, `CAPABILITY_NOT_EXECUTABLE`, …).

## Beispiel

`fixtures/process/request-for-quote.blueprint.json` (Referenzprozess) und die Fixture-Blueprints in
`apps/api/test/process-orchestration.e2e-spec.ts` (zwei völlig andere Prozesse auf derselben Engine).
