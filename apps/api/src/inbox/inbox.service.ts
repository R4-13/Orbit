import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import type { OrbitEnv } from '@orbit/config';
import {
  CASE_ORCHESTRATION_LABELS,
  NotFoundError,
  categoryLabel,
  humanizeKnownKeys,
  intakeStatusLabel,
  internalHref,
  relevanceLabel,
  type CaseOrchestrationStatusValue,
  type InboxDetail,
  type InboxFactView,
  type InboxFilter,
  type InboxListItem,
  type InboxListResponse,
  type InboxStage, type InboxSortKey, type ListSortDirection } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { showExcludedIntakeByDefault } from '../intake/intake-visibility';
import { PrismaService } from '../prisma/prisma.service';

const EXCLUDED_RELEVANCE = ['NON_ACTIONABLE', 'PRIVATE_PERSONAL'] as const;
const ATTENTION_CASE_STATES = ['MANUAL_REVIEW', 'WAITING_FOR_APPROVAL', 'FAILED'] as const;
const PROGRESS_CASE_STATES = ['READY', 'IN_PROGRESS', 'WAITING_FOR_INFORMATION', 'WAITING_FOR_EXTERNAL_SYSTEM', 'PAUSED'] as const;
const DONE_CASE_STATES = ['COMPLETED', 'REJECTED', 'CANCELLED'] as const;

const AGENT_LABELS: Record<string, string> = { FINANCE: 'Finanz-Assistent', SALES: 'Vertriebs-Assistent' };

export const INBOX_PAGE_SIZE = 25;

const FACT_SOURCE_LABELS: Record<string, string> = {
  EMAIL: 'E-Mail',
  ATTACHMENT: 'Anhang',
  SYSTEM_OF_RECORD: 'Bestandssystem',
  CONFIGURATION: 'Einstellung',
  HUMAN: 'Eingabe',
};

type EventRow = Prisma.IntakeEventGetPayload<{ include: { case: true; decision: true } }>;

/** Menschenlesbarer Faktenname aus dem Registry-Schlüssel („request.product_sku“ → „Product sku“). Echte Titel liefert später die Blueprint-Definition. */
function humanizeKey(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('amount' in record && 'currency' in record) return `${String(record.amount)} ${String(record.currency)}`;
    if ('value' in record) return valueToText(record.value);
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * UI v2 §11 — der Posteingang als nachvollziehbare Arbeit: je Eingang Quelle, Absender + Betreff, fachlicher Typ,
 * Status/nächster Schritt und die Orchestrierung. Lese-Projektion über `IntakeEvent` + `Case` + `IntakeDecision`; sie erzeugt
 * keinen zweiten Zustand. Sicher ausgefilterte Eingänge sind im Produktivbetrieb standardmäßig verborgen.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  private whereFor(filter: InboxFilter, includeExcluded: boolean, search?: string): Prisma.IntakeEventWhereInput {
    const and: Prisma.IntakeEventWhereInput[] = [];
    if (!includeExcluded) {
      // NULL-sicher: `NOT (relevance IN (...))` wäre für noch nicht eingestufte Eingänge (relevance = NULL) unbekannt und würde sie verbergen.
      and.push({ OR: [{ relevance: null }, { relevance: { notIn: [...EXCLUDED_RELEVANCE] } }] }, { status: { not: 'SKIPPED_NON_ACTIONABLE' } });
    }
    switch (filter) {
      case 'ATTENTION':
        and.push({ OR: [{ status: { in: ['NEEDS_REVIEW', 'FAILED'] } }, { case: { is: { orchestrationStatus: { in: [...ATTENTION_CASE_STATES] } } } }] });
        break;
      case 'NEW':
        and.push({ status: { in: ['RECEIVED', 'PENDING_TRIAGE', 'TRIAGED'] }, case: { is: null } });
        break;
      case 'IN_PROGRESS':
        and.push({
          NOT: { status: { in: ['NEEDS_REVIEW', 'FAILED'] } },
          OR: [{ status: { in: ['ROUTED', 'PROCESSING'] }, case: { is: null } }, { case: { is: { orchestrationStatus: { in: [...PROGRESS_CASE_STATES, 'RECEIVED'] } } } }],
        });
        break;
      case 'DONE':
        and.push({ OR: [{ status: { in: ['COMPLETED', 'SKIPPED_NON_ACTIONABLE'] }, case: { is: null } }, { case: { is: { orchestrationStatus: { in: [...DONE_CASE_STATES] } } } }] });
        break;
      case 'FINANCE':
        and.push({ domainCategory: 'FINANCE' });
        break;
      case 'SALES':
        and.push({ domainCategory: 'SALES' });
        break;
      default:
        break;
    }
    const q = search?.trim();
    if (q && q.length >= 2) {
      and.push({ OR: [{ subject: { contains: q, mode: 'insensitive' } }, { case: { is: { title: { contains: q, mode: 'insensitive' } } } }] });
    }
    return and.length > 0 ? { AND: and } : {};
  }

  async list(tenantId: string, input: { filter: InboxFilter; page: number; search?: string; includeExcluded?: boolean; sort?: InboxSortKey; dir?: ListSortDirection }, now: Date = new Date()): Promise<InboxListResponse> {
    const db = this.prisma.forTenantId(tenantId);
    const includeExcluded = input.includeExcluded ?? showExcludedIntakeByDefault(this.env);
    const page = Math.max(1, input.page);
    const where = this.whereFor(input.filter, includeExcluded, input.search);

    const filters: InboxFilter[] = ['ALL', 'ATTENTION', 'NEW', 'IN_PROGRESS', 'DONE', 'FINANCE', 'SALES'];
    const [rows, total, ...counts] = await Promise.all([
      db.intakeEvent.findMany({ where, orderBy: [{ [input.sort ?? 'occurredAt']: input.dir ?? 'desc' }, { id: 'asc' }], skip: (page - 1) * INBOX_PAGE_SIZE, take: INBOX_PAGE_SIZE, include: { case: true, decision: true } }),
      db.intakeEvent.count({ where }),
      ...filters.map((filter) => db.intakeEvent.count({ where: this.whereFor(filter, includeExcluded, input.search) })),
    ]);

    return {
      items: rows.map((row) => this.toItem(row)),
      total,
      page,
      pageSize: INBOX_PAGE_SIZE,
      counts: Object.fromEntries(filters.map((filter, index) => [filter, counts[index] ?? 0])) as InboxListResponse['counts'],
      generatedAt: now.toISOString(),
      excludedHidden: !includeExcluded,
    };
  }

  async findOne(tenantId: string, id: string): Promise<InboxDetail> {
    const db = this.prisma.forTenantId(tenantId);
    const row = await db.intakeEvent.findUnique({ where: { id }, include: { case: true, decision: true } });
    if (!row) throw new NotFoundError('Inbox item not found.', { id });
    const item = this.toItem(row);

    const email = row.emailMessageId ? await db.emailMessage.findUnique({ where: { id: row.emailMessageId } }) : null;
    const documents = row.documentIds.length > 0 ? await db.document.findMany({ where: { id: { in: row.documentIds } } }) : [];
    const factRows = row.caseId ? await db.caseFact.findMany({ where: { caseId: row.caseId, isCurrent: true }, orderBy: { key: 'asc' } }) : [];

    const facts: InboxFactView[] = factRows
      .filter((fact) => fact.status !== 'REJECTED')
      .map((fact) => ({
        key: fact.key,
        label: humanizeKey(fact.key),
        valueText: `${valueToText(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`,
        confirmed: fact.status === 'CONFIRMED',
        sourceLabel: FACT_SOURCE_LABELS[fact.sourceType] ?? 'Quelle',
        evidence: fact.confidence !== null && fact.confidence !== undefined ? `Sicherheit ${Math.round(fact.confidence * 100)} %` : undefined,
      }));

    const result = (row.decision?.result ?? null) as { conciseReason?: string } | null;
    return {
      ...item,
      bodyPreview: email?.bodyText?.slice(0, 2000) ?? email?.bodyPreview ?? undefined,
      recipients: email?.toAddresses ?? [],
      attachments: documents.map((doc) => ({ id: doc.id, name: doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes })),
      reason: humanizeKnownKeys(result?.conciseReason ?? row.decision?.failureReason ?? '') || undefined,
      facts,
      actionStatement: item.excluded || !row.case ? 'Aktion: Keine – es wurde kein Geschäftsprozess ausgelöst.' : undefined,
    };
  }

  private toItem(row: EventRow): InboxListItem {
    const sender = (row.senderRef ?? {}) as { address?: string; displayName?: string };
    const linkedCase = row.case;
    const caseStatus = linkedCase?.orchestrationStatus as CaseOrchestrationStatusValue | undefined;
    const excluded = (row.relevance !== null && (EXCLUDED_RELEVANCE as readonly string[]).includes(row.relevance)) || row.status === 'SKIPPED_NON_ACTIONABLE';
    const hasProcess = Boolean(linkedCase && (linkedCase.blueprintKey || linkedCase.orchestrationStatus !== 'RECEIVED'));

    let stage: InboxStage = 'IN_PROGRESS';
    if (row.status === 'NEEDS_REVIEW' || row.status === 'FAILED' || (caseStatus && (ATTENTION_CASE_STATES as readonly string[]).includes(caseStatus))) stage = 'ATTENTION';
    else if (caseStatus && (DONE_CASE_STATES as readonly string[]).includes(caseStatus)) stage = 'DONE';
    else if (!linkedCase && (row.status === 'COMPLETED' || row.status === 'SKIPPED_NON_ACTIONABLE')) stage = 'DONE';
    else if (!linkedCase && (row.status === 'RECEIVED' || row.status === 'PENDING_TRIAGE' || row.status === 'TRIAGED')) stage = 'NEW';

    const execution = (row.decision?.execution ?? null) as { mode?: string } | null;
    const category = row.decision ? ((row.decision.result ?? null) as { category?: string } | null)?.category : undefined;
    const emailCategory = category ?? row.domainCategory ?? undefined;
    const confidenceRaw = (row.decision?.result ?? null) as { confidence?: { relevance?: number } } | null;

    return {
      id: row.id,
      emailMessageId: row.emailMessageId ?? undefined,
      source: 'EMAIL',
      senderLabel: sender.displayName?.trim() || sender.address || 'Unbekannter Absender',
      senderAddress: sender.address,
      subject: row.subject?.trim() || 'Ohne Betreff',
      occurredAt: row.occurredAt.toISOString(),
      typeLabel: categoryLabel(emailCategory),
      categoryKey: emailCategory,
      domain: row.domainCategory === 'FINANCE' || row.domainCategory === 'SALES' ? row.domainCategory : null,
      stage,
      statusLabel: linkedCase && hasProcess && caseStatus ? (CASE_ORCHESTRATION_LABELS[caseStatus] ?? intakeStatusLabel(row.status)) : intakeStatusLabel(row.status),
      nextActionLabel: this.nextAction(stage, Boolean(linkedCase), hasProcess, caseStatus, excluded),
      needsAttention: stage === 'ATTENTION',
      excluded,
      caseRef: linkedCase ? { type: 'CASE', id: linkedCase.id, label: linkedCase.title, href: internalHref('CASE', linkedCase.id) } : undefined,
      hasProcess,
      details: {
        agentLabel: row.domainCategory ? AGENT_LABELS[row.domainCategory] : undefined,
        relevanceLabel: row.relevance ? relevanceLabel(row.relevance) : undefined,
        confidence: confidenceRaw?.confidence?.relevance,
        executionMode: execution?.mode === 'LIVE' ? 'LIVE' : execution?.mode ? 'SIMULATED' : undefined,
      },
    };
  }

  private nextAction(stage: InboxStage, hasCase: boolean, hasProcess: boolean, status: CaseOrchestrationStatusValue | undefined, excluded: boolean): string {
    if (excluded) return 'Keine Aktion nötig';
    if (!hasCase) return stage === 'NEW' ? 'Wird geprüft' : stage === 'DONE' ? 'Keine Aktion nötig' : 'Entscheidung ansehen';
    switch (status) {
      case 'WAITING_FOR_APPROVAL':
        return 'Freigabe prüfen';
      case 'WAITING_FOR_INFORMATION':
        return 'Auf Antwort warten';
      case 'MANUAL_REVIEW':
        return 'Prüfen und entscheiden';
      case 'FAILED':
        return 'Fehler ansehen';
      case 'COMPLETED':
        return 'Ergebnis ansehen';
      default:
        return hasProcess ? 'Fortschritt ansehen' : 'Vorgang ansehen';
    }
  }
}
