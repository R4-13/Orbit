import { Inject, Injectable, Logger } from '@nestjs/common';
import { ToolOutcomeUnknownError, classifyThrownToolError, decidePolicyAction, type ToolRegistry } from '@orbit/agent-core';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLedgerService } from './action-ledger.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { LeadSyncService, type LeadSyncOutcome } from './lead-sync.service';
import { factLabel } from './reference/handoff-summary';
import { ReferenceProcessTools } from './reference/reference-process.tools';
import { RequestAnalysisService } from './reference/request-analysis.service';
import type { SupplementChange } from './reference/communication-templates';

export const SUPPLEMENT_EVENT_TYPES = {
  RECEIVED: 'supplement.received',
  APPLIED: 'supplement.applied',
  CONFIRMED: 'supplement.confirmed',
} as const;

export interface SupplementResult {
  /** Die Nachricht wurde als Ergänzung/Korrektur zu einem bereits übergebenen Vorgang verarbeitet (sonst entscheidet der bisherige Weg). */
  handled: boolean;
  changes: SupplementChange[];
  sync?: LeadSyncOutcome['state'];
  confirmation?: 'SENT' | 'WITHHELD' | 'NOT_NEEDED' | 'FAILED';
}

const HIDDEN_PREFIXES = ['contact.', 'appointment.', 'case.', 'inbound.', 'crm.', 'korrekturhinweis.'];
const display = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value));

/**
 * Eine Nachricht der Kundschaft, nachdem der Vorgang schon an das CRM übergeben wurde (Meilenstein B): sie wird nicht mehr als „Nachricht nach Abschluss“ nur vermerkt, sondern ausgewertet –
 * Angaben und Korrekturen gelangen in die Falldaten, der Lead im CRM wird (gelesen, geändert, zurückgelesen) auf diesen Stand gebracht, die Kundschaft erhält eine zutreffende Bestätigung
 * (nur über die vorhandene Berechtigung für Eingangsbestätigungen), und der Vorgang bleibt sichtbar offen, solange etwas nicht stimmt.
 * Je Nachricht wirkt das höchstens einmal (Ereignis mit Schlüssel); eine Wiederholung ändert nichts.
 */
@Injectable()
export class SupplementService {
  private readonly logger = new Logger(SupplementService.name);

  constructor(
    @Inject(TOOL_REGISTRY) private readonly tools: ToolRegistry,
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
    private readonly facts: CaseFactsService,
    private readonly leadSync: LeadSyncService,
    private readonly extraction: ReferenceProcessTools,
    private readonly analysis: RequestAnalysisService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly ledger: ActionLedgerService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly policy: PolicyEnforcementService,
  ) {}

  async processLateMessage(tenantId: string, caseId: string, messageId: string): Promise<SupplementResult> {
    const none: SupplementResult = { handled: false, changes: [] };
    const scoped = this.prisma.forTenantId(tenantId);
    const lead = await this.leadSync.leadOf(tenantId, caseId);
    if (!lead) return none;
    const row = await scoped.case.findUnique({ where: { id: caseId } });
    if (!row || !['COMPLETED', 'MANUAL_REVIEW'].includes(row.orchestrationStatus)) return none;
    const message = await scoped.emailMessage.findFirst({ where: { id: messageId, direction: 'INBOUND' } });
    // Nur die Kundschaft des Vorgangs ergänzt ihren Lead: andere Absender ändern nichts.
    const replyTarget = (await this.facts.getCurrent(tenantId, caseId)).find((f) => f.key === 'contact.email' && f.status === 'CONFIRMED')?.value;
    if (!message || typeof replyTarget !== 'string' || message.fromAddress.trim().toLowerCase() !== replyTarget.trim().toLowerCase()) return none;

    const claim = await this.events.append(tenantId, caseId, { type: SUPPLEMENT_EVENT_TYPES.RECEIVED, payload: { messageId }, dedupeKey: `supplement.received:${messageId}` });
    if (claim.duplicate) {
      // Diese Nachricht wurde schon verarbeitet: keine zweite Wirkung; der Abgleich selbst ist unabhängig davon idempotent.
      const outcome = await this.leadSync.syncCase(tenantId, caseId, { reason: 'SUPPLEMENT_REPEAT', messageId });
      await this.leadSync.reflectOnCase(tenantId, caseId, outcome);
      return { handled: Boolean(await scoped.caseEvent.findFirst({ where: { tenantId, dedupeKey: `supplement.applied:${messageId}` } })), changes: [], sync: outcome.state };
    }

    const run = await scoped.agentRun.create({ data: { tenantId, caseId, agentType: 'ORCHESTRATOR', triggerType: 'MANUAL', status: 'RUNNING', input: { purpose: 'supplement', messageId } } });
    const ctx = { tenantId, agentRunId: run.id };
    let extractionFailure: string | undefined;
    let recorded: Array<{ key: string; value: unknown; status: string }> = [];
    try {
      recorded = (await this.extraction.extractFromMessage(ctx, caseId, messageId)).recorded;
      await scoped.agentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    } catch (error) {
      extractionFailure = error instanceof Error ? error.message : String(error);
      await scoped.agentRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedAt: new Date(), output: { error: extractionFailure.slice(0, 300) } } });
    }

    const analysis = await this.analysis.latest(tenantId, caseId);
    const changes = await this.collectChanges(tenantId, caseId, messageId, recorded, analysis);
    const conflicts = await scoped.caseEvent.findMany({ where: { caseId, type: CASE_EVENT_TYPES.FACT_CONFLICT_DETECTED, payload: { path: ['messageId'], equals: messageId } } });
    const unresolved = await this.facts.openCorrectionNotes(tenantId, caseId);

    const outcome = await this.leadSync.syncCase(tenantId, caseId, { reason: 'SUPPLEMENT', messageId });
    const result: SupplementResult = { handled: changes.length > 0 || conflicts.length > 0 || unresolved.length > 0 || Boolean(extractionFailure), changes, sync: outcome.state };
    if (!result.handled) return result;

    // Der Vorgang bleibt sichtbar offen, solange etwas nicht stimmt – und schließt wieder, wenn alles stimmt.
    const problems: string[] = [];
    if (extractionFailure) problems.push(`Die Nachricht nach der Übergabe konnte nicht ausgewertet werden (${extractionFailure.slice(0, 120)}).`);
    if (conflicts.length > 0) problems.push('Eine Angabe widerspricht einer früheren, ohne dass erkennbar ist, welche gilt; bitte klären.');
    if (unresolved.length > 0) problems.push(`Eine angekündigte Korrektur ist noch nicht zugeordnet („${String(unresolved[0]!.value).slice(0, 100)}“).`);
    if (problems.length > 0) {
      await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: [...row.attentionReasons.filter((r) => !problems.includes(r)), ...problems].slice(-5) });
    }
    await this.leadSync.reflectOnCase(tenantId, caseId, outcome);

    // Die Bestätigung an die Kundschaft sagt nur, was stimmt: übernommen und weitergegeben ist es erst, wenn der Lead im CRM nachweislich auf diesem Stand ist.
    if (changes.length === 0) result.confirmation = 'NOT_NEEDED';
    else if (outcome.state !== 'SYNCED' || problems.length > 0) result.confirmation = 'WITHHELD';
    else {
      result.confirmation = await this.confirmToCustomer(tenantId, caseId, messageId, replyTarget, changes);
      if (result.confirmation === 'SENT') await this.events.append(tenantId, caseId, { type: SUPPLEMENT_EVENT_TYPES.CONFIRMED, payload: { messageId }, dedupeKey: `supplement.confirmed:${messageId}` });
    }

    await this.events.append(tenantId, caseId, {
      type: SUPPLEMENT_EVENT_TYPES.APPLIED,
      payload: { messageId, changes, sync: outcome.state, confirmation: result.confirmation, problems },
      dedupeKey: `supplement.applied:${messageId}`,
    });
    return result;
  }

  /** Was diese Nachricht an den Falldaten geändert hat: Korrekturen (alt → neu), neue Angaben, Ergänzungen. */
  private async collectChanges(tenantId: string, caseId: string, messageId: string, recorded: Array<{ key: string; value: unknown; status: string }>, analysis: Awaited<ReturnType<RequestAnalysisService['latest']>>): Promise<SupplementChange[]> {
    const scoped = this.prisma.forTenantId(tenantId);
    const changes: SupplementChange[] = [];
    const corrected = await scoped.caseEvent.findMany({ where: { caseId, type: CASE_EVENT_TYPES.FACT_CORRECTED, payload: { path: ['messageId'], equals: messageId } }, orderBy: { sequence: 'asc' } });
    for (const event of corrected) {
      const p = event.payload as { key?: string; previous?: unknown; current?: unknown };
      if (typeof p.key !== 'string' || HIDDEN_PREFIXES.some((h) => p.key!.startsWith(h))) continue;
      changes.push({ label: factLabel(p.key, analysis), value: display(p.current), previous: p.previous === null || p.previous === undefined ? undefined : display(p.previous), kind: 'CORRECTED' });
    }
    const correctedKeys = new Set(corrected.map((e) => (e.payload as { key?: string }).key));
    for (const item of recorded) {
      if (item.status !== 'CONFIRMED' || HIDDEN_PREFIXES.some((h) => item.key.startsWith(h)) || correctedKeys.has(item.key) || display(item.value) === '') continue;
      changes.push({ label: factLabel(item.key, analysis), value: display(item.value), kind: 'NEW' });
    }
    const current = await this.facts.getCurrent(tenantId, caseId);
    for (const fact of current) {
      if (fact.sourceRef !== `message:${messageId}` || !/\.ergaenzung\./.test(fact.key) || fact.key.startsWith('korrekturhinweis.') || fact.status === 'REJECTED') continue;
      changes.push({ label: factLabel(fact.key, analysis), value: display(fact.value), kind: 'SUPPLEMENTED' });
    }
    return changes;
  }

  /**
   * Die Bestätigung geht als Eingangsbestätigung (Zweck STATUS_UPDATE → Berechtigung `email.send.acknowledgement`) über dieselbe Absicht/Quittung wie jede andere Wirkung hinaus:
   * eine Absicht je Nachricht (Wiederholung = dieselbe Absicht, kein zweiter Versand). Ist die Berechtigung nicht „selbstständig“, geht nichts hinaus.
   */
  private async confirmToCustomer(tenantId: string, caseId: string, messageId: string, to: string, changes: SupplementChange[]): Promise<'SENT' | 'WITHHELD' | 'FAILED'> {
    const scoped = this.prisma.forTenantId(tenantId);
    const capability = this.capabilities.get('email.send');
    const plan = await scoped.processPlan.findFirst({ where: { caseId }, orderBy: { revision: 'desc' } });
    if (!capability || !plan) return 'WITHHELD';
    const mode = decidePolicyAction(await this.policy.resolveMode(tenantId, this.capabilities.policyActionFor(capability, 'STATUS_UPDATE') as never));
    if (mode !== 'ALLOW') {
      this.logger.warn(`supplement confirmation for case ${caseId} withheld: policy ${mode}`);
      return 'WITHHELD';
    }
    const row = await scoped.case.findUniqueOrThrow({ where: { id: caseId } });
    const run = await scoped.agentRun.create({ data: { tenantId, caseId, agentType: 'ORCHESTRATOR', triggerType: 'MANUAL', status: 'RUNNING', input: { purpose: 'supplement-confirmation', messageId } } });
    const ctx = { tenantId, agentRunId: run.id };
    const nodeKey = `supplement:${messageId}`;
    try {
      const draft = (await this.tools.execute('draft_communication', { to, purpose: 'STATUS_UPDATE', changes }, ctx)) as { draftId: string; contentHash?: string };
      const { intent } = await this.ledger.prepare(tenantId, { caseId, planId: plan.id, planRevision: plan.revision, caseRevision: row.revision, nodeKey, capabilityKey: capability.key, purpose: 'STATUS_UPDATE', payload: { capability: capability.key, purpose: 'STATUS_UPDATE', messageId } });
      if (intent.status === 'CONFIRMED') return 'SENT';
      if (!(await this.ledger.beginDispatch(tenantId, intent.id))) return 'WITHHELD';
      try {
        const sent = (await this.tools.execute('send_communication', { draftId: draft.draftId, purpose: 'STATUS_UPDATE' }, ctx)) as { providerRef?: string; executionMode?: 'LIVE' | 'SIMULATED' };
        if (!sent.providerRef) {
          await this.ledger.markUnknown(tenantId, intent.id, 'MISSING_PROVIDER_RECEIPT', { message: 'Der Anbieter hat den Versand nicht bestätigt.' });
          return 'FAILED';
        }
        await this.ledger.confirm(tenantId, intent.id, { providerRef: sent.providerRef, executionMode: sent.executionMode ?? 'LIVE', evidence: { output: sent as never, nodeKey } });
        await scoped.agentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        return 'SENT';
      } catch (error) {
        const contract = classifyThrownToolError(error);
        if (error instanceof ToolOutcomeUnknownError || contract.status === 'OUTCOME_UNKNOWN') await this.ledger.markUnknown(tenantId, intent.id, contract.errorCode ?? 'OUTCOME_UNKNOWN', { message: contract.message });
        else await this.ledger.fail(tenantId, intent.id, contract.errorCode ?? 'TOOL_FAILED', { message: contract.message });
        throw error;
      }
    } catch (error) {
      this.logger.warn(`supplement confirmation for case ${caseId} failed: ${error instanceof Error ? error.message : String(error)}`);
      await scoped.agentRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedAt: new Date(), output: { error: String(error instanceof Error ? error.message : error).slice(0, 300) } } });
      return 'FAILED';
    }
  }

  /**
   * Eine Bestätigung, die zurückgehalten wurde, weil der Lead noch nicht auf dem Stand war, geht hinaus, sobald der Abgleich gelungen ist (Wiederholung im Sweep). Je Nachricht höchstens einmal.
   */
  async resumeAfterSync(tenantId: string, caseId: string): Promise<number> {
    const lead = await this.leadSync.leadOf(tenantId, caseId);
    if (!lead || lead.crmSyncState !== 'SYNCED') return 0;
    const scoped = this.prisma.forTenantId(tenantId);
    const replyTarget = (await this.facts.getCurrent(tenantId, caseId)).find((f) => f.key === 'contact.email' && f.status === 'CONFIRMED')?.value;
    if (typeof replyTarget !== 'string') return 0;
    let sentCount = 0;
    for (const event of await scoped.caseEvent.findMany({ where: { caseId, type: SUPPLEMENT_EVENT_TYPES.APPLIED }, orderBy: { sequence: 'asc' } })) {
      const p = event.payload as { messageId?: string; confirmation?: string; changes?: SupplementChange[]; problems?: string[] };
      if (!p.messageId || p.confirmation !== 'WITHHELD' || !p.changes?.length || (p.problems ?? []).length > 0) continue;
      if (await scoped.caseEvent.findFirst({ where: { tenantId, dedupeKey: `supplement.confirmed:${p.messageId}` } })) continue;
      if ((await this.confirmToCustomer(tenantId, caseId, p.messageId, replyTarget, p.changes)) === 'SENT') {
        await this.events.append(tenantId, caseId, { type: SUPPLEMENT_EVENT_TYPES.CONFIRMED, payload: { messageId: p.messageId, afterRetry: true }, dedupeKey: `supplement.confirmed:${p.messageId}` });
        sentCount += 1;
      }
    }
    return sentCount;
  }

  /** Hat diese Nachricht schon eine Ergänzung bewirkt? Dann braucht sie nach dem Abschluss keine zusätzliche Aufgabe „Nachricht nach Abschluss“. */
  async wasApplied(tenantId: string, messageId: string): Promise<boolean> {
    return Boolean(await this.prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { tenantId, dedupeKey: `supplement.applied:${messageId}` } }));
  }
}
