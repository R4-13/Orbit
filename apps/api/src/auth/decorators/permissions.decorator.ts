import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@orbit/shared';

export const PERMISSIONS_METADATA_KEY = 'orbit:required-permissions';

/** Combine with `@UseGuards(JwtAuthGuard, PermissionsGuard)` on a controller/route. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
