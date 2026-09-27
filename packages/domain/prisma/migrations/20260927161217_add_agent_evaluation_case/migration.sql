-- CreateTable
CREATE TABLE "agent_evaluation_cases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_definition_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_message" TEXT NOT NULL,
    "expected_tools" TEXT[],
    "forbidden_tools" TEXT[],
    "expected_approval_required" BOOLEAN,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_evaluation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_evaluation_cases_tenant_id_agent_definition_key_idx" ON "agent_evaluation_cases"("tenant_id", "agent_definition_key");

-- AddForeignKey
ALTER TABLE "agent_evaluation_cases" ADD CONSTRAINT "agent_evaluation_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
