import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Lead } from '@orbit/domain';
import type { CrmConnector } from '@orbit/integration-core';
import { crmFieldText, leadContentHash, normalizeCrmText } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { CRM_CONNECTOR } from '../connectors/connectors.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { CaseEventsService } from './case-events.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { CaseFactsService } from './case-facts.service';
import { HANDOFF_NOTE_MARKER, HandoffComposerService } from './reference/handoff-composer.service';

export type LeadSyncState = 'NONE' | 'SYNCED' | 'OUT_OF_SYNC' | 'FAILED' | 'CONFLICT';

export interface LeadSyncOutcome {
  state: LeadSyncState | 'BUSY';
  /** Es wurde tatsächlich ins CRM geschrieben (nicht nur geprüft). */
  written: boolean;
  leadId?: string;
  error?: string;
}

/** Grund-Präfix der Aufmerksamkeitshinweise, die dieser Dienst setzt – nur diese löst er selbst wieder auf. */
export const LEAD_SYNC_REASON_PREFIX = 'Lead-Abgleich';
const LOCK_MS = 60_000;
/** Zeilenumbrüche und Leerräume spielen für den Vergleich keine Rolle: CRM-Systeme speichern sie nicht byte-genau zurück. */
const squash = (text: string | undefined | null): string => normalizeCrmText(text ?? '').replace(/\s+/g, ' ');

/**
 * Hält den **vom Vorgang angelegten** Lead im CRM auf dem Stand der Falldaten (Meilenstein B). Regeln:
 *  - Nur der gespeicherte Lead dieses Vorgangs (CRM-Kennung aus dem Anlegen) wird gelesen und geändert; nie ein anderes Objekt, nie ein zweiter Lead.
 *  - Vor jeder Änderung wird der CRM-Stand gelesen: hat dort jemand von Hand geändert, wird **nichts überschrieben** (Zustand `CONFLICT`, sichtbar).
 *  - Nach der Änderung wird zurückgelesen; nur ein bestätigter Rückstand ist `SYNCED`. Gleicher Inhalt (Hash) ergibt keine zweite Wirkung.
 *  - Die bestehende Berechtigung (`lead.create`) gilt auch hier: ist das automatische Anlegen nicht erlaubt, ändert ORBIT den Lead nicht selbst.
 *  - Ein Ausfall bleibt sichtbar offen (`FAILED`, Wiederholung im Sweep); eine Aufgabe für einen Menschen ersetzt die Aktualisierung nie.
 */
@Injectable()
export class LeadSyncService {
  private readonly logger = new Logger(LeadSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRM_CONNECTOR) private readonly crm: CrmConnector,
    private readonly audit: AuditService,
    private readonly events: CaseEventsService,
    private readonly composer: HandoffComposerService,
    private readonly policy: PolicyEnforcementService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly facts: CaseFactsService,
  ) {}

  /** Der Lead dieses Vorgangs mit CRM-Bezug (oder nichts). */
  async leadOf(tenantId: string, caseId: string) {
    const lead = await this.prisma.forTenantId(tenantId).lead.findFirst({ where: { caseId, crmExternalId: { not: null } }, include: { contact: true } });
    return lead ?? undefined;
  }

  async syncCase(tenantId: string, caseId: string, trigger: { reason: string; messageId?: string }): Promise<LeadSyncOutcome> {
    const lead = await this.leadOf(tenantId, caseId);
    if (!lead?.crmExternalId) return { state: 'NONE', written: false };
    const scoped = this.prisma.forTenantId(tenantId);

    const mode = await this.policy.resolveMode(tenantId, 'lead.create');
    if (mode !== 'AUTONOMOUS') {
      const error = 'Die Berechtigung erlaubt das selbstständige Aktualisieren des Leads nicht; die Falldaten sind geändert, der Lead im CRM nicht.';
      await scoped.lead.update({ where: { id: lead.id }, data: { crmSyncState: 'OUT_OF_SYNC', crmSyncError: error } });
      await this.record(tenantId, caseId, lead, 'lead.sync_failed', { reason: 'POLICY', error, trigger }, `lead.sync_failed:${lead.id}:policy`);
      return { state: 'OUT_OF_SYNC', written: false, leadId: lead.id, error };
    }

    const name = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
    const noteAt = (lead.notes ?? '').indexOf(HANDOFF_NOTE_MARKER);
    const note = noteAt >= 0 ? (lead.notes ?? '').slice(noteAt + HANDOFF_NOTE_MARKER.length).trim() : undefined;
    const composed = await this.composer.compose(tenantId, caseId, { name, email: lead.contact.email ?? '' }, note);
    const hash = leadContentHash(composed.title, composed.text);
    if (lead.crmSyncState === 'SYNCED' && lead.crmSyncedHash === hash) return { state: 'SYNCED', written: false, leadId: lead.id };

    // Gleichzeitige Abgleiche desselben Leads schließen sich aus (Sperrvermerk mit Ablauf).
    const now = new Date();
    const claimed = await scoped.lead.updateMany({ where: { id: lead.id, OR: [{ crmSyncLockedUntil: null }, { crmSyncLockedUntil: { lt: now } }] }, data: { crmSyncLockedUntil: new Date(now.getTime() + LOCK_MS) } });
    if (claimed.count === 0) return { state: 'BUSY', written: false, leadId: lead.id };

    try {
      const remote = await this.crm.readLead({ tenantId, externalId: lead.crmExternalId });
      if (!remote) throw new Error('Der Lead wurde im CRM nicht mehr gefunden.');
      const alreadyApplied = squash(remote.notes) === squash(composed.text) && (remote.title ?? '') === composed.title;
      if (!alreadyApplied) {
        const editedByHand = (lead.crmSyncedText !== null && squash(remote.notes) !== squash(lead.crmSyncedText)) || (lead.crmSyncedTitle !== null && (remote.title ?? '') !== lead.crmSyncedTitle);
        if (editedByHand) {
          const error = 'Der Lead wurde im CRM von Hand geändert; ORBIT überschreibt das nicht. Bitte den Stand im CRM prüfen und abgleichen.';
          await scoped.lead.update({ where: { id: lead.id }, data: { crmSyncState: 'CONFLICT', crmSyncError: error, crmSyncLockedUntil: null } });
          await this.record(tenantId, caseId, lead, 'lead.sync_conflict', { error, expectedHash: lead.crmSyncedHash, wantedHash: hash, trigger }, `lead.sync_conflict:${lead.id}:${hash}`);
          return { state: 'CONFLICT', written: false, leadId: lead.id, error };
        }
        await this.crm.updateLead({ tenantId, externalId: lead.crmExternalId, title: composed.title, notes: composed.text });
      }
      // Rücklesen: erst der aus dem CRM gelesene Stand belegt die Aktualisierung.
      const readBack = alreadyApplied ? remote : await this.crm.readLead({ tenantId, externalId: lead.crmExternalId });
      if (!readBack || squash(readBack.notes) !== squash(composed.text) || (readBack.title ?? '') !== composed.title) {
        throw new Error('Beim Rücklesen entspricht der Lead im CRM nicht dem geschriebenen Stand.');
      }
      await scoped.lead.update({
        where: { id: lead.id },
        data: { notes: composed.text, crmSyncState: 'SYNCED', crmSyncedHash: hash, crmSyncedTitle: composed.title, crmSyncedText: crmFieldText(readBack.notes ?? composed.text), crmSyncedAt: new Date(), crmSyncError: null, crmSyncLockedUntil: null },
      });
      // Die Folgeaufgabe für den Vertrieb trägt denselben aktuellen Stand wie der Lead.
      await scoped.task.updateMany({ where: { caseId, title: { startsWith: 'Neuen Lead kontaktieren' }, status: { notIn: ['DONE', 'CANCELLED'] } }, data: { description: composed.text } });
      await this.record(tenantId, caseId, lead, 'lead.synced', { hash, readBack: 'CONFIRMED', written: !alreadyApplied, known: composed.summary.known.length, open: composed.summary.open.length, trigger }, `lead.synced:${lead.id}:${hash}`);
      return { state: 'SYNCED', written: !alreadyApplied, leadId: lead.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`lead sync of case ${caseId} failed: ${message}`);
      await scoped.lead.update({ where: { id: lead.id }, data: { crmSyncState: 'FAILED', crmSyncError: message.slice(0, 500), crmSyncLockedUntil: null } });
      await this.record(tenantId, caseId, lead, 'lead.sync_failed', { error: message.slice(0, 300), trigger }, `lead.sync_failed:${lead.id}:${hash}:${Math.floor(Date.now() / 300_000)}`);
      return { state: 'FAILED', written: false, leadId: lead.id, error: message };
    }
  }

  private async record(tenantId: string, caseId: string, lead: Lead, type: string, payload: Record<string, unknown>, dedupeKey: string): Promise<void> {
    await this.events.append(tenantId, caseId, { type, payload: { leadId: lead.id, crmExternalId: lead.crmExternalId, ...payload }, dedupeKey }).catch(() => undefined);
    await this.audit.record({ tenantId, eventType: type === 'lead.synced' ? 'LEAD_CRM_SYNCED' : type === 'lead.sync_conflict' ? 'LEAD_CRM_SYNC_CONFLICT' : 'LEAD_CRM_SYNC_FAILED', actorType: 'AGENT', entityType: 'Lead', entityId: lead.id, payload: { caseId, crmExternalId: lead.crmExternalId, ...payload } }).catch(() => undefined);
  }

  /**
   * Der Abschlussmaßstab (Meilenstein B), unabhängig vom Bearbeitungsweg: ein Vorgang gilt nicht als erledigt, solange eine angekündigte Korrektur ungeklärt ist oder der Lead nicht auf dem Stand der Falldaten steht.
   * Liefert den Grund, der den Abschluss verhindert, sonst `undefined`.
   */
  async completionBlocker(tenantId: string, caseId: string): Promise<string | undefined> {
    const open = await this.facts.openCorrectionNotes(tenantId, caseId);
    if (open.length > 0) return `Eine angekündigte Korrektur ist noch nicht geklärt („${String(open[0]!.value).slice(0, 120)}“).`;
    const outcome = await this.syncCase(tenantId, caseId, { reason: 'COMPLETION' });
    if (outcome.state === 'NONE' || outcome.state === 'SYNCED') return undefined;
    if (outcome.state === 'BUSY') return `${LEAD_SYNC_REASON_PREFIX}: läuft gerade, wird erneut geprüft.`;
    return `${LEAD_SYNC_REASON_PREFIX}: ${outcome.error ?? 'Der Lead im CRM entspricht nicht dem Stand der Falldaten.'}`;
  }

  /**
   * Überträgt das Ergebnis eines Abgleichs auf den Vorgang: ein abgeschlossener Vorgang, dessen Lead nicht auf dem Stand ist, wird sichtbar wieder offen (Prüfung durch eine Person);
   * ist der Abgleich später gelungen und nichts anderes offen, schließt er wieder – mit demselben Nachweis wie zuvor.
   */
  async reflectOnCase(tenantId: string, caseId: string, outcome: LeadSyncOutcome): Promise<void> {
    const row = await this.prisma.forTenantId(tenantId).case.findUnique({ where: { id: caseId } });
    if (!row) return;
    if (['FAILED', 'CONFLICT', 'OUT_OF_SYNC'].includes(outcome.state)) {
      if (row.orchestrationStatus === 'COMPLETED' || row.orchestrationStatus === 'MANUAL_REVIEW') {
        const reason = `${LEAD_SYNC_REASON_PREFIX}: ${outcome.error ?? 'Der Lead im CRM entspricht nicht dem Stand der Falldaten.'}`.slice(0, 300);
        const others = row.attentionReasons.filter((r) => !r.startsWith(LEAD_SYNC_REASON_PREFIX));
        await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: [...others, reason].slice(-5) });
      }
      return;
    }
    if (outcome.state === 'SYNCED' && row.orchestrationStatus === 'MANUAL_REVIEW' && row.attentionReasons.length > 0 && row.attentionReasons.every((r) => r.startsWith(LEAD_SYNC_REASON_PREFIX))) {
      if ((await this.facts.openCorrectionNotes(tenantId, caseId)).length > 0) return;
      const previous = row.outcome as { code?: string; evidenceRefs?: string[] } | null;
      await this.lifecycle.transition(tenantId, caseId, { to: 'COMPLETED', outcome: { code: previous?.code ?? 'COMPLETION_CRITERIA_MET', evidenceRefs: previous?.evidenceRefs ?? [] } });
    }
  }

  /** Wiederholt offene Abgleiche (Ausfall des CRM, Berechtigung inzwischen erteilt); ein Konflikt wird nie automatisch aufgelöst. */
  async retryOpen(now = new Date()): Promise<{ retried: number; synced: number; cases: Array<{ tenantId: string; caseId: string }> }> {
    const open = await this.prisma.withRlsBypass((tx) => tx.lead.findMany({ where: { crmSyncState: { in: ['FAILED', 'OUT_OF_SYNC'] }, caseId: { not: null }, updatedAt: { lt: new Date(now.getTime() - 120_000) } }, select: { tenantId: true, caseId: true }, take: 20 }));
    let synced = 0;
    const cases: Array<{ tenantId: string; caseId: string }> = [];
    for (const { tenantId, caseId } of open) {
      if (!caseId) continue;
      try {
        const outcome = await this.syncCase(tenantId, caseId, { reason: 'RETRY' });
        await this.reflectOnCase(tenantId, caseId, outcome);
        if (outcome.state === 'SYNCED') {
          synced += 1;
          cases.push({ tenantId, caseId });
        }
      } catch (error) {
        this.logger.warn(`lead sync retry for case ${caseId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { retried: open.length, synced, cases };
  }
}
