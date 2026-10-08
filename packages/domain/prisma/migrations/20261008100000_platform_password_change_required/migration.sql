-- Plattformidentitäten: Passwortwechsel erzwingen (nach Zurücksetzen durch den Owner oder bei Neuanlage mit Startpasswort).
ALTER TABLE "platform_users" ADD COLUMN "password_change_required" BOOLEAN NOT NULL DEFAULT false;
