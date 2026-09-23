import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import type { Tenant } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { TenantsService, type TenantDataExport } from './tenants.service';

/**
 * §52 Datenschutz — self-service DSGVO actions for the caller's own
 * tenant (no path param: the tenant is always the caller's own, taken
 * from the JWT, exactly like every other tenant-scoped endpoint). Gated
 * by TENANT_MANAGE — only the tenant's own SYSTEM_ADMIN-role members
 * (per-tenant role, see DEFAULT_ROLE_PERMISSIONS in @orbit/shared) can
 * export or delete their tenant's data; TENANT_ADMIN deliberately cannot
 * (see permissions.ts: TENANT_ADMIN gets every permission except this one).
 */
@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.TENANT_MANAGE)
@Controller({ path: 'tenants/me' })
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  getOwnTenant(@CurrentUser() user: AuthenticatedUser): Promise<Tenant> {
    return this.tenantsService.getOwnTenant(user.tenantId);
  }

  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser): Promise<TenantDataExport> {
    return this.tenantsService.exportTenantData(user.tenantId, user.id);
  }

  @Post('deletion-request')
  requestDeletion(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.requestDeletion(user.tenantId, user.id);
  }

  @Delete('deletion-request')
  cancelDeletionRequest(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.cancelDeletionRequest(user.tenantId, user.id);
  }

  @Post('deletion-confirm')
  confirmDeletion(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.confirmDeletion(user.tenantId, user.id);
  }
}
