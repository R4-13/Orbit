import { randomUUID } from 'node:crypto';
import type {
  AvailabilitySlot,
  CalendarConnector,
  CreateMeetingInput,
  CreateMeetingResult,
  FindAvailabilityInput,
} from './types';

const BUSINESS_HOURS_START_UTC = 9;
const BUSINESS_HOURS_END_UTC = 17;

function overlaps(a: AvailabilitySlot, b: AvailabilitySlot): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Deterministic in-memory Calendar connector (CALENDAR_CONNECTOR=mock).
 * Generates candidate slots on a fixed 09:00–17:00 UTC business-hours grid
 * and excludes anything that collides with a previously created meeting —
 * enough behavioral realism to exercise the Sales workflow's scheduling
 * logic without a real calendar.
 */
export class MockCalendarConnector implements CalendarConnector {
  readonly providerName = 'mock';

  private readonly meetings: AvailabilitySlot[] = [];

  async testConnection(): Promise<boolean> {
    return true;
  }

  async findAvailability(input: FindAvailabilityInput): Promise<AvailabilitySlot[]> {
    const slots: AvailabilitySlot[] = [];
    const durationMs = input.durationMinutes * 60 * 1000;

    const cursor = new Date(input.earliestStart);
    while (cursor.getTime() + durationMs <= input.latestEnd.getTime()) {
      const hour = cursor.getUTCHours();
      if (hour >= BUSINESS_HOURS_START_UTC && hour < BUSINESS_HOURS_END_UTC) {
        const candidate: AvailabilitySlot = {
          start: new Date(cursor),
          end: new Date(cursor.getTime() + durationMs),
        };
        if (!this.meetings.some((meeting) => overlaps(meeting, candidate))) {
          slots.push(candidate);
        }
      }
      cursor.setTime(cursor.getTime() + 30 * 60 * 1000); // 30-minute grid
    }

    return slots;
  }

  async createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult> {
    this.meetings.push({ start: input.start, end: input.end });
    return { externalId: `mock-meeting-${randomUUID()}` };
  }

  /** Test/dev helper — not part of the CalendarConnector contract. */
  getBookedMeetings(): readonly AvailabilitySlot[] {
    return this.meetings;
  }
}
