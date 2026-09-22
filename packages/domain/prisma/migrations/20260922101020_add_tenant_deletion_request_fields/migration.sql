-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN     "deletion_requested_by_user_id" TEXT;
