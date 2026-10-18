import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { SetupService } from './setup.service';

/** Einrichtungsassistent (`/tenant/setup`): Stand der Einrichtung und was ORBIT damit übernimmt. Nur lesend; erfordert `tenant.profile.manage`. */
@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.TENANT_PROFILE_MANAGE)
@Controller({ path: 'tenant/setup' })
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.setup.get(user.tenantId);
  }
}
