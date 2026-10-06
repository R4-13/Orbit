import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@orbit/domain';
import { redactValue, type PlatformAuditEventType, type PlatformRole } from '@orbit/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface PlatformAuditInput {
  eventType: PlatformAuditEventType;
  actor?: { userId: string; roles: readonly PlatformRole[] } | null;
  targetType?: string;
  targetId?: string;
  targetTenantId?: string;
  reason?: string;
  /** Vorher-/Nachher-Zustand: wird vor dem Speichern geschwärzt (Secrets werden nie abgelegt) und zusätzlich als Hash festgehalten. */
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  supportSessionId?: string;
  extra?: Record<string, unknown>;
}

export interface PlatformAuditEntry {
  id: string;
  at: string;
  eventType: string;
  actorUserId: string | null;
  actorRoles: string[];
  targetType: string | null;
  targetId: string | null;
  targetTenantId: string | null;
  reason: string | null;
  correlationId: string | null;
  supportSessionId: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  before: unknown;
  after: unknown;
}

function stableHash(value: unknown): string | null {
  if (value === undefined) return null;
  const canonical = JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
  return createHash('sha256').update(canonical ?? 'null').digest('hex');
}

/**
 * Schreibpfad für Ereignisse der Plattformdomäne (Amendment 03 §19). Gleiche Tabelle wie das Mandanten-Audit (`audit_logs`, `domain = PLATFORM`,
 * ADR OPS-A3) – es gibt keinen zweiten Audit-Store. Die Zeilen sind per DB-Trigger unveränderlich; es gibt bewusst keinen Update-/Delete-Pfad.
 * Secrets werden nie gespeichert: Vorher/Nachher laufen durch `redactValue`.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: PlatformAuditInput, tx?: Prisma.TransactionClient): Promise<void> {
    const before = input.before === undefined ? undefined : redactValue(input.before);
    const after = input.after === undefined ? undefined : redactValue(input.after);
    const payload = {
      actorRoles: input.actor?.roles ?? [],
      reason: input.reason ?? null,
      beforeHash: stableHash(before),
      afterHash: stableHash(after),
      before: before ?? null,
      after: after ?? null,
      ...(input.extra ? { extra: redactValue(input.extra) } : {}),
    };
    const write = (client: Prisma.TransactionClient) =>
      client.auditLog.create({
        data: {
          domain: 'PLATFORM',
          tenantId: null,
          eventType: input.eventType,
          actorType: input.actor ? 'PLATFORM_USER' : 'SYSTEM',
          actorPlatformUserId: input.actor?.userId,
          entityType: input.targetType,
          entityId: input.targetId,
          targetTenantId: input.targetTenantId,
          correlationId: input.correlationId,
          supportSessionId: input.supportSessionId,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    if (tx) await write(tx);
    else await this.prisma.withPlatformScope((client) => write(client));
  }

  /**
   * Lesepfad. `restrict` begrenzt die Sicht je Rolle: `scoped` = nur Ereignistypen des eigenen Fachbereichs, `ownUserId` = nur eigene Handlungen.
   */
  async list(input: { limit: number; before?: string; eventTypes?: string[]; targetTenantId?: string; actorUserId?: string; restrict?: { eventTypePrefixes?: readonly string[]; ownUserId?: string } }): Promise<{ items: PlatformAuditEntry[]; nextBefore?: string }> {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const where: Prisma.AuditLogWhereInput = { domain: 'PLATFORM' };
    const and: Prisma.AuditLogWhereInput[] = [];
    if (input.before) and.push({ createdAt: { lt: new Date(input.before) } });
    if (input.eventTypes?.length) and.push({ eventType: { in: input.eventTypes } });
    if (input.targetTenantId) and.push({ targetTenantId: input.targetTenantId });
    if (input.actorUserId) and.push({ actorPlatformUserId: input.actorUserId });
    if (input.restrict?.ownUserId) and.push({ actorPlatformUserId: input.restrict.ownUserId });
    if (input.restrict?.eventTypePrefixes?.length) and.push({ OR: input.restrict.eventTypePrefixes.map((prefix) => ({ eventType: { startsWith: prefix } })) });
    if (and.length) where.AND = and;

    const rows = await this.prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit + 1 }));
    const page = rows.slice(0, limit);
    const items = page.map((row): PlatformAuditEntry => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        eventType: row.eventType,
        actorUserId: row.actorPlatformUserId,
        actorRoles: Array.isArray(payload.actorRoles) ? (payload.actorRoles as string[]) : [],
        targetType: row.entityType,
        targetId: row.entityId,
        targetTenantId: row.targetTenantId,
        reason: (payload.reason as string | null) ?? null,
        correlationId: row.correlationId,
        supportSessionId: row.supportSessionId,
        beforeHash: (payload.beforeHash as string | null) ?? null,
        afterHash: (payload.afterHash as string | null) ?? null,
        before: payload.before ?? null,
        after: payload.after ?? null,
      };
    });
    return { items, nextBefore: rows.length > limit ? page[page.length - 1]?.createdAt.toISOString() : undefined };
  }
}
