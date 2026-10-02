import { Injectable } from '@nestjs/common';
import type { TenantBranding } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto';
import type { RequestLogoUploadUrlDto } from './dto/request-logo-upload-url.dto';

/**
 * §5-6/§24-28 der UI/UX-Spezifikation ("Tenant/Company Branding and CI
 * Theming") — pro Tenant konfigurierbares Erscheinungsbild, ohne
 * Code-Änderung wirksam. `getBranding()` liefert `null`, wenn der Tenant
 * noch keine eigene Zeile hat — das Frontend fällt dann auf das in
 * apps/web/src/app/globals.css gebackene Standard-ORION-Theme zurück
 * (derselbe "Abwesenheit = Standard"-Präzedenzfall wie RetentionPolicy und
 * AIProviderConnection).
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  getBranding(tenantId: string): Promise<TenantBranding | null> {
    return this.prisma.forTenantId(tenantId).tenantBranding.findUnique({ where: { tenantId } });
  }

  /**
   * Returns a short-lived presigned PUT URL plus the permanent, public URL
   * the uploaded object will be reachable at once written — the frontend
   * uploads the file bytes directly to `uploadUrl` (never through this API
   * process, same "files never transit the API" rule as DocumentsService),
   * then PUTs/PATCHes `publicUrl` into `logoUrl`/`logoMarkUrl` via the
   * normal `upsertBranding()` call. No DB write happens here — an upload
   * that's never followed by a save is just an orphaned object, same
   * accepted trade-off as DocumentsService's own presigned uploads.
   */
  async createLogoUploadUrl(
    tenantId: string,
    input: RequestLogoUploadUrlDto,
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const storageKey = this.storage.buildPublicStorageKey(tenantId, 'branding', input.fileName);
    const uploadUrl = await this.storage.getPublicUploadUrl(storageKey, input.contentType);
    return { uploadUrl, publicUrl: this.storage.getPublicUrl(storageKey) };
  }

  async upsertBranding(
    tenantId: string,
    actorUserId: string,
    input: UpdateTenantBrandingDto,
  ): Promise<TenantBranding> {
    const data = {
      companyDisplayName: input.companyDisplayName,
      logoUrl: input.logoUrl,
      logoMarkUrl: input.logoMarkUrl,
      primaryColor: input.primaryColor,
      primaryForeground: input.primaryForeground,
      secondaryColor: input.secondaryColor,
      secondaryForeground: input.secondaryForeground,
      accentColor: input.accentColor,
      accentForeground: input.accentForeground,
      navigationBackground: input.navigationBackground,
      navigationForeground: input.navigationForeground,
      borderRadiusPreset: input.borderRadiusPreset,
    };

    const updated = await this.prisma.forTenantId(tenantId).tenantBranding.upsert({
      where: { tenantId },
      create: { tenantId, updatedByUserId: actorUserId, ...data },
      update: { updatedByUserId: actorUserId, ...data },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TENANT_BRANDING_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'TenantBranding',
      entityId: updated.id,
      payload: { companyDisplayName: updated.companyDisplayName },
    });

    return updated;
  }

  async resetBranding(tenantId: string, actorUserId: string): Promise<void> {
    const existing = await this.prisma.forTenantId(tenantId).tenantBranding.findUnique({ where: { tenantId } });
    if (!existing) return;

    await this.prisma.forTenantId(tenantId).tenantBranding.delete({ where: { tenantId } });

    await this.audit.record({
      tenantId,
      eventType: 'TENANT_BRANDING_RESET',
      actorType: 'USER',
      actorUserId,
      entityType: 'TenantBranding',
      entityId: existing.id,
      payload: {},
    });
  }
}
