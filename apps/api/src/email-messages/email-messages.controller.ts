import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { EmailMessagesService } from './email-messages.service';

/** Gated on the pre-existing EMAIL_READ permission (already in DEFAULT_ROLE_PERMISSIONS), not a new one — no prior controller used it. */
@ApiTags('email-messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.EMAIL_READ)
@Controller({ path: 'email-messages' })
export class EmailMessagesController {
  constructor(private readonly emailMessagesService: EmailMessagesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.emailMessagesService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.emailMessagesService.findOne(user.tenantId, id);
  }
}
