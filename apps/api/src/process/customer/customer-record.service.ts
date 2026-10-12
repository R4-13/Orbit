import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CustomerDirectory, CustomerLookupOutcome, CustomerMatch } from '@orbit/integration-core';
import { ContactsService } from '../../contacts/contacts.service';
import { PolicyEnforcementService } from '../../policy/policy-enforcement.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TasksService } from '../../tasks/tasks.service';
import { CASE_EVENT_TYPES, CaseEventsService } from '../case-events.service';
import { CUSTOMER_DIRECTORIES, OrbitContactsDirectory } from './customer-directory';

/** Abstände zwischen den Wiederholungsprüfungen: anfangs dicht, später seltener (ORBIT wartet nicht auf eine Antwort, belastet das System aber auch nicht). */
export const RECHECK_DELAYS_MS = [10, 30, 60, 120].map((m) => m * 60_000);
export const recheckDelayMs = (checks: number): number => RECHECK_DELAYS_MS[Math.min(Math.max(checks, 1), RECHECK_DELAYS_MS.length) - 1] as number;
/** Vorgänge, die so lange nicht angefasst wurden, werden nicht mehr nachgeprüft. */
const MAX_AGE_MS = 14 * 24 * 3_600_000;
const BATCH = 100;

export interface SystemAnswer {
  systemKey: string;
  label: string;
  outcome: CustomerLookupOutcome;
  matches: CustomerMatch[];
  reason?: string;
}

export interface CustomerCheck {
  /** Gesamtergebnis über alle Verzeichnisse: FOUND, wenn irgendeines den Kunden kennt; UNAVAILABLE, wenn keines ihn kennt, aber eines nicht antworten konnte; sonst NOT_FOUND. */
  outcome: CustomerLookupOutcome;
  systems: SystemAnswer[];
  match?: CustomerMatch & { systemKey: string };
}

export interface CustomerRecordState {
  status: CustomerLookupOutcome;
  system: string | null;
  origin: string | null;
  reason: string | null;
}

/** Aufteilung eines Anzeigenamens („Anna Beispiel“); nur wenn Vor- und Nachname erkennbar sind, sonst `undefined` (dann legt ein Mensch an, nichts wird geraten). */
export function splitDisplayName(displayName?: string | null): { firstName: string; lastName: string } | undefined {
  const text = (displayName ?? '').replace(/["<>]/g, '').trim();
  if (!text || text.includes('@')) return undefined;
  if (text.includes(',')) {
    const [last, first] = text.split(',', 2).map((p) => p.trim());
    return first && last ? { firstName: first, lastName: last } : undefined;
  }
  const parts = text.split(/\s+/);
  return parts.length >= 2 ? { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] as string } : undefined;
}

/**
 * Kundenstamm-Prüfung eines Vorgangs: Ist die Absenderin bzw. der Absender bekannt? Das Ergebnis ist dreiwertig (gefunden / nicht gefunden / System nicht erreichbar).
 * Fehlt der Eintrag, legt ORBIT ihn selbst an, wenn die Regel es erlaubt und alle Verzeichnisse Anlage zulassen – sonst wird ein Mensch gebeten (Aufgabe und Meldung).
 * Danach WARTET ORBIT NICHT auf eine Antwort: der Takt prüft in Abständen erneut und merkt, wenn der Eintrag dort angelegt wurde (von Hand, oder vom führenden System).
 */
@Injectable()
export class CustomerRecordService {
  private readonly logger = new Logger(CustomerRecordService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CUSTOMER_DIRECTORIES) private readonly directories: CustomerDirectory[],
    private readonly policy: PolicyEnforcementService,
    private readonly tasks: TasksService,
    private readonly events: CaseEventsService,
    orbitContacts: OrbitContactsDirectory,
    contacts: ContactsService,
  ) {
    orbitContacts.useContacts(contacts);
  }

  /** Fragt alle Verzeichnisse und fasst zusammen. */
  async check(tenantId: string, email: string): Promise<CustomerCheck> {
    const systems: SystemAnswer[] = [];
    for (const directory of this.directories) {
      let answer: SystemAnswer;
      try {
        const result = await directory.lookup({ tenantId, email });
        answer = { systemKey: directory.systemKey, label: directory.label, outcome: result.outcome, matches: result.matches, reason: result.reason };
      } catch (error) {
        answer = { systemKey: directory.systemKey, label: directory.label, outcome: 'UNAVAILABLE', matches: [], reason: error instanceof Error ? error.message : String(error) };
      }
      systems.push(answer);
    }
    const found = systems.find((s) => s.outcome === 'FOUND' && s.matches.length > 0);
    if (found) return { outcome: 'FOUND', systems, match: { ...(found.matches[0] as CustomerMatch), systemKey: found.systemKey } };
    return { outcome: systems.some((s) => s.outcome === 'UNAVAILABLE') ? 'UNAVAILABLE' : 'NOT_FOUND', systems };
  }

  /** Prüfung im Ablauf des Vorgangs (wiederholbar: die Zeile je Vorgang wird fortgeschrieben, eine Aufgabe entsteht höchstens einmal). */
  async observe(tenantId: string, caseId: string, input: { email: string; displayName?: string | null }): Promise<CustomerRecordState> {
    const email = input.email.trim().toLowerCase();
    const db = this.prisma.forTenantId(tenantId);
    const existing = await db.customerRecordWatch.findUnique({ where: { caseId } });
    const checked = await this.check(tenantId, email);
    const now = new Date();

    let status: CustomerLookupOutcome = checked.outcome;
    let system = checked.match?.systemKey ?? null;
    let externalId = checked.match?.externalId ?? null;
    let origin: string | null = checked.outcome === 'FOUND' ? (existing && existing.status !== 'FOUND' ? 'CREATED_BY_HUMAN' : (existing?.origin ?? 'EXISTING')) : null;
    let reason: string | null = checked.outcome === 'UNAVAILABLE' ? checked.systems.filter((s) => s.outcome === 'UNAVAILABLE').map((s) => `${s.label}: ${s.reason ?? 'nicht erreichbar'}`).join('; ') || null : null;

    if (checked.outcome === 'NOT_FOUND') {
      const created = await this.tryCreate(tenantId, email, input.displayName);
      if (created.match) {
        status = 'FOUND';
        system = created.systemKey ?? null;
        externalId = created.match.externalId;
        origin = 'CREATED_BY_ORBIT';
      } else {
        reason = created.reason;
        if (!existing) {
          await this.tasks.create(
            tenantId,
            undefined,
            { title: `Kunden anlegen: ${input.displayName?.trim() || email}`, description: `${created.reason} Sobald der Eintrag im Kundenstamm vorhanden ist, bemerkt ORBIT das selbst.`, caseId },
            'AGENT',
            'AGENT',
          );
        }
      }
    }

    const resolved = status === 'FOUND';
    const checks = (existing?.checks ?? 0) + 1;
    const data = {
      email,
      displayName: input.displayName?.trim() || null,
      status,
      system,
      externalId,
      origin,
      reason,
      checks,
      lastCheckedAt: now,
      nextCheckAt: resolved ? null : new Date(now.getTime() + recheckDelayMs(checks)),
      resolvedAt: resolved ? (existing?.resolvedAt ?? now) : null,
    };
    await db.customerRecordWatch.upsert({ where: { caseId }, create: { tenantId, caseId, ...data }, update: data });
    if (status !== existing?.status) await this.recordEvent(tenantId, caseId, status, system, origin, checks);
    return { status, system, origin, reason };
  }

  /** Takt des Workers: Vorgänge, deren Kundeneintrag fehlt oder nicht geprüft werden konnte, werden erneut geprüft. */
  async sweep(now = new Date()): Promise<{ checked: number; found: number }> {
    const due = await this.prisma.withRlsBypass((tx) =>
      tx.customerRecordWatch.findMany({
        where: { status: { not: 'FOUND' }, nextCheckAt: { lte: now }, case: { orchestrationStatus: { notIn: ['COMPLETED', 'REJECTED', 'CANCELLED'] }, updatedAt: { gte: new Date(now.getTime() - MAX_AGE_MS) } } },
        orderBy: { nextCheckAt: 'asc' },
        take: BATCH,
        select: { tenantId: true, caseId: true, email: true, displayName: true },
      }),
    );
    let found = 0;
    for (const watch of due) {
      try {
        const state = await this.observe(watch.tenantId, watch.caseId, { email: watch.email, displayName: watch.displayName });
        if (state.status === 'FOUND') found += 1;
      } catch (error) {
        this.logger.warn(`customer recheck failed for case ${watch.caseId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { checked: due.length, found };
  }

  // ── intern ────────────────────────────────────────────────────────────────

  private async tryCreate(tenantId: string, email: string, displayName?: string | null): Promise<{ match?: CustomerMatch; systemKey?: string; reason: string }> {
    const writable = this.directories.filter((d) => d.canCreate && d.create);
    if (writable.length === 0 || writable.length !== this.directories.length) {
      return { reason: 'Der Kundenstamm wird in einem angebundenen System geführt, in das ORBIT nicht selbst schreibt. Bitte den Kunden dort anlegen.' };
    }
    if ((await this.policy.resolveMode(tenantId, 'crm.contact.manage')) !== 'AUTONOMOUS') {
      return { reason: 'Die Regeln verlangen, dass ein Mensch neue Kontakte freigibt oder anlegt.' };
    }
    const name = splitDisplayName(displayName);
    if (!name) return { reason: 'Aus der Nachricht ist kein vollständiger Name erkennbar; ORBIT legt keinen Kunden mit geratenem Namen an.' };
    const directory = writable[0] as CustomerDirectory;
    const match = await (directory.create as NonNullable<CustomerDirectory['create']>)({ tenantId, email, firstName: name.firstName, lastName: name.lastName });
    return { match, systemKey: directory.systemKey, reason: '' };
  }

  private async recordEvent(tenantId: string, caseId: string, status: CustomerLookupOutcome, system: string | null, origin: string | null, checks: number): Promise<void> {
    await this.events
      .append(tenantId, caseId, { type: CASE_EVENT_TYPES.CUSTOMER_RECORD_CHECKED, payload: { status, system, origin, checks }, dedupeKey: `customer-record:${caseId}:${status}` })
      .catch((error: unknown) => this.logger.warn(`customer event failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}
