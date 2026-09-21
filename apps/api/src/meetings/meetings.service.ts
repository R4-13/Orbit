import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError } from '@orbit/shared';
import { Prisma, type Meeting } from '@orbit/domain';
import type { CalendarConnector } from '@orbit/integration-core';
import { AuditService } from '../audit/audit.service';
import { CALENDAR_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';

export interface ProposeMeetingSlotsInput {
  contactId?: string;
  opportunityId?: string;
  title: string;
  durationMinutes: number;
  earliestStart: Date;
  latestEnd: Date;
}

export interface ConfirmMeetingInput {
  start: Date;
  end: Date;
  attendeeEmails: string[];
}

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CALENDAR_CONNECTOR) private readonly calendarConnector: CalendarConnector,
  ) {}

  async proposeSlots(
    tenantId: string,
    actorUserId: string,
    input: ProposeMeetingSlotsInput,
  ): Promise<Meeting> {
    const slots = await this.calendarConnector.findAvailability({
      durationMinutes: input.durationMinutes,
      earliestStart: input.earliestStart,
      latestEnd: input.latestEnd,
    });

    const meeting = await this.prisma.forTenantId(tenantId).meeting.create({
      data: {
        tenantId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        title: input.title,
        proposedSlots: slots as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'MEETING_PROPOSED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Meeting',
      entityId: meeting.id,
      payload: { slotCount: slots.length },
    });

    return meeting;
  }

  findAll(tenantId: string): Promise<Meeting[]> {
    return this.prisma.forTenantId(tenantId).meeting.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(tenantId: string, id: string): Promise<Meeting> {
    const found = await this.prisma.forTenantId(tenantId).meeting.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Meeting not found.', { id });
    }
    return found;
  }

  async confirm(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ConfirmMeetingInput,
  ): Promise<Meeting> {
    const meeting = await this.findOne(tenantId, id);
    if (meeting.status !== 'PROPOSED') {
      throw new PolicyViolationError('Meeting is not awaiting confirmation.', { id, status: meeting.status });
    }

    const result = await this.calendarConnector.createMeeting({
      title: meeting.title,
      start: input.start,
      end: input.end,
      attendeeEmails: input.attendeeEmails,
    });

    const updated = await this.prisma.forTenantId(tenantId).meeting.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        scheduledAt: input.start,
        calendarExternalId: result.externalId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'MEETING_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Meeting',
      entityId: id,
      payload: { calendarExternalId: result.externalId },
    });

    return updated;
  }
}
