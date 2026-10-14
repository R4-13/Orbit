import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, ValidationFailedError } from '@orbit/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ApiKeysService } from './api-keys.service';

const CreateSchema = z.object({ name: z.string().min(3).max(80), scopes: z.array(z.string()).min(1).max(5) }).strict();

/** Zugriffsschlüssel verwalten (`/tenant/api-keys`): anlegen (Klartext einmalig), auflisten, widerrufen. Nur wer das Betriebsprofil verwalten darf – und nie mit einem Schlüssel selbst. */
@ApiTags('api-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.TENANT_PROFILE_MANAGE)
@Controller({ path: 'tenant/api-keys' })
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.keys.list(user.tenantId);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) throw new ValidationFailedError(parsed.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; '));
    const { key, view } = await this.keys.create(user.tenantId, user.id, parsed.data);
    return { ...view, key };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.keys.revoke(user.tenantId, user.id, id);
  }
}
