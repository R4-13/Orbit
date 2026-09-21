import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'v1/tasks' })
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.TASK_MANAGE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(user.tenantId, user.id, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.TASK_READ)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryTasksDto) {
    return this.tasksService.findAll(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TASK_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tasksService.findOne(user.tenantId, id);
  }

  @Patch(':id/complete')
  @RequirePermissions(PERMISSIONS.TASK_MANAGE)
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tasksService.complete(user.tenantId, id, user.id);
  }
}
