import { Injectable } from '@nestjs/common';
import { TERMINAL_CASE_STATUSES, type CaseOrchestrationStatusValue } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface CorrelationInput {
  tenantId: string;
  emailMessageId: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  senderAddress?: string;
  /** The model's reading of the conversation — a suggestion only, never a basis for merging (§5.2). */
  semanticRelation?: 'NEW' | 'CONTINUATION' | 'UNCERTAIN';
}

export interface CorrelationResult {
  status: 'MATCHED' | 'AMBIGUOUS' | 'NONE';
  caseId?: string;
  rule: string;
  candidateCaseIds: string[];
  note?: string;
}

const normalize = (address: string | undefined): string | undefined => address?.trim().toLowerCase() || undefined;

/**
 * Amendment 02 §13.1 — decides which existing Case an inbound message belongs
 * to, by strong references in this priority order:
 *
 * 1. an already stored assignment for this very message (idempotent re-run),
 * 2. `In-Reply-To` / `References` pointing at a stored ORBIT outbound message that has a case,
 * 3. the provider thread id together with an open case and a known participant,
 * 4. (external business references — not built yet, documented),
 * 5. a semantic suggestion — only ever as a *review* hint, never an automatic merge.
 *
 * Subject or sender address alone never merge anything: one sender can have
 * two open cases (E15) and a changed subject / forwarded mail without a strong
 * reference goes to review (E16). A reply from someone who is not yet a
 * participant of the case is not merged either: it would expose the case's
 * facts to a new party (§13.1). Everything is bounded by the tenant first.
 */
@Injectable()
export class CaseCorrelationService {
  constructor(private readonly prisma: PrismaService) {}

  async correlate(input: CorrelationInput): Promise<CorrelationResult> {
    const scoped = this.prisma.forTenantId(input.tenantId);

    const stored = await scoped.caseCorrelation.findUnique({ where: { emailMessageId: input.emailMessageId } });
    if (stored) {
      return { status: stored.status === 'OVERRIDDEN' ? 'MATCHED' : (stored.status as 'MATCHED' | 'AMBIGUOUS' | 'NONE'), caseId: stored.caseId ?? undefined, rule: stored.rule, candidateCaseIds: stored.candidateCaseIds, note: stored.note ?? undefined };
    }

    const result = await this.evaluate(input);
    await scoped.caseCorrelation.create({
      data: {
        tenantId: input.tenantId,
        emailMessageId: input.emailMessageId,
        caseId: result.caseId,
        status: result.status,
        rule: result.rule,
        candidateCaseIds: result.candidateCaseIds,
        note: result.note,
      },
    });
    return result;
  }

  private async evaluate(input: CorrelationInput): Promise<CorrelationResult> {
    const scoped = this.prisma.forTenantId(input.tenantId);
    const sender = normalize(input.senderAddress);

    // Rule 2 — reply to a message ORBIT itself sent in a case.
    const referenced = [input.inReplyTo, ...(input.references ?? [])].filter((id): id is string => Boolean(id));
    if (referenced.length > 0) {
      const outbound = await scoped.emailMessage.findMany({
        where: { direction: 'OUTBOUND', rfcMessageId: { in: referenced }, caseId: { not: null } },
        select: { caseId: true },
      });
      const cases = [...new Set(outbound.map((m) => m.caseId as string))];
      if (cases.length > 0) {
        return this.decide(input, cases, input.inReplyTo && outbound.length > 0 ? 'IN_REPLY_TO' : 'REFERENCES', sender);
      }
    }

    // Rule 3 — same provider thread, an open case, and a known participant.
    if (input.threadId) {
      const inThread = await scoped.emailMessage.findMany({
        where: { threadId: input.threadId, caseId: { not: null }, id: { not: input.emailMessageId } },
        select: { caseId: true },
      });
      const caseIds = [...new Set(inThread.map((m) => m.caseId as string))];
      const open = await this.filterOpen(input.tenantId, caseIds);
      if (open.length > 0) return this.decide(input, open, 'PROVIDER_THREAD', sender);
    }

    // Rule 5 — only a suggestion: needs a person.
    if (input.semanticRelation === 'CONTINUATION') {
      const candidates = sender ? await this.openCasesOfParticipant(input.tenantId, sender) : [];
      return {
        status: candidates.length > 0 ? 'AMBIGUOUS' : 'NONE',
        rule: 'SEMANTIC_SUGGESTION',
        candidateCaseIds: candidates,
        note: 'Die KI sieht eine Fortsetzung, es gibt aber keine starke Referenz (Thread, Antwort-Header). Eine Zuordnung braucht eine menschliche Entscheidung.',
      };
    }

    return { status: 'NONE', rule: 'NONE', candidateCaseIds: [] };
  }

  /** Applies the participant check shared by the strong rules and returns the final verdict. */
  private async decide(input: CorrelationInput, caseIds: string[], rule: string, sender: string | undefined): Promise<CorrelationResult> {
    if (caseIds.length > 1) {
      return { status: 'AMBIGUOUS', rule, candidateCaseIds: caseIds, note: 'Mehrere Cases passen zur Referenz; keine automatische Zuordnung.' };
    }
    const caseId = caseIds[0] as string;
    if (!sender || !(await this.isParticipant(input.tenantId, caseId, sender))) {
      return {
        status: 'AMBIGUOUS',
        rule,
        candidateCaseIds: caseIds,
        note: 'Der Absender ist noch kein Teilnehmer dieses Cases; zum Schutz der Fall-Daten keine automatische Zuordnung.',
      };
    }
    return { status: 'MATCHED', caseId, rule, candidateCaseIds: caseIds };
  }

  private async filterOpen(tenantId: string, caseIds: string[]): Promise<string[]> {
    if (caseIds.length === 0) return [];
    const cases = await this.prisma.forTenantId(tenantId).case.findMany({ where: { id: { in: caseIds } }, select: { id: true, orchestrationStatus: true } });
    return cases.filter((c) => !TERMINAL_CASE_STATUSES.has(c.orchestrationStatus as CaseOrchestrationStatusValue)).map((c) => c.id);
  }

  private async participantsOf(tenantId: string, caseId: string): Promise<Set<string>> {
    const messages = await this.prisma.forTenantId(tenantId).emailMessage.findMany({ where: { caseId }, select: { fromAddress: true, toAddresses: true } });
    const participants = new Set<string>();
    for (const message of messages) {
      for (const address of [message.fromAddress, ...message.toAddresses]) {
        const normalized = normalize(address);
        if (normalized) participants.add(normalized);
      }
    }
    return participants;
  }

  private async isParticipant(tenantId: string, caseId: string, address: string): Promise<boolean> {
    return (await this.participantsOf(tenantId, caseId)).has(address);
  }

  private async openCasesOfParticipant(tenantId: string, address: string): Promise<string[]> {
    const messages = await this.prisma.forTenantId(tenantId).emailMessage.findMany({
      where: { caseId: { not: null }, OR: [{ fromAddress: { equals: address, mode: 'insensitive' } }, { toAddresses: { has: address } }] },
      select: { caseId: true },
    });
    return this.filterOpen(tenantId, [...new Set(messages.map((m) => m.caseId as string))]);
  }
}
