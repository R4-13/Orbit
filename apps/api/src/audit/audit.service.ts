import { Injectable } from '@nestjs/common';
import type { AuditEventType } from '@orbit/shared';
import { Prisma } from '@orbit/domain';
import { PrismaService } from '../prisma/prisma.service';

export type AuditActorType = 'USER' | 'AGENT' | 'SYSTEM';

export interface RecordAuditEventInput {
  tenantId: string;
  eventType: AuditEventType;
  actorType: AuditActorType;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Single write path for the append-only audit trail (§31). Every module
 * that changes tenant-visible state (Cases, Tasks, Finance, Sales, Agent
 * Runtime, ...) calls this instead of writing AuditLog rows itself, so the
 * event-type/actor-type vocabulary stays centralized and consistent.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    await this.prisma.forTenantId(input.tenantId).auditLog.create({
      data: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
