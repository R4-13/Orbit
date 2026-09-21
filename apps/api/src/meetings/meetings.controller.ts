import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import type { Meeting } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ConfirmMeetingDto } from './dto/confirm-meeting.dto';
import { ProposeMeetingSlotsDto } from './dto/propose-meeting-slots.dto';
import { MeetingsService } from './meetings.service';

/**
 * No dedicated "meeting.read"/"meeting.propose" permission exists in
 * PERMISSIONS (@orbit/shared) — MEETING_CREATE is reused for the whole
 * controller, the same accepted gap as DocumentsController (Phase 4).
 */
@ApiTags('meetings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.MEETING_CREATE)
@Controller({ path: 'meetings' })
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post('propose')
  proposeSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProposeMeetingSlotsDto,
  ): Promise<Meeting> {
    return this.meetingsService.proposeSlots(user.tenantId, user.id, {
      contactId: dto.contactId,
      opportunityId: dto.opportunityId,
      title: dto.title,
      durationMinutes: dto.durationMinutes,
      earliestStart: new Date(dto.earliestStart),
      latestEnd: new Date(dto.latestEnd),
    });
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Meeting[]> {
    return this.meetingsService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Meeting> {
    return this.meetingsService.findOne(user.tenantId, id);
  }

  @Patch(':id/confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmMeetingDto,
  ): Promise<Meeting> {
    return this.meetingsService.confirm(user.tenantId, user.id, id, {
      start: new Date(dto.start),
      end: new Date(dto.end),
      attendeeEmails: dto.attendeeEmails,
    });
  }
}
