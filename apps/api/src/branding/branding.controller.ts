import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { BrandingService } from './branding.service';
import { RequestLogoUploadUrlDto } from './dto/request-logo-upload-url.dto';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto';

/**
 * §5-6/§27 der UI/UX-Spezifikation. `GET` ist bewusst nur mit `JwtAuthGuard`
 * (keine zusätzliche Permission) gegated — jeder eingeloggte Nutzer muss das
 * Theme seines Tenants lesen können, damit die App-Shell es beim Laden
 * anwenden kann; nur das Ändern (`PUT`/`DELETE`) erfordert
 * `TENANT_BRANDING_CONFIGURE`.
 */
@ApiTags('branding')
@ApiBearerAuth()
@Controller({ path: 'tenant/branding' })
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getBranding(@CurrentUser() user: AuthenticatedUser) {
    // Wrapped in an object rather than returning the TenantBranding|null value directly:
    // Nest/Express send a `null` controller return as an EMPTY body (no JSON at all), which
    // breaks a client's response.json() — the exact bug just fixed in AiProvidersService
    // .disconnect() (see docs/ASSUMPTIONS.md). { branding: null } serializes as real JSON.
    return { branding: await this.branding.getBranding(user.tenantId) };
  }

  @Put()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TENANT_BRANDING_CONFIGURE)
  upsertBranding(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTenantBrandingDto) {
    return this.branding.upsertBranding(user.tenantId, user.id, dto);
  }

  @Delete()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TENANT_BRANDING_CONFIGURE)
  @HttpCode(204)
  async resetBranding(@CurrentUser() user: AuthenticatedUser) {
    await this.branding.resetBranding(user.tenantId, user.id);
  }

  /**
   * Returns a presigned upload URL, not the uploaded result — the caller
   * PUTs the file directly to it, then saves the returned `publicUrl` via
   * the normal `PUT /tenant/branding` call (same two-step flow as
   * DocumentsModule's own upload endpoint).
   */
  @Post('logo-upload-url')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TENANT_BRANDING_CONFIGURE)
  requestLogoUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestLogoUploadUrlDto) {
    return this.branding.createLogoUploadUrl(user.tenantId, dto);
  }
}
