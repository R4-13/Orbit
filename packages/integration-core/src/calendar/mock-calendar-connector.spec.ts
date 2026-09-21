import { describe, expect, it } from 'vitest';
import { MockCalendarConnector } from './mock-calendar-connector';

describe('MockCalendarConnector', () => {
  it('findAvailability() only returns slots inside business hours (09:00–17:00 UTC)', async () => {
    const connector = new MockCalendarConnector();
    const slots = await connector.findAvailability({
      durationMinutes: 30,
      earliestStart: new Date('2026-03-02T00:00:00Z'), // Monday
      latestEnd: new Date('2026-03-02T23:59:00Z'),
    });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.start.getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(slot.end.getUTCHours()).toBeLessThanOrEqual(17);
    }
  });

  it('createMeeting() removes that slot from future availability results', async () => {
    const connector = new MockCalendarConnector();
    const start = new Date('2026-03-02T10:00:00Z');
    const end = new Date('2026-03-02T10:30:00Z');

    await connector.createMeeting({
      title: 'Erstgespräch',
      start,
      end,
      attendeeEmails: ['kunde@example.com'],
    });

    const slots = await connector.findAvailability({
      durationMinutes: 30,
      earliestStart: start,
      latestEnd: end,
    });

    expect(slots).toHaveLength(0);
  });

  it('createMeeting() returns a unique external id and records the booking', async () => {
    const connector = new MockCalendarConnector();
    const result = await connector.createMeeting({
      title: 'Demo',
      start: new Date('2026-03-02T10:00:00Z'),
      end: new Date('2026-03-02T10:30:00Z'),
      attendeeEmails: ['kunde@example.com'],
    });

    expect(result.externalId).toMatch(/^mock-meeting-/);
    expect(connector.getBookedMeetings()).toHaveLength(1);
  });
});
