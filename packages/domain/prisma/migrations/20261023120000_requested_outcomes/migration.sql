-- Zielabdeckung (Funktionsnachweis 23.10.): die Anliegen der Kundschaft je Planrevision
ALTER TABLE "process_plans" ADD COLUMN "requested_outcomes" JSONB NOT NULL DEFAULT '[]';
