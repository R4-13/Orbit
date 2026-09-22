import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { StorageModule } from '../storage/storage.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [StorageModule, SuppliersModule, ApprovalsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
