import { Injectable } from '@nestjs/common';
import type { CaseFact, Prisma } from '@orbit/domain';
import {
  NotFoundError,
  ValidationFailedError,
  factValuesEqual,
  validateFactValue,
  type CaseFactSourceTypeValue,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { messageCaseIds } from './case-scope';

export interface FactInput {
  key: string;
  value: unknown;
  /** Requirement type (`email`, `money`, …) used for schema validation when confirming. */
  valueType?: string;
  valueSchemaRef?: string;
  unit?: string;
  currency?: string;
  sourceType: CaseFactSourceTypeValue;
  sourceRef?: string;
  evidenceRefs?: string[];
  observedAt?: Date;
  validAsOf?: Date;
  expiresAt?: Date;
  confidence?: number;
  sensitivity?: string;
  retentionClass?: string;
}

/**
 * Amendment 02 §7.2 — case facts with provenance and an append-only history.
 *
 * - A proposal never overwrites: an equal value is a no-op, a different value
 *   next to a standing one makes BOTH `CONFLICTED` (visible, needs a human) —
 *   there is no "last mail wins".
 * - Only schema validation or a human can make a candidate `CONFIRMED`;
 *   an extraction confidence is never a verification.
 * - A human value supersedes every current row for the key (that is also how a
 *   conflict is resolved); the old rows stay as history (`isCurrent=false`).
 * - Every change bumps `Case.revision`, so commands and events that carry an
 *   expected revision detect stale views (§12.3).
 */
/**
 * Dieselbe Aussage in anderen Worten ist kein Widerspruch: Der kürzere Text steht als zusammenhängende Wortfolge im längeren („8 m²“ und „8 m², nicht 7“; „ca. 7 m²“ und „7 m²“ nicht – dort fehlt „ca.“, aber
 * „7 m²“ steht in „ca. 7 m²“). Verglichen wird Wort für Wort (Zahlen ganz: „7“ ist nicht in „17“ enthalten); nur Texte, keine Zahlen.
 */
export function isRestatement(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const tokens = (text: string): string[] => text.toLowerCase().replace(/[.,;:!?"„“]+/g, ' ').split(/\s+/).filter((t) => t.length > 0);
  const [short, long] = tokens(a).length <= tokens(b).length ? [tokens(a), tokens(b)] : [tokens(b), tokens(a)];
  if (short.length === 0 || short.length === long.length && short.every((t, i) => t === long[i])) return short.length > 0;
  // Nennt der längere Text eine weitere Zahl, die nicht verneint ist („8 m², nicht 7“), ist es eine andere Angabe („nicht 7 m², sondern 12“), kein Umschreiben.
  const extraNumber = long.some((token, index) => /\d/.test(token) && !short.includes(token) && long[index - 1] !== 'nicht');
  if (extraNumber) return false;
  for (let start = 0; start + short.length <= long.length; start += 1) {
    if (short.every((token, offset) => long[start + offset] === token)) return true;
  }
  return false;
}

@Injectable()
export class CaseFactsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(tenantId: string, caseId: string): Promise<CaseFact[]> {
    return this.prisma.forTenantId(tenantId).caseFact.findMany({
      where: { caseId, isCurrent: true },
      orderBy: [{ key: 'asc' }, { revision: 'asc' }],
    });
  }

  /**
   * Angekündigte Korrekturen, die keiner Angabe zugeordnet werden konnten (Hinweis-Fakten `korrekturhinweis.ergaenzung.*`) und noch nicht geklärt sind. Ein sichtbarer Hinweis ist noch keine
   * verarbeitete Korrektur: bis zur Klärung laufen davon abhängige Wirkungen nicht mit dem alten Wert weiter. Geklärt ist ein Hinweis, sobald die Kundschaft nach einer Klärungsfrage (Rückfrage nach
   * dem Hinweis) geantwortet hat – die Antwort prüft der Korrekturdienst wie jede Nachricht – oder eine Person den Hinweis verworfen hat.
   */
  async openCorrectionNotes(tenantId: string, caseId: string): Promise<CaseFact[]> {
    const notes = (await this.getCurrent(tenantId, caseId)).filter((f) => f.key.startsWith('korrekturhinweis.ergaenzung.') && f.status !== 'REJECTED');
    if (notes.length === 0) return [];
    const scoped = this.prisma.forTenantId(tenantId);
    const family = await messageCaseIds(this.prisma, tenantId, caseId);
    const open: CaseFact[] = [];
    for (const note of notes) {
      const asked = await scoped.actionIntent.findFirst({ where: { caseId, capabilityKey: 'email.send', purpose: 'CLARIFICATION', status: 'CONFIRMED', createdAt: { gt: note.createdAt } }, orderBy: { createdAt: 'asc' } });
      const answered = asked ? (await scoped.emailMessage.count({ where: { caseId: { in: family }, direction: 'INBOUND', createdAt: { gt: asked.createdAt } } })) > 0 : false;
      if (!answered) open.push(note);
    }
    return open;
  }

  async getHistory(tenantId: string, caseId: string, key: string): Promise<CaseFact[]> {
    return this.prisma.forTenantId(tenantId).caseFact.findMany({ where: { caseId, key }, orderBy: { revision: 'asc' } });
  }

  /** Records extraction/system proposals. Returns the rows that were created or conflicted by this call. */
  async propose(tenantId: string, caseId: string, inputs: FactInput[]): Promise<CaseFact[]> {
    const touched: CaseFact[] = [];
    let changed = false;
    for (const input of inputs) {
      const outcome = await this.proposeOne(tenantId, caseId, input);
      touched.push(...outcome);
      if (outcome.length > 0) changed = true;
    }
    if (changed) await this.bumpRevision(tenantId, caseId);
    return touched;
  }

  private async proposeOne(tenantId: string, caseId: string, input: FactInput): Promise<CaseFact[]> {
    const scoped = this.prisma.forTenantId(tenantId);
    const current = await scoped.caseFact.findMany({ where: { caseId, key: input.key, isCurrent: true } });

    // Same value already standing (or the same assertion in other words): nothing to record.
    if (current.some((fact) => factValuesEqual(fact.value, input.value) || isRestatement(fact.value, input.value))) return [];

    const nextRevision = (current.reduce((max, fact) => Math.max(max, fact.revision), 0) || 0) + 1;
    const hasStanding = current.length > 0;

    if (hasStanding) {
      // Disagreement: surface it, do not pick a winner.
      await scoped.caseFact.updateMany({
        where: { caseId, key: input.key, isCurrent: true, status: { in: ['CANDIDATE', 'CONFIRMED'] } },
        data: { status: 'CONFLICTED' },
      });
    }
    const created = await scoped.caseFact.create({
      data: this.toCreateData(tenantId, caseId, input, nextRevision, hasStanding ? 'CONFLICTED' : 'CANDIDATE'),
    });
    return [created];
  }

  /** Promotes a candidate after the declared value type validates; refuses (without changing anything) when it does not. */
  async confirmBySchema(tenantId: string, factId: string, valueType: string): Promise<CaseFact> {
    const fact = await this.requireFact(tenantId, factId);
    if (fact.status === 'CONFLICTED') {
      throw new ValidationFailedError('A conflicted fact cannot be confirmed by schema; a person has to resolve the conflict.', { factId });
    }
    const validation = validateFactValue(valueType, fact.value);
    if (!validation.valid) {
      throw new ValidationFailedError(`Value does not satisfy the "${valueType}" type: ${validation.reason}`, { factId, valueType });
    }
    const updated = await this.prisma.forTenantId(tenantId).caseFact.update({
      where: { id: factId },
      data: { status: 'CONFIRMED', verifiedBy: 'schema' },
    });
    await this.bumpRevision(tenantId, fact.caseId);
    return updated;
  }

  /**
   * A value read from a system of record or from tenant configuration is trusted by origin, not by confidence. Emails,
   * attachments and model output never qualify — those stay candidates until schema validation or a person confirms them.
   */
  async confirmFromTrustedSource(tenantId: string, factId: string): Promise<CaseFact> {
    const fact = await this.requireFact(tenantId, factId);
    if (fact.sourceType !== "SYSTEM_OF_RECORD" && fact.sourceType !== "CONFIGURATION") {
      throw new ValidationFailedError("Only facts from a system of record or tenant configuration can be confirmed by origin.", { factId, sourceType: fact.sourceType });
    }
    if (fact.status !== "CANDIDATE") return fact;
    const updated = await this.prisma.forTenantId(tenantId).caseFact.update({ where: { id: factId }, data: { status: "CONFIRMED", verifiedBy: "system-of-record" } });
    await this.bumpRevision(tenantId, fact.caseId);
    return updated;
  }

  /**
   * The reply target is taken from the transport headers of the inbound message (From / Reply-To), never from text in the
   * body (a mail that says "send it to x@evil" must not redirect the answer). A header-sourced address that is a valid
   * e-mail value is confirmed; anything else stays a candidate.
   */
  async confirmReplyTargetFromHeader(tenantId: string, factId: string): Promise<CaseFact> {
    const fact = await this.requireFact(tenantId, factId);
    if (fact.sourceType !== "EMAIL" || !(fact.sourceRef ?? "").startsWith("header:")) {
      throw new ValidationFailedError("Only a value read from a message header can be confirmed as the reply target.", { factId });
    }
    const validation = validateFactValue("email", fact.value);
    if (!validation.valid) throw new ValidationFailedError(`Not a valid e-mail address: ${validation.reason}`, { factId });
    if (fact.status === "CONFLICTED") return fact;
    const updated = await this.prisma.forTenantId(tenantId).caseFact.update({ where: { id: factId }, data: { status: "CONFIRMED", verifiedBy: "provider-header" } });
    await this.bumpRevision(tenantId, fact.caseId);
    return updated;
  }

  /** A person states or corrects a value. Supersedes every current row for the key, which also resolves any conflict. */
  async setByHuman(tenantId: string, caseId: string, userId: string, input: Omit<FactInput, 'sourceType'>): Promise<CaseFact> {
    const validation = validateFactValue(input.valueType, input.value);
    if (!validation.valid) {
      throw new ValidationFailedError(`Value does not satisfy the "${input.valueType}" type: ${validation.reason}`, { key: input.key });
    }
    const scoped = this.prisma.forTenantId(tenantId);
    const current = await scoped.caseFact.findMany({ where: { caseId, key: input.key, isCurrent: true } });
    const latest = current.sort((a, b) => b.revision - a.revision)[0];
    const history = await scoped.caseFact.findFirst({ where: { caseId, key: input.key }, orderBy: { revision: 'desc' } });
    const nextRevision = (history?.revision ?? 0) + 1;

    if (current.length > 0) {
      await scoped.caseFact.updateMany({ where: { id: { in: current.map((f) => f.id) } }, data: { isCurrent: false } });
    }
    const created = await scoped.caseFact.create({
      data: {
        ...this.toCreateData(tenantId, caseId, { ...input, sourceType: 'HUMAN' }, nextRevision, 'CONFIRMED'),
        verifiedBy: userId,
        supersedesFactId: latest?.id,
      },
    });
    await this.bumpRevision(tenantId, caseId);
    return created;
  }

  /**
   * FX-20: The same person corrects their own earlier statement (eindeutige Selbstkorrektur). The new value supersedes every current row for the key — the old values stay as history
   * (`isCurrent=false`, linked by `supersedesFactId`) — and counts as confirmed because the declared value type validates and the caller verified a literal quote. The caller decides
   * *whether* it is an unambiguous self-correction; this method only records it. A conflict for the key is resolved the same way.
   */
  async supersedeBySelfCorrection(tenantId: string, caseId: string, input: FactInput & { valueType: string }): Promise<{ created: CaseFact; previous: CaseFact[] }> {
    const validation = validateFactValue(input.valueType, input.value);
    if (!validation.valid) {
      throw new ValidationFailedError(`Value does not satisfy the "${input.valueType}" type: ${validation.reason}`, { key: input.key });
    }
    const scoped = this.prisma.forTenantId(tenantId);
    const current = await scoped.caseFact.findMany({ where: { caseId, key: input.key, isCurrent: true } });
    const latest = [...current].sort((a, b) => b.revision - a.revision)[0];
    const history = await scoped.caseFact.findFirst({ where: { caseId, key: input.key }, orderBy: { revision: 'desc' } });
    if (current.length > 0) await scoped.caseFact.updateMany({ where: { id: { in: current.map((f) => f.id) } }, data: { isCurrent: false } });
    const created = await scoped.caseFact.create({
      data: { ...this.toCreateData(tenantId, caseId, input, (history?.revision ?? 0) + 1, 'CONFIRMED'), verifiedBy: 'schema+self-correction', supersedesFactId: latest?.id },
    });
    await this.bumpRevision(tenantId, caseId);
    return { created, previous: current };
  }

  /** Rejects a proposal: it stays as history but no longer counts. */
  async reject(tenantId: string, factId: string, userId: string): Promise<CaseFact> {
    const fact = await this.requireFact(tenantId, factId);
    const updated = await this.prisma.forTenantId(tenantId).caseFact.update({
      where: { id: factId },
      data: { status: 'REJECTED', isCurrent: false, verifiedBy: userId },
    });
    await this.bumpRevision(tenantId, fact.caseId);
    return updated;
  }

  /** Marks facts whose `expiresAt` has passed as STALE (§7.3: "ausreichend belegt, aktuell und gültig"). Returns how many changed. */
  async markExpiredStale(tenantId: string, caseId: string, now = new Date()): Promise<number> {
    const result = await this.prisma
      .forTenantId(tenantId)
      .caseFact.updateMany({ where: { caseId, isCurrent: true, status: { in: ['CANDIDATE', 'CONFIRMED'] }, expiresAt: { lt: now } }, data: { status: 'STALE' } });
    if (result.count > 0) await this.bumpRevision(tenantId, caseId);
    return result.count;
  }

  private async requireFact(tenantId: string, factId: string): Promise<CaseFact> {
    const fact = await this.prisma.forTenantId(tenantId).caseFact.findUnique({ where: { id: factId } });
    if (!fact) throw new NotFoundError('Fact not found.', { factId });
    return fact;
  }

  private async bumpRevision(tenantId: string, caseId: string): Promise<void> {
    await this.prisma.forTenantId(tenantId).case.update({ where: { id: caseId }, data: { revision: { increment: 1 } } });
  }

  private toCreateData(
    tenantId: string,
    caseId: string,
    input: FactInput,
    revision: number,
    status: 'CANDIDATE' | 'CONFIRMED' | 'CONFLICTED',
  ): Prisma.CaseFactUncheckedCreateInput {
    return {
      tenantId,
      caseId,
      key: input.key,
      value: input.value as Prisma.InputJsonValue,
      valueSchemaRef: input.valueSchemaRef,
      unit: input.unit,
      currency: input.currency,
      status,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      evidenceRefs: input.evidenceRefs ?? [],
      observedAt: input.observedAt ?? new Date(),
      validAsOf: input.validAsOf,
      expiresAt: input.expiresAt,
      confidence: input.confidence,
      revision,
      sensitivity: input.sensitivity,
      retentionClass: input.retentionClass,
    };
  }
}
