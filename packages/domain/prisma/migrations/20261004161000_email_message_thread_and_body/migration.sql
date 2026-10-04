-- Amendment 02 §5.1 / §13.1 — full normalized body, content hash and thread correlation headers.
ALTER TABLE "email_messages"
  ADD COLUMN "body_text" TEXT,
  ADD COLUMN "content_hash" TEXT,
  ADD COLUMN "thread_id" TEXT,
  ADD COLUMN "rfc_message_id" TEXT,
  ADD COLUMN "in_reply_to" TEXT,
  ADD COLUMN "references" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "email_messages_tenant_id_thread_id_idx" ON "email_messages"("tenant_id", "thread_id");
CREATE INDEX "email_messages_tenant_id_rfc_message_id_idx" ON "email_messages"("tenant_id", "rfc_message_id");
