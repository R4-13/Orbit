import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { LeadsController } from './leads.controller';
import { LeadsOverviewService } from './leads-overview.service';
import { LeadsService } from './leads.service';

@Module({
  imports: [TasksModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadsOverviewService],
  exports: [LeadsService],
})
export class LeadsModule {}
