import { Module } from '@nestjs/common';
import { CaseCorrelationService } from './case-correlation.service';
import { CaseFactsService } from './case-facts.service';
import { CaseLifecycleService } from './case-lifecycle.service';

/**
 * Business Process Framework (Amendment 02). Everything here builds on the
 * existing Prisma/Audit/Policy/Approval/Workflow components; it is not a
 * second platform. Phase BP-1b: case lifecycle, facts with provenance and
 * case correlation. Blueprints, planner and orchestrator join in BP-2.
 */
@Module({
  providers: [CaseFactsService, CaseCorrelationService, CaseLifecycleService],
  exports: [CaseFactsService, CaseCorrelationService, CaseLifecycleService],
})
export class ProcessModule {}
