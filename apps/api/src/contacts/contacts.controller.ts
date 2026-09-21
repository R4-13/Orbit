import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ContactsService } from './contacts.service';
import { UpsertContactDto } from './dto/upsert-contact.dto';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'contacts' })
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertContactDto) {
    return this.contactsService.upsert(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsService.findAll(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contactsService.findOne(user.tenantId, id);
  }
}
