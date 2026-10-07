import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  NotFoundError,
  PLATFORM_MIN_PASSWORD_LENGTH,
  PLATFORM_ROLES,
  ValidationFailedError,
  isPlatformRole,
  type PlatformPrincipal,
  type PlatformRole,
} from '@orbit/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformAuthService } from '../auth/platform-auth.service';

export interface PlatformIdentityView {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roles: PlatformRole[];
  lastLoginAt?: string;
  createdAt: string;
}

const MIN_PASSWORD_LENGTH = PLATFORM_MIN_PASSWORD_LENGTH;

function toView(user: { id: string; email: string; displayName: string; status: 'ACTIVE' | 'DISABLED'; lastLoginAt: Date | null; createdAt: Date; roleAssignments: Array<{ role: string }> }): PlatformIdentityView {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: user.roleAssignments.map((a) => a.role).filter(isPlatformRole),
    lastLoginAt: user.lastLoginAt?.toISOString(),
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Platform-Identity-Administration (Amendment 03 §2.4): die einzige Stelle, an der Plattformrollen vergeben werden. Mandantenrollen und der
 * Mandanten-Rollenpfad können keine `PLATFORM_*`-Rolle erzeugen oder vergeben (reservierter Präfix + DB-Check).
 * Sicherheitsinvariante: der Plattform hat immer mindestens einen aktiven Owner – der letzte Owner kann weder entzogen noch deaktiviert werden.
 */
@Injectable()
export class PlatformIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly auth: PlatformAuthService,
  ) {}

  async list(): Promise<PlatformIdentityView[]> {
    const users = await this.prisma.withPlatformScope((tx) => tx.platformUser.findMany({ orderBy: { createdAt: 'asc' }, include: { roleAssignments: { where: { revokedAt: null } } } }));
    return users.map(toView);
  }

  async create(actor: PlatformPrincipal | null, input: { email: string; displayName: string; password: string; roles: string[] }): Promise<PlatformIdentityView> {
    const roles = this.validateRoles(input.roles);
    if (input.password.length < MIN_PASSWORD_LENGTH) throw new ValidationFailedError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
    const email = input.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(input.password);
    try {
      const created = await this.prisma.withPlatformScope(async (tx) => {
        const user = await tx.platformUser.create({ data: { email, displayName: input.displayName.trim(), passwordHash, createdByPlatformUserId: actor?.userId } });
        for (const role of roles) await tx.platformRoleAssignment.create({ data: { platformUserId: user.id, role, grantedByUserId: actor?.userId } });
        await this.audit.record(
          { eventType: 'PLATFORM_IDENTITY_CREATED', actor: actor ? { userId: actor.userId, roles: actor.platformRoles } : null, targetType: 'PlatformUser', targetId: user.id, after: { email, displayName: user.displayName, roles } },
          tx,
        );
        return tx.platformUser.findUniqueOrThrow({ where: { id: user.id }, include: { roleAssignments: { where: { revokedAt: null } } } });
      });
      return toView(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Diese E-Mail-Adresse ist bereits als Plattformidentität vorhanden.');
      throw error;
    }
  }

  /** Setzt die aktiven Rollen exakt auf `roles` (Hinzufügen und Entziehen in einer Transaktion, mit Vorher/Nachher im Audit). */
  async setRoles(actor: PlatformPrincipal, targetUserId: string, input: { roles: string[]; reason: string }): Promise<PlatformIdentityView> {
    const roles = this.validateRoles(input.roles);
    const result = await this.prisma.withPlatformScope(async (tx) => {
      const target = await tx.platformUser.findUnique({ where: { id: targetUserId }, include: { roleAssignments: { where: { revokedAt: null } } } });
      if (!target) throw new NotFoundError('Plattformidentität nicht gefunden.');
      const current = target.roleAssignments.map((a) => a.role).filter(isPlatformRole);
      const toGrant = roles.filter((r) => !current.includes(r));
      const toRevoke = current.filter((r) => !roles.includes(r));

      if (toRevoke.includes(PLATFORM_ROLES.PLATFORM_OWNER) && (await this.activeOwnerCount(tx, targetUserId)) === 0) {
        throw new ConflictException('Der letzte aktive Platform Owner kann nicht entzogen werden.');
      }
      const now = new Date();
      for (const role of toRevoke) {
        await tx.platformRoleAssignment.updateMany({ where: { platformUserId: targetUserId, role, revokedAt: null }, data: { revokedAt: now, revokedByUserId: actor.userId } });
        await this.audit.record({ eventType: 'PLATFORM_ROLE_REVOKED', actor: { userId: actor.userId, roles: actor.platformRoles }, targetType: 'PlatformUser', targetId: targetUserId, reason: input.reason, before: { role }, after: null }, tx);
      }
      for (const role of toGrant) {
        await tx.platformRoleAssignment.create({ data: { platformUserId: targetUserId, role, grantedByUserId: actor.userId } });
        await this.audit.record({ eventType: 'PLATFORM_ROLE_GRANTED', actor: { userId: actor.userId, roles: actor.platformRoles }, targetType: 'PlatformUser', targetId: targetUserId, reason: input.reason, before: null, after: { role } }, tx);
      }
      return { view: await tx.platformUser.findUniqueOrThrow({ where: { id: targetUserId }, include: { roleAssignments: { where: { revokedAt: null } } } }), changed: toGrant.length + toRevoke.length > 0 };
    });
    // Rollenänderung wirkt sofort: bestehende Sitzungen werden ungültig, die Person meldet sich neu an.
    if (result.changed) await this.auth.revokeAllSessions(targetUserId, 'ROLES_CHANGED');
    return toView(result.view);
  }

  async disable(actor: PlatformPrincipal, targetUserId: string, reason: string): Promise<PlatformIdentityView> {
    const view = await this.prisma.withPlatformScope(async (tx) => {
      const target = await tx.platformUser.findUnique({ where: { id: targetUserId }, include: { roleAssignments: { where: { revokedAt: null } } } });
      if (!target) throw new NotFoundError('Plattformidentität nicht gefunden.');
      if (target.roleAssignments.some((a) => a.role === PLATFORM_ROLES.PLATFORM_OWNER) && (await this.activeOwnerCount(tx, targetUserId)) === 0) {
        throw new ConflictException('Der letzte aktive Platform Owner kann nicht deaktiviert werden.');
      }
      await tx.platformUser.update({ where: { id: targetUserId }, data: { status: 'DISABLED' } });
      await this.audit.record({ eventType: 'PLATFORM_IDENTITY_DISABLED', actor: { userId: actor.userId, roles: actor.platformRoles }, targetType: 'PlatformUser', targetId: targetUserId, reason, before: { status: target.status }, after: { status: 'DISABLED' } }, tx);
      return tx.platformUser.findUniqueOrThrow({ where: { id: targetUserId }, include: { roleAssignments: { where: { revokedAt: null } } } });
    });
    await this.auth.revokeAllSessions(targetUserId, 'DISABLED');
    return toView(view);
  }

  /** Anzahl aktiver Owner AUSSER dem betroffenen – bleibt sie 0, wäre die Operation der letzte Owner. */
  private async activeOwnerCount(tx: Parameters<Parameters<PrismaService['withPlatformScope']>[0]>[0], excludingUserId: string): Promise<number> {
    return tx.platformRoleAssignment.count({
      where: { role: PLATFORM_ROLES.PLATFORM_OWNER, revokedAt: null, platformUserId: { not: excludingUserId }, user: { status: 'ACTIVE' } },
    });
  }

  private validateRoles(roles: string[]): PlatformRole[] {
    const unique = [...new Set(roles)];
    if (unique.length === 0) throw new ValidationFailedError('Mindestens eine Plattformrolle ist erforderlich.');
    const unknown = unique.filter((role) => !isPlatformRole(role));
    if (unknown.length > 0) throw new ValidationFailedError('Unbekannte Plattformrolle.', { unknown });
    return unique as PlatformRole[];
  }
}
