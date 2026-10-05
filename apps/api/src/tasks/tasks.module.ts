import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksOverviewService } from './tasks-overview.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksOverviewService],
  exports: [TasksService],
})
export class TasksModule {}
