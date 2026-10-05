import { Module } from '@nestjs/common';
import { ApprovalPresenterService } from './approval-presenter.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalPresenterService],
  exports: [ApprovalsService, ApprovalPresenterService],
})
export class ApprovalsModule {}
