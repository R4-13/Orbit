import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ActionIntent, Case, CommunicationDraft } from '@orbit/domain';
import { ApprovalsService } from '../approvals/approvals.service';
import { GmailSendOutcomeUnknownError } from '../integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../integrations/outbound-mail.port';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLedgerService } from './action-ledger.service';
import { CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { assignmentQuestionLines, familyReplyBody, draftCore, type FamilyReplySection, type FamilyStateKind } from './family-reply-body';
import { ASSIGNMENT_QUESTION_EVENT, ReplyRoutingService, type OpenChild, type RoutingOutcome } from './reply-routing.service';
import { familyLabel } from './family-label';
import { replyLanguage } from './reference/reply-language';
import { ReferenceProcessService } from './reference/reference-process.service';
import { replySubject } from './reference/communication-templates';

export const FAMILY_EVENT_TYPES = {
  /** Ein Teilvorgang hat einen Entwurf an die Kundschaft nicht selbst versendet, sondern für die gemeinsame Antwort bereitgehalten. */
  PART_HELD: 'family.part_held',
  /** Die gemeinsame Antwort wurde beansprucht (verhindert eine zweite gleichzeitige). */
  REPLY_CLAIMED: 'family.reply_claimed',
  REPLY_AWAITING_APPROVAL: 'family.reply_awaiting_approval',
  REPLY_SENT: 'family.reply_sent',
  REPLY_DISCARDED: 'family.reply_discarded',
  /** Der Versand scheiterte sicher (nichts wurde zugestellt): die Teile stehen für den nächsten Versuch bereit. */
  REPLY_RELEASED: 'family.reply_released',
} as const;

/** Zwecke, deren Entwürfe an die Kundschaft in der gemeinsamen Antwort aufgehen (ohne Anhang). */
export const BUNDLEABLE_PURPOSES: ReadonlySet<string> = new Set(['CLARIFICATION', 'INFORMATION', 'ACKNOWLEDGEMENT', 'STATUS_UPDATE', 'ATTACHMENT_REQUEST', 'APPOINTMENT_CONFIRMATION']);
const FAMILY_NODE_PREFIX = 'family-reply:';
/** Ein Teilvorgang, der so lange nicht angefasst wurde, hält die gemeinsame Antwort nicht mehr auf (er gilt als hängengeblieben; der Sweep kümmert sich um ihn). */
const BUSY_WINDOW_MS = 10 * 60_000;
/** Ein Teilvorgang, der gerade erst auf eine Freigabe (Plan oder Auskunft) wartet, hält die gemeinsame Antwort kurz zurück: meist kommt die Freigabe in Minuten, und die Kundschaft soll eine Antwort bekommen, nicht zwei. Danach geht der Stand hinaus. */
const APPROVAL_GRACE_MS = 30 * 60_000;
const NO_REPLY_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounces?)([+._-]|@)/i;

export type SettleOutcome = 'SENT' | 'AWAITING_APPROVAL' | 'NOTHING' | 'BUSY' | 'HELD_BACK' | 'FAILED';

interface HeldPart {
  childId: string;
  draftId: string;
  purpose: string;
  core: string[];
}

interface Reported {
  /** Welche Entwürfe schon in einer Antwort (oder deren Freigabe) aufgegangen sind. */
  covered: Set<string>;
  /** Zuletzt mitgeteilter Stand je Teilvorgang. */
  states: Map<string, string>;
  /** Auf welche Nachrichten schon geantwortet wurde (die erste Antwort bestätigt den Eingang). */
  repliedTo: Set<string>;
  /** Welche Zuordnungs-Rückfragen (Ereignisse) schon in einer Antwort (oder deren Freigabe) aufgegangen sind. */
  questions: Set<string>;
  claims: number;
}

/**
 * Die gemeinsame Antwort einer aufgeteilten Nachricht (Meilenstein C, K3/K4): Teilvorgänge senden an die Kundschaft nicht selbst, sondern halten ihre – nach ihrer eigenen Regel bereits zulässigen –
 * Entwürfe (Rückfrage, Auskunft …) bereit. Sind alle Teilvorgänge „ruhig“ (warten auf Antwort/Freigabe, übergeben, erledigt), setzt der Hauptvorgang **eine** Nachricht zusammen: Einleitung (die einzige
 * Eingangsbestätigung), je Anliegen ein Abschnitt (Rückfragen, Auskünfte, sonst der wahre Stand: übergeben / wird geprüft / erledigt). Ein blockiertes Anliegen hält die anderen nicht auf: Teile, die noch
 * nicht zulässig sind (z. B. eine Auskunft vor der Freigabe), fehlen in der Antwort und gehen später gesondert hinaus. Der Versand selbst läuft über das Aktionsregister des Hauptvorgangs (eine Absicht je
 * Antwort, Quittung, Freigabe bei Bedarf) unter der Regel für Eingangsbestätigungen (`email.send.acknowledgement`).
 */
@Injectable()
export class FamilyReplyService {
  private readonly logger = new Logger(FamilyReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
    private readonly ledger: ActionLedgerService,
    private readonly policy: PolicyEnforcementService,
    private readonly approvals: ApprovalsService,
    private readonly reference: ReferenceProcessService,
    private readonly facts: CaseFactsService,
    private readonly routing: ReplyRoutingService,
    @Inject(OUTBOUND_MAIL) private readonly mail: OutboundMailPort,
  ) {}

  /** Gehört der Vorgang zu einer aufgeteilten Nachricht (hat er einen Hauptvorgang)? */
  async parentOf(tenantId: string, caseId: string): Promise<string | undefined> {
    const row = await this.prisma.forTenantId(tenantId).case.findFirst({ where: { id: caseId }, select: { parentCaseId: true } });
    return row?.parentCaseId ?? undefined;
  }

  /**
   * Hält einen Entwurf eines Teilvorgangs für die gemeinsame Antwort bereit, statt ihn zu senden. Liefert den Nachweis, den der Teilvorgang als „übergeben an die gemeinsame Antwort“ quittiert, oder
   * `undefined`, wenn der Entwurf nicht dafür geeignet ist (kein Teilvorgang, Anhang, anderer Zweck) und wie bisher gesendet wird.
   */
  async hold(tenantId: string, childCaseId: string, draft: CommunicationDraft): Promise<{ providerRef: string; parentCaseId: string } | undefined> {
    const parentCaseId = await this.parentOf(tenantId, childCaseId);
    if (!parentCaseId || !BUNDLEABLE_PURPOSES.has(draft.purpose) || draft.attachmentDocumentIds.length > 0) return undefined;
    await this.events.append(tenantId, childCaseId, {
      type: FAMILY_EVENT_TYPES.PART_HELD,
      payload: { draftId: draft.id, purpose: draft.purpose, core: draftCore(draft.bodyText), parentCaseId },
      dedupeKey: `family.part:${draft.id}`,
    });
    return { providerRef: `family-reply:${parentCaseId}:${draft.id}`, parentCaseId };
  }

  private async reported(tenantId: string, parentId: string): Promise<Reported> {
    const rows = await this.prisma.forTenantId(tenantId).caseEvent.findMany({
      where: { caseId: parentId, type: { in: [FAMILY_EVENT_TYPES.REPLY_SENT, FAMILY_EVENT_TYPES.REPLY_AWAITING_APPROVAL, FAMILY_EVENT_TYPES.REPLY_DISCARDED, FAMILY_EVENT_TYPES.REPLY_CLAIMED] } },
      orderBy: { sequence: 'asc' },
      select: { type: true, payload: true },
    });
    const result: Reported = { covered: new Set(), states: new Map(), repliedTo: new Set(), questions: new Set(), claims: 0 };
    for (const row of rows) {
      if (row.type === FAMILY_EVENT_TYPES.REPLY_CLAIMED) {
        result.claims += 1;
        continue;
      }
      const p = row.payload as { draftIds?: string[]; questionIds?: string[]; states?: Record<string, string>; messageId?: string } | null;
      for (const id of p?.draftIds ?? []) result.covered.add(id);
      if (row.type !== FAMILY_EVENT_TYPES.REPLY_DISCARDED) for (const id of p?.questionIds ?? []) result.questions.add(id);
      if (row.type !== FAMILY_EVENT_TYPES.REPLY_DISCARDED) {
        for (const [child, kind] of Object.entries(p?.states ?? {})) result.states.set(child, kind);
        if (p?.messageId) result.repliedTo.add(p.messageId);
      }
    }
    return result;
  }

  /** Was sich über den Stand eines ruhigen Teilvorgangs wahrheitsgemäß sagen lässt – oder nichts. */
  private async stateOf(tenantId: string, child: Case, hasHeldPart: boolean): Promise<FamilyStateKind | undefined> {
    const scoped = this.prisma.forTenantId(tenantId);
    switch (child.orchestrationStatus) {
      case 'MANUAL_REVIEW':
      case 'FAILED':
        // Nur was bei einer Person liegt, wird als übergeben gemeldet: es gibt eine offene Aufgabe zu diesem Anliegen.
        return (await scoped.task.count({ where: { caseId: child.id, status: { notIn: ['DONE', 'CANCELLED'] } } })) > 0 ? 'HANDOVER' : undefined;
      case 'WAITING_FOR_APPROVAL':
        return 'IN_REVIEW';
      case 'COMPLETED':
        return hasHeldPart ? undefined : 'DONE';
      default:
        return undefined;
    }
  }

  /**
   * Setzt – wenn alle Teilvorgänge ruhig sind (oder mit `force`) – die gemeinsame Antwort zusammen und versendet sie bzw. legt sie zur Freigabe vor. Wirft nie: die Bearbeitung der Teilvorgänge darf
   * an der Antwort nicht scheitern; was nicht gelingt, bleibt als Hinweis am Hauptvorgang sichtbar und wird vom Sweep erneut versucht.
   */
  async settle(tenantId: string, parentId: string, options: { force?: boolean } = {}): Promise<SettleOutcome> {
    try {
      return await this.settleInner(tenantId, parentId, options);
    } catch (error) {
      this.logger.warn(`family reply of case ${parentId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return 'FAILED';
    }
  }

  private async settleInner(tenantId: string, parentId: string, options: { force?: boolean }): Promise<SettleOutcome> {
    const scoped = this.prisma.forTenantId(tenantId);
    const parent = await scoped.case.findFirst({ where: { id: parentId } });
    if (!parent || parent.parentCaseId) return 'NOTHING';
    const children = await scoped.case.findMany({ where: { parentCaseId: parentId }, orderBy: { createdAt: 'asc' } });
    if (children.length === 0) return 'NOTHING';
    const now = Date.now();
    if (!options.force && children.some((c) => (['RECEIVED', 'READY', 'IN_PROGRESS'].includes(c.orchestrationStatus) && now - c.updatedAt.getTime() < BUSY_WINDOW_MS) || (c.orchestrationStatus === 'WAITING_FOR_APPROVAL' && now - c.updatedAt.getTime() < APPROVAL_GRACE_MS))) return 'BUSY';

    const state = await this.reported(tenantId, parentId);
    const heldRows = await scoped.caseEvent.findMany({ where: { caseId: { in: children.map((c) => c.id) }, type: FAMILY_EVENT_TYPES.PART_HELD }, orderBy: { createdAt: 'asc' }, select: { caseId: true, payload: true } });
    const pending: HeldPart[] = heldRows
      .map((r) => ({ childId: r.caseId, ...(r.payload as { draftId: string; purpose: string; core: string[] }) }))
      .filter((p) => !state.covered.has(p.draftId));
    const everHeld = new Set(heldRows.map((r) => r.caseId));

    // Die letzte Nachricht der Kundschaft in der Familie: Empfänger und Bezug der Antwort, und worauf sich zugeordnete Angaben beziehen.
    const family = [parentId, ...children.map((c) => c.id)];
    const inbound = await scoped.emailMessage.findFirst({ where: { caseId: { in: family }, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    const assignedRows = inbound ? await scoped.caseEvent.findMany({ where: { caseId: { in: children.map((c) => c.id) }, type: 'family.reply_assigned' }, select: { caseId: true, payload: true } }) : [];
    const withNewInfo = new Set(assignedRows.filter((r) => (r.payload as { messageId?: string } | null)?.messageId === inbound?.id).map((r) => r.caseId));

    // Der Stand der Anliegen ohne eigenen Inhalt – nur, was seit der letzten Antwort neu ist. Hat die Kundschaft zu einem Anliegen Angaben gemacht, die bei der zuständigen Person liegen, sagt die Antwort das.
    const states = new Map<string, FamilyStateKind>();
    for (const child of children) {
      if (pending.some((p) => p.childId === child.id && p.purpose !== 'ACKNOWLEDGEMENT')) continue;
      let kind = await this.stateOf(tenantId, child, everHeld.has(child.id));
      if (kind === 'HANDOVER' && withNewInfo.has(child.id) && inbound && !state.repliedTo.has(inbound.id)) kind = 'INFO_PASSED';
      const reported = state.states.get(child.id);
      if (kind && reported !== kind && !(kind === 'HANDOVER' && reported === 'INFO_PASSED')) states.set(child.id, kind);
    }
    const contentParts = pending.filter((p) => p.purpose !== 'ACKNOWLEDGEMENT' && p.core.length > 0);
    const wantsReceipt = pending.some((p) => p.purpose === 'ACKNOWLEDGEMENT');
    // Offene Rückfragen zur Zuordnung einer Antwort der Kundschaft (Aussagen, die nicht eindeutig zu einem Anliegen gehören).
    const questionRows = await scoped.caseEvent.findMany({ where: { caseId: parentId, type: ASSIGNMENT_QUESTION_EVENT }, orderBy: { createdAt: 'asc' }, select: { id: true, payload: true } });
    const pendingQuestions = questionRows.filter((q) => !state.questions.has(q.id));
    if (contentParts.length === 0 && states.size === 0 && !wantsReceipt && pendingQuestions.length === 0) return 'NOTHING';

    // Empfänger: die Antwortadresse ist die bestätigte des Vorgangs.
    const confirmed = (await this.facts.getCurrent(tenantId, parentId)).find((f) => f.key === 'contact.email' && f.status === 'CONFIRMED')?.value;
    const to = typeof confirmed === 'string' && confirmed.length > 3 ? confirmed : inbound?.fromAddress;
    if (!inbound || !to || NO_REPLY_SENDER.test(to)) {
      await this.discard(tenantId, parentId, pending, 'Kein verlässlicher Empfänger für die gemeinsame Antwort.');
      return 'HELD_BACK';
    }

    const mode = await this.policy.resolveMode(tenantId, 'email.send.acknowledgement');
    if (mode === 'DISABLED' || mode === 'SUGGEST_ONLY') {
      await this.markAttention(tenantId, parent, 'Die gemeinsame Antwort an die Kundschaft ist per Regel nicht selbstständig erlaubt; bitte selbst antworten.');
      return 'HELD_BACK';
    }

    const tenantRow = await this.prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }));
    const profile = await scoped.tenantProfile.findUnique({ where: { tenantId }, select: { languages: true } });
    const lang = replyLanguage(`${inbound.subject ?? ''}\n${inbound.bodyText ?? inbound.bodyPreview ?? ''}`, profile?.languages);
    const watch = await scoped.customerRecordWatch.findFirst({ where: { caseId: { in: family } }, select: { displayName: true } });
    // Die Eingangsbestätigung gehört der ursprünglichen Nachricht; die Antwort der Kundschaft auf eine Rückfrage bekommt den Stand, keine zweite Bestätigung des Eingangs.
    const earliest = await scoped.emailMessage.findFirst({ where: { caseId: { in: family }, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    const first = inbound.id === earliest?.id && !state.repliedTo.has(inbound.id);
    const sections: FamilyReplySection[] = [];
    if (pendingQuestions.length > 0) {
      const items = pendingQuestions.map((q) => q.payload as { statement: string; options: Array<{ label: string; questions: string[] }> });
      sections.push({ label: '', lines: assignmentQuestionLines(items, lang), plain: true });
    }
    for (const child of children) {
      const mine = contentParts.filter((p) => p.childId === child.id);
      const kind = states.get(child.id);
      if (mine.length === 0 && !kind) continue;
      sections.push({ label: await this.labelOf(tenantId, child), lines: mine.flatMap((p, i) => (i > 0 ? ['', ...p.core] : p.core)), ...(mine.length === 0 && kind ? { state: kind } : {}) });
    }
    const bodyText = familyReplyBody({ name: watch?.displayName ?? undefined, companyName: tenantRow?.name ?? 'Ihr Ansprechpartner', lang, originalSubject: inbound.subject, confirmsReceipt: first, concerns: children.length, sections });
    const draftIds = pending.map((p) => p.draftId);
    const questionIds = pendingQuestions.map((q) => q.id);

    // Beanspruchen: höchstens eine gemeinsame Antwort gleichzeitig.
    const claim = await this.events.append(tenantId, parentId, { type: FAMILY_EVENT_TYPES.REPLY_CLAIMED, payload: { draftIds, questionIds, messageId: inbound.id }, dedupeKey: `family.claim:${parentId}:${state.claims + 1}` });
    if (claim.duplicate) return 'BUSY';

    const { draft } = await this.reference.saveDraftVersion(tenantId, {
      caseId: parentId,
      purpose: 'FAMILY_REPLY',
      toAddress: to,
      subject: replySubject(inbound.subject),
      bodyText,
      attachmentDocumentIds: [],
      threadId: inbound.threadId ?? undefined,
      inReplyTo: inbound.rfcMessageId ?? undefined,
    });
    const { intent } = await this.ledger.prepare(tenantId, {
      caseId: parentId,
      planId: 'family-reply',
      planRevision: 0,
      caseRevision: parent.revision,
      nodeKey: `${FAMILY_NODE_PREFIX}${state.claims + 1}`,
      capabilityKey: 'email.send',
      purpose: 'STATUS_UPDATE',
      payload: { capability: 'email.send', purpose: 'STATUS_UPDATE', input: { draftId: draft.id }, family: { draftIds, questionIds, messageId: inbound.id, states: Object.fromEntries(states) } },
    });
    if (mode === 'REQUIRE_APPROVAL') {
      if (!intent.approvalId) {
        const approval = await this.approvals.create(tenantId, { entityType: 'PROCESS_ACTION', entityId: intent.id, policyAction: 'email.send.acknowledgement', reason: 'Gemeinsame Antwort an die Kundschaft (mehrere Anliegen) wartet auf Freigabe.' });
        await this.ledger.awaitApproval(tenantId, intent.id, approval.id);
      }
      await this.events.append(tenantId, parentId, { type: FAMILY_EVENT_TYPES.REPLY_AWAITING_APPROVAL, payload: { intentId: intent.id, draftIds, questionIds, messageId: inbound.id, states: Object.fromEntries(states) } });
      return 'AWAITING_APPROVAL';
    }
    return this.dispatch(tenantId, parent, intent, draft);
  }

  private labelOf(tenantId: string, child: Case): Promise<string> {
    return familyLabel(this.prisma, tenantId, child);
  }

  private async dispatch(tenantId: string, parent: Case, intent: ActionIntent, draft: CommunicationDraft): Promise<SettleOutcome> {
    const scoped = this.prisma.forTenantId(tenantId);
    if (intent.status === 'CONFIRMED') return 'SENT';
    if (!(await this.ledger.beginDispatch(tenantId, intent.id))) return 'BUSY';
    const family = (intent.payload as { family?: { draftIds?: string[]; questionIds?: string[]; messageId?: string; states?: Record<string, string> } }).family ?? {};
    let sent;
    try {
      sent = await this.mail.send(tenantId, { to: draft.toAddress, subject: draft.subject, bodyText: draft.bodyText, threadId: draft.threadId ?? undefined, inReplyTo: draft.inReplyTo ?? undefined, references: draft.inReplyTo ? [draft.inReplyTo] : undefined, attachments: [] });
    } catch (error) {
      if (error instanceof GmailSendOutcomeUnknownError) {
        await this.ledger.markUnknown(tenantId, intent.id, 'SEND_OUTCOME_UNKNOWN', { message: error.message });
        await this.markAttention(tenantId, parent, 'Ob die gemeinsame Antwort zugestellt wurde, ist ungewiss; bitte im Postfach prüfen, bevor erneut geantwortet wird.');
        return 'FAILED';
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.ledger.fail(tenantId, intent.id, 'SEND_FAILED', { message: message.slice(0, 200) });
      await this.events.append(tenantId, parent.id, { type: FAMILY_EVENT_TYPES.REPLY_RELEASED, payload: { intentId: intent.id, error: message.slice(0, 200) } });
      await this.markAttention(tenantId, parent, 'Die gemeinsame Antwort konnte nicht zugestellt werden; ORBIT versucht es erneut.');
      return 'FAILED';
    }
    const sentAt = new Date();
    try {
      await scoped.emailMessage.create({
        data: { tenantId, caseId: parent.id, direction: 'OUTBOUND', fromAddress: sent.from, toAddresses: [draft.toAddress], subject: draft.subject, bodyText: draft.bodyText.slice(0, 20_000), bodyPreview: draft.bodyText.slice(0, 500), providerMessageId: sent.providerMessageId, threadId: sent.threadId ?? draft.threadId, rfcMessageId: sent.rfcMessageId, inReplyTo: draft.inReplyTo, sentAt },
      });
      await scoped.communicationDraft.update({ where: { id: draft.id }, data: { status: 'SENT' } });
    } catch {
      await this.ledger.markUnknown(tenantId, intent.id, 'SEND_CONFIRMATION_FAILED', { providerMessageId: sent.providerMessageId });
      await this.markAttention(tenantId, parent, 'Die gemeinsame Antwort wurde zugestellt, die Aufzeichnung ist aber fehlgeschlagen; bitte abgleichen.');
      return 'FAILED';
    }
    await this.ledger.confirm(tenantId, intent.id, { providerRef: sent.providerMessageId, executionMode: sent.executionMode, evidence: { recipient: draft.toAddress, sentAt: sentAt.toISOString(), nodeKey: intent.nodeKey } });
    await this.events.append(tenantId, parent.id, { type: FAMILY_EVENT_TYPES.REPLY_SENT, payload: { intentId: intent.id, draftIds: family.draftIds ?? [], questionIds: family.questionIds ?? [], messageId: family.messageId ?? null, states: family.states ?? {}, providerRef: sent.providerMessageId } });
    return 'SENT';
  }

  /** Nach der Freigabe einer gemeinsamen Antwort: sie geht hinaus (Aufruf aus `OrchestratorService.decideAction`). */
  async dispatchApproved(tenantId: string, intentId: string): Promise<void> {
    const intent = await this.ledger.get(tenantId, intentId);
    if (!intent.nodeKey.startsWith(FAMILY_NODE_PREFIX) || intent.status !== 'APPROVED') return;
    const scoped = this.prisma.forTenantId(tenantId);
    const parent = await scoped.case.findUniqueOrThrow({ where: { id: intent.caseId } });
    const draftId = (intent.payload as { input?: { draftId?: string } }).input?.draftId;
    const draft = draftId ? await scoped.communicationDraft.findFirst({ where: { id: draftId } }) : null;
    if (!draft) return;
    await this.dispatch(tenantId, parent, intent, draft);
  }

  /** Abgelehnte gemeinsame Antwort: ihre Teile gelten als erledigt (nicht erneut vorgelegt); der Hauptvorgang zeigt es an. */
  async discardRejected(tenantId: string, intentId: string): Promise<void> {
    const intent = await this.ledger.get(tenantId, intentId);
    if (!intent.nodeKey.startsWith(FAMILY_NODE_PREFIX)) return;
    const family = (intent.payload as { family?: { draftIds?: string[] } }).family;
    await this.events.append(tenantId, intent.caseId, { type: FAMILY_EVENT_TYPES.REPLY_DISCARDED, payload: { intentId, draftIds: family?.draftIds ?? [], reason: 'abgelehnt' } });
    const parent = await this.prisma.forTenantId(tenantId).case.findUnique({ where: { id: intent.caseId } });
    if (parent) await this.markAttention(tenantId, parent, 'Die gemeinsame Antwort an die Kundschaft wurde abgelehnt; bitte selbst antworten.');
  }

  /**
   * Eine Antwort der Kundschaft auf eine gemeinsame Nachricht den Anliegen zuordnen (Meilenstein C): aus Gegenstand, gestellten Rückfragen und Gesprächszusammenhang; Mehrdeutiges wird gezielt
   * zurückgefragt (die nächste gemeinsame Antwort nimmt die Rückfrage auf). Nur Teilvorgänge mit zugeordneten Sätzen setzen fort.
   */
  routeReply(tenantId: string, parentId: string, messageId: string, children: OpenChild[]): Promise<RoutingOutcome> {
    return this.routing.routeAndAssign(tenantId, parentId, messageId, children);
  }

  isFamilyIntent(intent: Pick<ActionIntent, 'nodeKey'>): boolean {
    return intent.nodeKey.startsWith(FAMILY_NODE_PREFIX);
  }

  private async discard(tenantId: string, parentId: string, parts: HeldPart[], reason: string): Promise<void> {
    if (parts.length === 0) return;
    await this.events.append(tenantId, parentId, { type: FAMILY_EVENT_TYPES.REPLY_DISCARDED, payload: { draftIds: parts.map((p) => p.draftId), reason } });
  }

  private async markAttention(tenantId: string, parent: Case, reason: string): Promise<void> {
    if (parent.attentionReasons.includes(reason)) return;
    await this.prisma.forTenantId(tenantId).case.update({ where: { id: parent.id }, data: { attentionReasons: [...parent.attentionReasons, reason].slice(-5) } });
  }

  /** Hauptvorgänge aufgeteilter Nachrichten, deren Teilvorgänge zuletzt bewegt wurden (für den Sweep): ob etwas zu sagen ist, entscheidet `settle`. */
  async activeParents(limit = 50): Promise<Array<{ tenantId: string; parentCaseId: string }>> {
    const rows = await this.prisma.withRlsBypass((tx) =>
      tx.case.findMany({ where: { parentCaseId: { not: null }, updatedAt: { gt: new Date(Date.now() - 7 * 24 * 3600_000) }, parent: { orchestrationStatus: { notIn: ['CANCELLED', 'REJECTED'] } } }, select: { tenantId: true, parentCaseId: true }, orderBy: { updatedAt: 'desc' }, take: 300 }),
    );
    const seen = new Map<string, { tenantId: string; parentCaseId: string }>();
    for (const row of rows) if (row.parentCaseId) seen.set(`${row.tenantId}:${row.parentCaseId}`, { tenantId: row.tenantId, parentCaseId: row.parentCaseId });
    return [...seen.values()].slice(0, limit);
  }
}
