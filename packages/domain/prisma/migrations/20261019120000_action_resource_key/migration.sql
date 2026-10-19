-- FX-07 / FA-10: Wirkungsschlüssel an der Aktionsabsicht. Vorgänge, die auf dasselbe Geschäftsobjekt wirken (z. B. dasselbe Terminfenster), werden darüber koordiniert.
ALTER TABLE "action_intents" ADD COLUMN "resource_key" TEXT;
CREATE INDEX "action_intents_tenant_id_resource_key_idx" ON "action_intents"("tenant_id", "resource_key");
