-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_case_id_idx" ON "agent_runs"("tenant_id", "case_id");

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_started_at_idx" ON "agent_runs"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "cases_tenant_id_updated_at_idx" ON "cases"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "cases_orchestration_status_updated_at_idx" ON "cases"("orchestration_status", "updated_at");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_email_idx" ON "contacts"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_from_address_idx" ON "email_messages"("tenant_id", "from_address");

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_created_at_idx" ON "email_messages"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "intake_events_case_id_idx" ON "intake_events"("case_id");

-- CreateIndex
CREATE INDEX "invoices_case_id_idx" ON "invoices"("case_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_created_at_idx" ON "invoices"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_case_id_idx" ON "leads"("case_id");
