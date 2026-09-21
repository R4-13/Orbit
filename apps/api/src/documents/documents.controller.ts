import { Controller, Delete, Get, Param, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentsService } from './documents.service';

/**
 * Documents have no dedicated permission in PERMISSIONS (@orbit/shared) —
 * they're always attached to (or destined for) a Case, so access piggybacks
 * on CASE_READ/CASE_MANAGE rather than inventing a new permission string
 * that isn't part of that single source of truth. See ASSUMPTIONS.
 */
@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'documents' })
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload-url')
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  createUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUploadUrlDto) {
    return this.documentsService.createUploadUrl(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('caseId') caseId?: string) {
    return this.documentsService.findAll(user.tenantId, caseId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentsService.findOne(user.tenantId, id);
  }

  @Get(':id/download-url')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  async getDownloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const url = await this.documentsService.getDownloadUrl(user.tenantId, id);
    return { url };
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentsService.remove(user.tenantId, id, user.id);
  }
}
