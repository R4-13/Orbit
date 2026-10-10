import { Injectable } from '@nestjs/common';
import type { Prisma, StaffMember } from '@orbit/domain';
import { NotFoundError, ValidationFailedError, StaffInputSchema, channelAddressProblem, parseStaffCsv, type StaffInput } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Mitarbeiterverzeichnis: wen ORBIT wofür und wie erreicht (Rolle, Zuständigkeit, Kanal, Vertretung, Vorgesetzte).
 *
 * Drei Wege hinein, ein gemeinsamer Abgleich: von Hand (einzeln), per CSV-Datei (Vorschau, dann Übernahme) und über die Schnittstelle `PUT /staff/sync`
 * (Verzeichnis eines größeren Betriebs, Schlüssel ist die Kennung `externalId`). Personen werden nie gelöscht, sondern deaktiviert – Verweise in
 * Vorgängen und die Eskalationskette bleiben nachvollziehbar.
 */

type Db = Prisma.TransactionClient;

export interface StaffView extends Omit<StaffMember, 'tenantId'> {
  supervisorName?: string | null;
  deputyName?: string | null;
}

export type StaffImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'DEACTIVATE' | 'ERROR';

export interface StaffImportRowResult {
  /** Zeile in der Datei (CSV) bzw. Position in der Liste (Schnittstelle, ab 1). */
  line: number;
  name: string;
  action: StaffImportAction;
  errors: string[];
  warnings: string[];
}

export interface StaffImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  rows: StaffImportRowResult[];
  /** Erkannte CSV-Spalten, damit zu sehen ist, was ankam und was nicht verstanden wurde. */
  mapping?: Array<{ header: string; field: string | null }>;
}

interface BatchItem {
  line: number;
  staff?: StaffInput;
  /** Felder, die die Quelle tatsächlich geliefert hat – nur diese überschreiben bei einer Aktualisierung (eine fehlende Spalte löscht nichts). */
  present: ReadonlySet<string>;
  errors: string[];
}

class DryRunRollback extends Error {
  constructor(readonly result: StaffImportResult) {
    super('dry run');
  }
}

const SCALAR_FIELDS = ['externalId', 'firstName', 'lastName', 'roleKind', 'roleTitle', 'email', 'phone', 'teamsAddress', 'whatsappNumber', 'preferredChannel', 'calendarId', 'availabilityNote', 'active'] as const;
const nameOf = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`.trim();
const same = (a: string, b: string | null | undefined) => (b ?? '').trim().toLowerCase() === a.trim().toLowerCase();

/** Verweis „Personalnummer oder E-Mail“ auf eine Person im Verzeichnis. */
function findRef(rows: readonly StaffMember[], ref: string): StaffMember | undefined {
  const wanted = ref.trim();
  if (!wanted) return undefined;
  return rows.find((r) => r.externalId && same(wanted, r.externalId)) ?? rows.find((r) => r.email && same(wanted, r.email));
}

/** Würde die Person als Vorgesetzte(r) eine Schleife in der Berichtskette erzeugen? */
function createsLoop(rows: readonly StaffMember[], personId: string, supervisorId: string): boolean {
  const supervisorOf = new Map(rows.map((r) => [r.id, r.supervisorId]));
  const seen = new Set<string>();
  for (let current: string | null | undefined = supervisorId; current; current = supervisorOf.get(current)) {
    if (current === personId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
  }
  return false;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeInactive: boolean): Promise<StaffView[]> {
    const rows = await this.prisma.forTenantId(tenantId).staffMember.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ active: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });
    return this.view(rows, await this.allRows(tenantId));
  }

  async get(tenantId: string, id: string): Promise<StaffView> {
    const row = await this.prisma.forTenantId(tenantId).staffMember.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('Die Person wurde nicht gefunden.', { id });
    return this.view([row], await this.allRows(tenantId))[0] as StaffView;
  }

  async create(tenantId: string, actorUserId: string, input: StaffInput): Promise<StaffView> {
    this.assertReachable(input);
    const created = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const rows = await tx.staffMember.findMany({ where: { tenantId } });
      this.assertUnique(rows, input);
      const { supervisorId, deputyId } = this.resolveRefs(rows, undefined, input);
      return tx.staffMember.create({ data: { tenantId, ...this.scalars(input), responsibilities: input.responsibilities, supervisorId, deputyId } });
    });
    await this.audit.record({ tenantId, eventType: 'STAFF_CREATED', actorType: 'USER', actorUserId, entityType: 'StaffMember', entityId: created.id, payload: { role: created.roleKind, channel: created.preferredChannel } });
    return this.get(tenantId, created.id);
  }

  async update(tenantId: string, actorUserId: string, id: string, patch: Partial<StaffInput>): Promise<StaffView> {
    const updated = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const rows = await tx.staffMember.findMany({ where: { tenantId } });
      const current = rows.find((r) => r.id === id);
      if (!current) throw new NotFoundError('Die Person wurde nicht gefunden.', { id });
      // Zusammengeführter Stand: erst danach lässt sich prüfen, ob der gewählte Kanal erreichbar ist.
      const merged = StaffInputSchema.parse({ ...this.toInput(current), ...patch });
      this.assertReachable(merged);
      this.assertUnique(rows.filter((r) => r.id !== id), merged);
      const refs = this.resolveRefs(rows, current, merged, patch);
      const data: Prisma.StaffMemberUncheckedUpdateInput = { ...this.scalars(merged), responsibilities: merged.responsibilities, ...refs };
      return tx.staffMember.update({ where: { id }, data });
    });
    await this.audit.record({ tenantId, eventType: 'STAFF_UPDATED', actorType: 'USER', actorUserId, entityType: 'StaffMember', entityId: id, payload: { fields: Object.keys(patch) } });
    return this.get(tenantId, updated.id);
  }

  /** Ausgeschiedene oder dauerhaft abwesende Person: wird übersprungen, bleibt aber in alten Vorgängen nachvollziehbar. */
  async deactivate(tenantId: string, actorUserId: string, id: string): Promise<StaffView> {
    const existing = await this.prisma.forTenantId(tenantId).staffMember.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundError('Die Person wurde nicht gefunden.', { id });
    if (existing.active) {
      await this.prisma.forTenantId(tenantId).staffMember.update({ where: { id }, data: { active: false } });
      await this.audit.record({ tenantId, eventType: 'STAFF_DEACTIVATED', actorType: 'USER', actorUserId, entityType: 'StaffMember', entityId: id, payload: {} });
    }
    return this.get(tenantId, id);
  }

  // ---------------------------------------------------------------- Abgleich (CSV und Schnittstelle)

  /** CSV-Text prüfen: nichts wird gespeichert, die Antwort sagt je Zeile, was geschehen würde. */
  previewCsv(tenantId: string, csv: string, deactivateMissing: boolean): Promise<StaffImportResult> {
    return this.importCsv(tenantId, undefined, csv, { dryRun: true, deactivateMissing });
  }

  async importCsv(tenantId: string, actorUserId: string | undefined, csv: string, options: { dryRun: boolean; deactivateMissing: boolean }): Promise<StaffImportResult> {
    const parsed = parseStaffCsv(csv);
    if (parsed.fatal) throw new ValidationFailedError(parsed.fatal);
    const fields = new Set(parsed.mapping.map((m) => m.field).filter((f): f is string => Boolean(f)));
    const present = new Set<string>(fields);
    if (fields.has('fullName')) ['firstName', 'lastName'].forEach((f) => present.add(f));
    // „Notdienst“ und „Zuständigkeiten“ sind zwei Spalten für dasselbe Feld.
    if (fields.has('emergency')) present.add('responsibilities');
    const items: BatchItem[] = parsed.rows.map((row) => ({ line: row.line, staff: row.staff, present, errors: row.errors }));
    const result = await this.applyBatch(tenantId, actorUserId, items, { ...options, source: 'CSV' });
    return { ...result, mapping: parsed.mapping };
  }

  /** Schnittstelle für größere Betriebe: das Verzeichnis des führenden Systems als Liste; Schlüssel ist `externalId`. */
  async sync(tenantId: string, actorUserId: string, raw: unknown[], options: { dryRun: boolean; deactivateMissing: boolean }): Promise<StaffImportResult> {
    const items: BatchItem[] = raw.map((entry, index) => {
      const parsed = StaffInputSchema.safeParse(entry);
      const present = new Set(entry && typeof entry === 'object' ? Object.keys(entry) : []);
      if (!parsed.success) return { line: index + 1, present, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'Eintrag'}: ${i.message}`) };
      const problem = channelAddressProblem(parsed.data);
      if (!parsed.data.externalId) return { line: index + 1, present, errors: ['Für den Abgleich über die Schnittstelle ist die Kennung (externalId) erforderlich.'] };
      return { line: index + 1, staff: parsed.data, present, errors: problem ? [problem] : [] };
    });
    return this.applyBatch(tenantId, actorUserId, items, { ...options, source: 'API' });
  }

  private async applyBatch(tenantId: string, actorUserId: string | undefined, items: BatchItem[], options: { dryRun: boolean; deactivateMissing: boolean; source: 'CSV' | 'API' }): Promise<StaffImportResult> {
    if (options.deactivateMissing && items.some((i) => i.errors.length > 0)) {
      throw new ValidationFailedError('Wegen fehlerhafter Zeilen wird niemand deaktiviert. Bitte zuerst die Fehler beheben oder „Fehlende deaktivieren“ ausschalten.');
    }
    try {
      const result = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
        const outcome = await this.applyInTransaction(tx, tenantId, items, options);
        if (options.dryRun) throw new DryRunRollback(outcome);
        return outcome;
      });
      if (actorUserId && !options.dryRun) {
        await this.audit.record({
          tenantId,
          eventType: 'STAFF_IMPORTED',
          actorType: 'USER',
          actorUserId,
          entityType: 'StaffMember',
          entityId: tenantId,
          payload: { source: options.source, created: result.created, updated: result.updated, unchanged: result.unchanged, deactivated: result.deactivated, failed: result.failed },
        });
      }
      return result;
    } catch (error) {
      if (error instanceof DryRunRollback) return error.result;
      throw error;
    }
  }

  private async applyInTransaction(tx: Db, tenantId: string, items: BatchItem[], options: { dryRun: boolean; deactivateMissing: boolean }): Promise<StaffImportResult> {
    const existing = await tx.staffMember.findMany({ where: { tenantId } });
    const results: StaffImportRowResult[] = [];
    const touched = new Set<string>();
    const applied: Array<{ item: BatchItem; id: string; result: StaffImportRowResult }> = [];

    // Phase 1: Felder anlegen/aktualisieren (Verweise auf Vorgesetzte/Vertretung folgen in Phase 2, wenn alle Personen existieren).
    for (const item of items) {
      const staff = item.staff;
      const result: StaffImportRowResult = { line: item.line, name: staff ? nameOf(staff) : '', action: 'ERROR', errors: [...item.errors], warnings: [] };
      results.push(result);
      if (!staff || result.errors.length > 0) continue;

      const match = this.match(existing, staff);
      if (match === 'AMBIGUOUS') {
        result.errors.push('Die Person lässt sich nicht eindeutig zuordnen (mehrere Treffer über Name). Bitte Kennung oder E-Mail-Adresse angeben.');
        continue;
      }
      if (match && touched.has(match.id)) {
        result.errors.push('Diese Person kommt in der Liste mehrfach vor.');
        continue;
      }
      if (match) touched.add(match.id);

      if (!match) {
        const created = await tx.staffMember.create({ data: { tenantId, ...this.scalars(staff), responsibilities: staff.responsibilities } });
        existing.push(created);
        touched.add(created.id);
        result.action = 'CREATE';
        applied.push({ item, id: created.id, result });
        continue;
      }

      const data: Prisma.StaffMemberUncheckedUpdateInput = {};
      const wanted = this.scalars(staff) as Record<string, unknown>;
      for (const field of SCALAR_FIELDS) {
        if (!item.present.has(field)) continue;
        const value = wanted[field] ?? null;
        if (value !== ((match as unknown as Record<string, unknown>)[field] ?? null)) (data as Record<string, unknown>)[field] = value;
      }
      if (item.present.has('responsibilities') && [...staff.responsibilities].sort().join() !== [...match.responsibilities].sort().join()) data.responsibilities = staff.responsibilities;
      if (Object.keys(data).length > 0) {
        const updated = await tx.staffMember.update({ where: { id: match.id }, data });
        existing[existing.findIndex((r) => r.id === match.id)] = updated;
        result.action = 'UPDATE';
      } else result.action = 'UNCHANGED';
      applied.push({ item, id: match.id, result });
    }

    // Phase 2: Vorgesetzte und Vertretung auflösen (jetzt existieren alle Personen der Liste).
    for (const { item, id, result } of applied) {
      const staff = item.staff as StaffInput;
      for (const [key, refKey, label] of [['supervisorId', 'supervisorRef', 'Vorgesetzte/r'], ['deputyId', 'deputyRef', 'Vertretung']] as const) {
        if (!item.present.has(refKey)) continue;
        const ref = staff[refKey];
        const current = existing.find((r) => r.id === id) as StaffMember;
        let target: string | null = null;
        if (ref) {
          const found = findRef(existing, ref);
          if (!found) {
            result.warnings.push(`${label} „${ref}“ ist im Verzeichnis nicht zu finden und wurde nicht gesetzt.`);
            continue;
          }
          if (found.id === id) {
            result.warnings.push(`${label} darf nicht die Person selbst sein.`);
            continue;
          }
          if (key === 'supervisorId' && createsLoop(existing, id, found.id)) {
            result.warnings.push(`${label} „${ref}“ würde eine Schleife in der Berichtskette erzeugen und wurde nicht gesetzt.`);
            continue;
          }
          target = found.id;
        }
        if ((current[key] ?? null) !== target) {
          const updated = await tx.staffMember.update({ where: { id }, data: { [key]: target } });
          existing[existing.findIndex((r) => r.id === id)] = updated;
          if (result.action === 'UNCHANGED') result.action = 'UPDATE';
        }
      }
    }

    // Phase 3: Wer vom führenden System nicht mehr geliefert wird, wird deaktiviert (nur Personen mit Kennung – von Hand erfasste bleiben unberührt).
    if (options.deactivateMissing) {
      for (const row of existing.filter((r) => r.active && r.externalId && !touched.has(r.id))) {
        await tx.staffMember.update({ where: { id: row.id }, data: { active: false } });
        results.push({ line: 0, name: nameOf(row), action: 'DEACTIVATE', errors: [], warnings: [] });
      }
    }

    const count = (action: StaffImportAction) => results.filter((r) => r.action === action).length;
    return { dryRun: options.dryRun, created: count('CREATE'), updated: count('UPDATE'), unchanged: count('UNCHANGED'), deactivated: count('DEACTIVATE'), failed: count('ERROR'), rows: results };
  }

  // ---------------------------------------------------------------- Hilfen

  private match(rows: readonly StaffMember[], staff: StaffInput): StaffMember | 'AMBIGUOUS' | undefined {
    if (staff.externalId) {
      const byId = rows.find((r) => r.externalId && same(staff.externalId as string, r.externalId));
      if (byId) return byId;
    }
    if (staff.email) {
      const byMail = rows.find((r) => r.email && same(staff.email as string, r.email));
      if (byMail) return byMail;
    }
    // Ohne Kennung und E-Mail: Vor- und Nachname. Gibt es mehrere, ist die Zuordnung nicht sicher.
    if (!staff.externalId && !staff.email) {
      const byName = rows.filter((r) => same(staff.firstName, r.firstName) && same(staff.lastName, r.lastName));
      if (byName.length > 1) return 'AMBIGUOUS';
      return byName[0];
    }
    return undefined;
  }

  private scalars(input: StaffInput) {
    return {
      externalId: input.externalId ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      roleKind: input.roleKind,
      roleTitle: input.roleTitle ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      teamsAddress: input.teamsAddress ?? null,
      whatsappNumber: input.whatsappNumber ?? null,
      preferredChannel: input.preferredChannel,
      calendarId: input.calendarId ?? null,
      availabilityNote: input.availabilityNote ?? null,
      active: input.active,
    };
  }

  private toInput(row: StaffMember): Record<string, unknown> {
    return {
      externalId: row.externalId ?? undefined,
      firstName: row.firstName,
      lastName: row.lastName,
      roleKind: row.roleKind,
      roleTitle: row.roleTitle ?? undefined,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      teamsAddress: row.teamsAddress ?? undefined,
      whatsappNumber: row.whatsappNumber ?? undefined,
      preferredChannel: row.preferredChannel,
      responsibilities: row.responsibilities,
      calendarId: row.calendarId ?? undefined,
      availabilityNote: row.availabilityNote ?? undefined,
      active: row.active,
    };
  }

  private assertReachable(input: StaffInput): void {
    const problem = channelAddressProblem(input);
    if (problem) throw new ValidationFailedError(problem);
  }

  private assertUnique(others: readonly StaffMember[], input: StaffInput): void {
    if (input.externalId && others.some((r) => r.externalId && same(input.externalId as string, r.externalId))) {
      throw new ValidationFailedError(`Die Kennung „${input.externalId}“ ist schon vergeben.`);
    }
  }

  /**
   * Vorgesetzte(r) und Vertretung aus den Verweisen (Kennung oder E-Mail). Ein nicht auffindbarer Verweis oder eine Schleife ist ein Fehler – bei der
   * Einzelerfassung ist die Person da und kann es sofort korrigieren (beim Abgleich dagegen nur eine Warnung je Zeile).
   */
  private resolveRefs(rows: readonly StaffMember[], current: StaffMember | undefined, input: Partial<StaffInput>, patch?: Partial<StaffInput>): { supervisorId?: string | null; deputyId?: string | null } {
    const out: { supervisorId?: string | null; deputyId?: string | null } = {};
    for (const [key, refKey, label] of [['supervisorId', 'supervisorRef', 'Vorgesetzte/r'], ['deputyId', 'deputyRef', 'Vertretung']] as const) {
      const touched = patch ? refKey in patch : input[refKey] !== undefined;
      if (!touched) continue;
      const ref = input[refKey];
      if (!ref) {
        out[key] = null;
        continue;
      }
      const found = findRef(rows, ref);
      if (!found) throw new ValidationFailedError(`${label} „${ref}“ ist im Verzeichnis nicht zu finden (Kennung oder E-Mail-Adresse angeben).`);
      if (current && found.id === current.id) throw new ValidationFailedError(`${label} darf nicht die Person selbst sein.`);
      if (key === 'supervisorId' && current && createsLoop(rows, current.id, found.id)) throw new ValidationFailedError(`${label} „${ref}“ würde eine Schleife in der Berichtskette erzeugen.`);
      out[key] = found.id;
    }
    return out;
  }

  private allRows(tenantId: string): Promise<StaffMember[]> {
    return this.prisma.forTenantId(tenantId).staffMember.findMany({ where: { tenantId } });
  }

  private view(rows: StaffMember[], all: StaffMember[]): StaffView[] {
    const names = new Map(all.map((r) => [r.id, nameOf(r)]));
    return rows.map(({ tenantId: _tenantId, ...rest }) => ({
      ...rest,
      supervisorName: rest.supervisorId ? (names.get(rest.supervisorId) ?? null) : null,
      deputyName: rest.deputyId ? (names.get(rest.deputyId) ?? null) : null,
    }));
  }
}
