-- CreateEnum
CREATE TYPE "BrandingBorderRadiusPreset" AS ENUM ('COMPACT', 'STANDARD', 'SOFT');

-- CreateTable
CREATE TABLE "tenant_brandings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_display_name" TEXT,
    "logo_url" TEXT,
    "logo_mark_url" TEXT,
    "primary_color" TEXT,
    "primary_foreground" TEXT,
    "secondary_color" TEXT,
    "secondary_foreground" TEXT,
    "accent_color" TEXT,
    "accent_foreground" TEXT,
    "navigation_background" TEXT,
    "navigation_foreground" TEXT,
    "border_radius_preset" "BrandingBorderRadiusPreset",
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_brandings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_brandings_tenant_id_key" ON "tenant_brandings"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_brandings" ADD CONSTRAINT "tenant_brandings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
