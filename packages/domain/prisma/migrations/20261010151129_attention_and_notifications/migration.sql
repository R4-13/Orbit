-- CreateTable
CREATE TABLE "attention_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "phase" TEXT NOT NULL DEFAULT 'INITIAL',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attention_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "attention_item_id" TEXT NOT NULL,
    "staff_member_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "wanted_channel" TEXT NOT NULL,
    "delivered_via" TEXT,
    "status" TEXT NOT NULL,
    "execution_mode" TEXT,
    "note" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attention_items_tenant_id_state_idx" ON "attention_items"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "attention_items_case_id_idx" ON "attention_items"("case_id");

-- CreateIndex
CREATE INDEX "staff_notifications_tenant_id_created_at_idx" ON "staff_notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_notifications_attention_item_id_staff_member_id_phase_key" ON "staff_notifications"("attention_item_id", "staff_member_id", "phase");

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_attention_item_id_fkey" FOREIGN KEY ("attention_item_id") REFERENCES "attention_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pro Vorgang und Art höchstens ein offener Eintrag (ein erneutes Eintreten nach der Auflösung legt einen neuen an).
CREATE UNIQUE INDEX "attention_items_open_key" ON "attention_items"("tenant_id", "case_id", "kind") WHERE "state" <> 'RESOLVED';

-- Mandantenisolation wie bei allen Mandantentabellen (RLS)
ALTER TABLE "attention_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attention_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attention_items"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "staff_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_notifications"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
