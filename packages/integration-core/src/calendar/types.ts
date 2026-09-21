/**
 * Provider-agnostic contract for the Calendar connector (Microsoft
 * Graph/Outlook Calendar or Google Calendar — §9). Used for proposing
 * meeting slots and creating confirmed meetings from the Sales workflow.
 */

export interface AvailabilitySlot {
  start: Date;
  end: Date;
}

export interface FindAvailabilityInput {
  durationMinutes: number;
  earliestStart: Date;
  latestEnd: Date;
}

export interface CreateMeetingInput {
  title: string;
  start: Date;
  end: Date;
  attendeeEmails: string[];
  description?: string;
}

export interface CreateMeetingResult {
  externalId: string;
}

export interface CalendarConnector {
  readonly providerName: string;

  testConnection(): Promise<boolean>;

  /** Free/busy lookup — returns candidate open slots within the given window. */
  findAvailability(input: FindAvailabilityInput): Promise<AvailabilitySlot[]>;

  createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult>;
}
