import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import type { BookingProposal, Invoice, Supplier } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { AddBookingProposalDto } from './dto/add-booking-proposal.dto';
import { CreateInvoiceFromDocumentDto } from './dto/create-invoice-from-document.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'invoices' })
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BOOKING_CREATE)
  createFromDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceFromDocumentDto,
  ): Promise<Invoice> {
    return this.invoicesService.createFromDocument(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryInvoicesDto): Promise<Invoice[]> {
    return this.invoicesService.findAll(user.tenantId, query.status);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Invoice & { supplier: Supplier | null }> {
    return this.invoicesService.findOne(user.tenantId, id);
  }

  @Post(':id/booking-proposal')
  @RequirePermissions(PERMISSIONS.BOOKING_CREATE)
  addBookingProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddBookingProposalDto,
  ): Promise<BookingProposal> {
    return this.invoicesService.addBookingProposal(user.tenantId, user.id, id, dto);
  }

  @Patch(':id/approve')
  @RequirePermissions(PERMISSIONS.INVOICE_APPROVE)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Invoice> {
    return this.invoicesService.approve(user.tenantId, user.id, id);
  }

  @Patch(':id/reject')
  @RequirePermissions(PERMISSIONS.INVOICE_APPROVE)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Invoice> {
    return this.invoicesService.reject(user.tenantId, user.id, id);
  }

  @Patch(':id/confirm-bank-change')
  @RequirePermissions(PERMISSIONS.INVOICE_APPROVE)
  confirmBankChange(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Invoice> {
    return this.invoicesService.confirmBankChange(user.tenantId, user.id, id);
  }

  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.INVOICE_TRANSFER)
  transfer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Invoice> {
    return this.invoicesService.transfer(user.tenantId, user.id, id);
  }
}
