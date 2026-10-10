-- CreateEnum
CREATE TYPE "StaffContactChannel" AS ENUM ('EMAIL', 'TEAMS', 'WHATSAPP', 'SMS', 'PHONE');

-- CreateEnum
CREATE TYPE "StaffRoleKind" AS ENUM ('OWNER', 'MANAGER', 'DISPATCHER', 'TECHNICIAN', 'OFFICE', 'ACCOUNTING', 'SALES', 'OTHER');

-- CreateTable
CREATE TABLE "tenant_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "industry" TEXT,
    "description" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_area" TEXT,
    "opening_hours" JSONB,
    "emergency_service" BOOLEAN NOT NULL DEFAULT false,
    "emergency_note" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'FORMAL',
    "languages" TEXT[] DEFAULT ARRAY['de']::TEXT[],
    "faqs" JSONB,
    "onboarding_completed_at" TIMESTAMP(3),
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role_kind" "StaffRoleKind" NOT NULL DEFAULT 'OTHER',
    "role_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "teams_address" TEXT,
    "whatsapp_number" TEXT,
    "preferred_channel" "StaffContactChannel" NOT NULL DEFAULT 'EMAIL',
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calendar_id" TEXT,
    "availability_note" TEXT,
    "user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_tenant_id_key" ON "tenant_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_members_tenant_id_active_idx" ON "staff_members"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_tenant_id_external_id_key" ON "staff_members"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mandantenisolation wie bei allen Mandantentabellen (RLS)
ALTER TABLE "tenant_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_profiles"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "staff_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_members"
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
