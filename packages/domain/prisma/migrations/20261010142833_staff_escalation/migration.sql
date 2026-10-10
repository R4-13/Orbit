-- AlterTable
ALTER TABLE "staff_members" ADD COLUMN     "deputy_id" TEXT,
ADD COLUMN     "supervisor_id" TEXT;

-- AlterTable
ALTER TABLE "tenant_profiles" ADD COLUMN     "escalation_policy" JSONB;
