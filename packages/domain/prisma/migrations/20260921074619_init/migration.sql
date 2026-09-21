-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PolicyMode" AS ENUM ('DISABLED', 'SUGGEST_ONLY', 'REQUIRE_APPROVAL', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('FINANCE', 'SALES');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('AGENT', 'USER');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'PENDING_APPROVAL', 'BLOCKED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RECEIVED', 'EXTRACTED', 'DUPLICATE_SUSPECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'TRANSFERRED', 'TRANSFER_FAILED');

-- CreateEnum
CREATE TYPE "BookingProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FinanceTransferStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalEntityType" AS ENUM ('INVOICE', 'BOOKING_PROPOSAL', 'SUPPLIER', 'FOLLOW_UP', 'MEETING');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('EMAIL', 'PHONE', 'WEB', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('NEW', 'QUALIFICATION', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationConnectorType" AS ENUM ('DATEV', 'LEXWARE', 'MICROSOFT', 'GMAIL', 'GOOGLE_CALENDAR', 'HUBSPOT', 'TWILIO');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('ORCHESTRATOR', 'COMMUNICATION', 'FINANCE', 'SALES');

-- CreateEnum
CREATE TYPE "AgentRunTriggerType" AS ENUM ('EMAIL', 'WEBHOOK', 'SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ToolInvocationStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED_AWAITING_APPROVAL', 'DENIED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT NOT NULL DEFAULT 'de-DE',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" "PolicyMode" NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "source" "TaskSource" NOT NULL DEFAULT 'USER',
    "due_date" TIMESTAMP(3),
    "assignee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT,
    "uploaded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "subject" TEXT,
    "body_preview" TEXT,
    "provider_message_id" TEXT,
    "classification" TEXT,
    "received_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "vat_id" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "email" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'DE',
    "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "external_finance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT,
    "supplier_id" TEXT,
    "document_id" TEXT,
    "invoice_number" TEXT,
    "invoice_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "amount_net" DECIMAL(14,2),
    "amount_gross" DECIMAL(14,2),
    "vat_amount" DECIMAL(14,2),
    "vat_rate" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "confidence_score" DOUBLE PRECISION,
    "extracted_data" JSONB,
    "duplicate_of_invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_proposals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "cost_center" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_code" TEXT,
    "description" TEXT,
    "status" "BookingProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "external_reference" TEXT,
    "status" "FinanceTransferStatus" NOT NULL DEFAULT 'STARTED',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "finance_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" "ApprovalEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "policy_action" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" TEXT,
    "decided_by_user_id" TEXT,
    "reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "crm_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "crm_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "company_id" TEXT,
    "source" "LeadSource" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "name" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'NEW',
    "value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "crm_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "opportunity_id" TEXT,
    "title" TEXT NOT NULL,
    "proposed_slots" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "status" "MeetingStatus" NOT NULL DEFAULT 'PROPOSED',
    "calendar_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connector_type" "IntegrationConnectorType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "encrypted_credentials" BYTEA,
    "config" JSONB,
    "last_tested_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "case_id" TEXT,
    "agent_type" "AgentType" NOT NULL,
    "trigger_type" "AgentRunTriggerType" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "input" JSONB,
    "output" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_invocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "policy_action" TEXT,
    "policy_mode" "PolicyMode",
    "input" JSONB,
    "output" JSONB,
    "status" "ToolInvocationStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_key" ON "role_permissions"("role_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_configs_tenant_id_action_key" ON "policy_configs"("tenant_id", "action");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "cases_tenant_id_status_idx" ON "cases"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "cases_tenant_id_type_idx" ON "cases"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_idx" ON "tasks"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tasks_case_id_idx" ON "tasks"("case_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- CreateIndex
CREATE INDEX "documents_case_id_idx" ON "documents"("case_id");

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_direction_idx" ON "email_messages"("tenant_id", "direction");

-- CreateIndex
CREATE INDEX "email_messages_case_id_idx" ON "email_messages"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_tenant_id_provider_message_id_key" ON "email_messages"("tenant_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_status_idx" ON "suppliers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_name_key" ON "suppliers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "invoices_supplier_id_idx" ON "invoices"("supplier_id");

-- CreateIndex
CREATE INDEX "booking_proposals_invoice_id_idx" ON "booking_proposals"("invoice_id");

-- CreateIndex
CREATE INDEX "finance_transfers_tenant_id_status_idx" ON "finance_transfers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "approvals_tenant_id_status_idx" ON "approvals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "approvals_entity_type_entity_id_idx" ON "approvals"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "companies_tenant_id_idx" ON "companies"("tenant_id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_idx" ON "contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_stage_idx" ON "opportunities"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_status_idx" ON "meetings"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenant_id_connector_type_key" ON "integrations"("tenant_id", "connector_type");

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_status_idx" ON "agent_runs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tool_invocations_agent_run_id_idx" ON "tool_invocations"("agent_run_id");

-- CreateIndex
CREATE INDEX "tool_invocations_tenant_id_tool_name_idx" ON "tool_invocations"("tenant_id", "tool_name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_configs" ADD CONSTRAINT "policy_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_duplicate_of_invoice_id_fkey" FOREIGN KEY ("duplicate_of_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_proposals" ADD CONSTRAINT "booking_proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_proposals" ADD CONSTRAINT "booking_proposals_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

