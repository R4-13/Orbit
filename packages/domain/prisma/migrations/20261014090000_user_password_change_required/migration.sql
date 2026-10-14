-- Startpasswort: bis zum ersten Wechsel sind nur Passwortwechsel, Kontoabfrage und Abmelden erlaubt (AUT-13).
ALTER TABLE "users" ADD COLUMN "password_change_required" BOOLEAN NOT NULL DEFAULT false;
