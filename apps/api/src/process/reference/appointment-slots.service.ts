import { Injectable, Logger } from '@nestjs/common';
import { GmailConnectorService } from '../../integrations/gmail-connector.service';
import { PrismaService } from '../../prisma/prisma.service';
import { proposeSlots, type AppointmentKind, type ProposedSlot } from './appointment-slots';

export interface SlotProposal {
  /** Woher die freien Zeiten stammen: ein verbundener Google-Kalender oder gar nicht (dann bittet die Nachricht um Terminwünsche). */
  source: 'GOOGLE_CALENDAR' | 'NONE';
  slots: ProposedSlot[];
  /** Warum keine Vorschläge entstanden sind (für Nachvollziehbarkeit, nie für die Kundschaft). */
  reason?: string;
}

/**
 * Terminvorschläge für Vor-Ort- und Telefontermine aus der echten Verfügbarkeit. Ohne verbundenen Kalender (oder bei einem Fehler) gibt es **keine
 * erfundenen Zeiten**: die Antwort ist `NONE`, und die Nachricht bittet die Kundschaft um ihre Terminwünsche.
 */
@Injectable()
export class AppointmentSlotsService {
  private readonly logger = new Logger(AppointmentSlotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailConnectorService,
  ) {}

  async propose(tenantId: string, kind: AppointmentKind, now: Date = new Date()): Promise<SlotProposal> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType: 'GMAIL' } } });
    const granted = Array.isArray(integration?.grantedCapabilities) ? (integration?.grantedCapabilities as unknown[]) : [];
    if (!integration || integration.status !== 'CONNECTED' || !granted.includes('calendar.freebusy')) {
      return { source: 'NONE', slots: [], reason: 'Kein Kalender mit der Berechtigung „Verfügbarkeit lesen“ verbunden.' };
    }

    const tenant = await this.prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }));
    const timeZone = tenant?.timezone || 'Europe/Berlin';
    const config = (integration.config ?? {}) as { calendarIds?: unknown };
    const calendarIds = Array.isArray(config.calendarIds) && config.calendarIds.length > 0 ? config.calendarIds.filter((id): id is string => typeof id === 'string').slice(0, 20) : ['primary'];

    try {
      const horizonEnd = new Date(now.getTime() + 21 * 24 * 3_600_000);
      const perCalendar = await this.gmail.queryFreeBusy(tenantId, calendarIds, now, horizonEnd, timeZone);
      const slots = proposeSlots({ kind, now, timeZone, calendars: perCalendar.map((c) => c.busy) });
      return slots.length > 0 ? { source: 'GOOGLE_CALENDAR', slots } : { source: 'NONE', slots: [], reason: 'Im Suchzeitraum ist kein passender freier Zeitraum.' };
    } catch (error) {
      this.logger.warn(`Kalender für Terminvorschläge nicht nutzbar (Mandant ${tenantId}): ${error instanceof Error ? error.message : String(error)}`);
      return { source: 'NONE', slots: [], reason: error instanceof Error ? error.message : 'Der Kalender ist nicht erreichbar.' };
    }
  }
}
