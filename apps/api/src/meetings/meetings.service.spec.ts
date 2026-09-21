import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { CALENDAR_CONNECTOR } from '../connectors/connectors.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { MeetingsService } from './meetings.service';

describe('MeetingsService', () => {
  let service: MeetingsService;
  let scoped: { meeting: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock } };
  let audit: { record: jest.Mock };
  let calendarConnector: { findAvailability: jest.Mock; createMeeting: jest.Mock };

  beforeEach(async () => {
    scoped = {
      meeting: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    calendarConnector = {
      findAvailability: jest.fn().mockResolvedValue([{ start: new Date(), end: new Date() }]),
      createMeeting: jest.fn().mockResolvedValue({ externalId: 'mock-meeting-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: CALENDAR_CONNECTOR, useValue: calendarConnector },
      ],
    }).compile();

    service = moduleRef.get(MeetingsService);
  });

  it('proposeSlots() asks the calendar connector for availability and stores the proposed slots', async () => {
    scoped.meeting.create.mockResolvedValue({ id: 'mt_1', title: 'Erstgespräch' });

    const result = await service.proposeSlots('tenant_1', 'user_1', {
      title: 'Erstgespräch',
      durationMinutes: 30,
      earliestStart: new Date('2026-03-02T00:00:00Z'),
      latestEnd: new Date('2026-03-02T23:59:00Z'),
    });

    expect(calendarConnector.findAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 30 }),
    );
    expect(result.id).toBe('mt_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'MEETING_PROPOSED' }));
  });

  it('confirm() rejects a meeting that is not PROPOSED', async () => {
    scoped.meeting.findUnique.mockResolvedValue({ id: 'mt_1', status: 'CONFIRMED' });
    await expect(
      service.confirm('tenant_1', 'user_1', 'mt_1', {
        start: new Date(),
        end: new Date(),
        attendeeEmails: ['a@example.com'],
      }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  });

  it('confirm() books the meeting with the calendar connector and marks it CONFIRMED', async () => {
    scoped.meeting.findUnique.mockResolvedValue({ id: 'mt_1', status: 'PROPOSED', title: 'Erstgespräch' });
    scoped.meeting.update.mockResolvedValue({ id: 'mt_1', status: 'CONFIRMED' });

    const result = await service.confirm('tenant_1', 'user_1', 'mt_1', {
      start: new Date('2026-03-02T10:00:00Z'),
      end: new Date('2026-03-02T10:30:00Z'),
      attendeeEmails: ['kunde@example.com'],
    });

    expect(calendarConnector.createMeeting).toHaveBeenCalled();
    expect(result.status).toBe('CONFIRMED');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'MEETING_CREATED' }));
  });

  it('findOne() throws NotFoundError for a missing meeting', async () => {
    scoped.meeting.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });
});
