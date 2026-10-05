import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesOverviewService } from './cases-overview.service';
import { CasesService } from './cases.service';

@Module({
  controllers: [CasesController],
  providers: [CasesService, CasesOverviewService],
  exports: [CasesService],
})
export class CasesModule {}
