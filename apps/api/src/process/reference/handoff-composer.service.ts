import { Injectable } from '@nestjs/common';
import { CRM_NOTES_MAX_CHARS, CRM_TITLE_MAX_CHARS } from '@orbit/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CASE_EVENT_TYPES } from '../case-events.service';
import { CaseFactsService } from '../case-facts.service';
import { messageCaseIds } from '../case-scope';
import { buildHandoffSummary, type HandoffSummary } from './handoff-summary';
import { PRICE_QUESTION_KEY } from './price-question';
import { APPOINTMENT_AGREED_KEY } from './request-analysis';
import { RequestAnalysisService } from './request-analysis.service';

/** Marker, mit dem ein Hinweis des Aufrufs an die Übergabe angehängt wird (und beim späteren Abgleich unverändert erhalten bleibt). */
export const HANDOFF_NOTE_MARKER = '\n\nHinweis: ';

export interface ComposedHandoff {
  summary: HandoffSummary;
  /** Der Wortlaut, der ins CRM geschrieben wird (Beschreibung des Leads). */
  text: string;
  /** Die Bezeichnung des Leads im CRM. */
  title: string;
}

/**
 * Setzt die Übergabe an das CRM aus dem **aktuellen** Stand des Vorgangs zusammen (Analyse, bestätigte Angaben, Termin, offene Klärungen). Sie wird beim Anlegen des Leads und bei jedem
 * späteren Abgleich (Ergänzung, Korrektur) verwendet – derselbe Stand ergibt denselben Text, ein anderer Stand einen anderen; die strukturierten Angaben und der Text können sich so nicht widersprechen.
 */
@Injectable()
export class HandoffComposerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analysis: RequestAnalysisService,
    private readonly caseFacts: CaseFactsService,
  ) {}

  async compose(tenantId: string, caseId: string, customer: { name: string; email: string }, note?: string): Promise<ComposedHandoff> {
    const scoped = this.prisma.forTenantId(tenantId);
    const caseRow = await scoped.case.findUnique({ where: { id: caseId }, select: { title: true } });
    const first = await scoped.emailMessage.findFirst({ where: { caseId: { in: await messageCaseIds(this.prisma, tenantId, caseId) }, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    const tenantRow = await this.prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }));
    const analysis = await this.analysis.latest(tenantId, caseId);
    const facts = (await this.caseFacts.getCurrent(tenantId, caseId)).filter((f) => f.status === 'CONFIRMED').map((f) => ({ key: f.key, value: f.value }));
    const booked = await scoped.caseEvent.findFirst({ where: { caseId, type: CASE_EVENT_TYPES.APPOINTMENT_BOOKED }, orderBy: { sequence: 'desc' } });
    const bookedPayload = booked?.payload as { kind?: string; start?: string; assignee?: { name?: string } } | null | undefined;
    const proposed = await scoped.caseEvent.findFirst({ where: { caseId, type: CASE_EVENT_TYPES.APPOINTMENT_PROPOSED }, orderBy: { sequence: 'desc' } });
    const proposedSlots = (proposed?.payload as { slots?: unknown[] } | null | undefined)?.slots?.length ?? 0;
    const agreed = facts.find((f) => f.key === APPOINTMENT_AGREED_KEY)?.value;
    const priceText = facts.find((f) => f.key === PRICE_QUESTION_KEY)?.value;
    const priceAnswered = typeof priceText === 'string' && (await scoped.actionIntent.count({ where: { caseId, capabilityKey: 'email.send', purpose: 'INFORMATION', status: 'CONFIRMED' } })) > 0;
    const summary = buildHandoffSummary({
      customer: { name: customer.name || undefined, email: customer.email },
      title: caseRow?.title ?? 'Anfrage',
      receivedAt: first?.createdAt ?? new Date(),
      timeZone: tenantRow?.timezone || 'Europe/Berlin',
      analysis,
      facts,
      openCorrections: (await this.caseFacts.openCorrectionNotes(tenantId, caseId)).map((n) => String(n.value)),
      ...(typeof priceText === 'string' ? { priceQuestion: { text: priceText, answered: priceAnswered } } : {}),
      appointment: {
        ...(bookedPayload?.kind && bookedPayload.start ? { booked: { kind: bookedPayload.kind, start: bookedPayload.start, ...(bookedPayload.assignee?.name ? { assignee: bookedPayload.assignee.name } : {}) } } : {}),
        ...(typeof agreed === 'string' && agreed.trim() ? { agreed } : {}),
        proposedSlots,
      },
    });
    const extra = note?.trim() ? `${HANDOFF_NOTE_MARKER}${note.trim()}` : '';
    const subject = analysis?.requestType ? `Anfrage ${analysis.requestType}` : (caseRow?.title ?? 'Anfrage');
    return { summary, text: `${summary.text}${extra}`.slice(0, CRM_NOTES_MAX_CHARS), title: `${subject}${customer.name ? ` – ${customer.name}` : ''}`.slice(0, CRM_TITLE_MAX_CHARS) };
  }
}
