-- Betriebliche Vorgabe zu Terminen (Dauer, Stichwörter für einen grundsätzlichen Vor-Ort-Termin); optional. Ohne Vorgabe entscheidet die fallbezogene Begründung der Anfrageanalyse.
ALTER TABLE "tenant_profiles" ADD COLUMN "appointment_policy" JSONB;
