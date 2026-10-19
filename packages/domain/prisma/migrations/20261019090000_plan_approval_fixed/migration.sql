-- Entscheidung D4 / Addendum ADD-2.1 (19.10.2026): Die Planfreigabe für schreibende Wirkungen unbekannter Vorgänge ist eine feste Vorgabe und wird von keinem Autonomiegrad
-- aufgehoben. Die Regel `process.plan.activate` wird für alle Betriebe auf „Freigabe erforderlich“ gesetzt und gesperrt (nur strenger einstellbar). Hat ein Betrieb sie über
-- „Ausgewogen“/„Hochautomatisiert“ auf „autonom“ gestellt, wird das zurückgenommen; die übrigen Regeln der Stufe bleiben unberührt.
UPDATE "policy_configs"
SET "mode" = 'REQUIRE_APPROVAL', "locked" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "action" = 'process.plan.activate' AND ("mode" <> 'REQUIRE_APPROVAL' OR "locked" = false);
