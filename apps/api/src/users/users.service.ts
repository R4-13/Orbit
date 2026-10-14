import { Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const USER_LIST_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/**
 * §52 (Datenschutz): user deactivation. Deliberately does not expose a
 * generic update/delete — a deactivated account must stop being usable
 * immediately (existing sessions revoked, not just blocked from a future
 * login), which is more than a plain field update.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string): Promise<TenantUserSummary[]> {
    return this.prisma.forTenantId(tenantId).user.findMany({
      select: USER_LIST_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async deactivate(tenantId: string, actorUserId: string, userId: string): Promise<TenantUserSummary> {
    if (userId === actorUserId) {
      throw new PolicyViolationError('You cannot deactivate your own account.', { userId });
    }

    const existing = await this.prisma.forTenantId(tenantId).user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new NotFoundError('User not found.', { id: userId });
    }
    if (existing.status === 'DEACTIVATED') {
      throw new PolicyViolationError('User is already deactivated.', { id: userId });
    }

    const updated = await this.prisma.forTenantId(tenantId).user.update({
      where: { id: userId },
      data: { status: 'DEACTIVATED' },
      select: USER_LIST_SELECT,
    });

    // RefreshToken trägt keine tenant_id; seine RLS-Regel prüft den Mandanten über die Elterntabelle `users` (MST-13). Deshalb in einer Mandanten-Transaktion:
    // ein deaktiviertes Konto muss sofort den Zugang verlieren, nicht erst bei der nächsten Anmeldung.
    await this.prisma.inTenantTransaction(tenantId, (tx) =>
      tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );

    await this.audit.record({
      tenantId,
      eventType: 'USER_DEACTIVATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'User',
      entityId: userId,
      payload: { email: existing.email },
    });

    return updated;
  }
}
