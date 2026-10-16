import { Module } from '@nestjs/common';
import { InterventionsService } from './interventions.service';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [InterventionsService],
})
export class ReportsModule {}
