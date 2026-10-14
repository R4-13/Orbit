-- Abwesenheitskalender der Mitarbeiter (AUT-05): in dieser Zeit gehen Meldungen sofort an die Vertretung.
ALTER TABLE "staff_members" ADD COLUMN "absences" JSONB;
