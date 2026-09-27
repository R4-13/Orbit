import { Injectable } from '@nestjs/common';
import type { TenantBranding } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto';

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
  ) {}

  getBranding(tenantId: string): Promise<TenantBranding | null> {
    return this.prisma.forTenantId(tenantId).tenantBranding.findUnique({ where: { tenantId } });
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
