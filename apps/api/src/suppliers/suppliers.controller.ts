import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'suppliers' })
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    const result = await this.suppliersService.findOrCreate(user.tenantId, user.id, dto);
    return result.supplier;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySuppliersDto) {
    return this.suppliersService.findAll(user.tenantId, query.status);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suppliersService.findOne(user.tenantId, id);
  }

  @Patch(':id/approve')
  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suppliersService.approve(user.tenantId, id, user.id);
  }

  @Patch(':id/reject')
  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suppliersService.reject(user.tenantId, id, user.id);
  }
}
