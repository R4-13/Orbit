import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { API_KEY_PREFIX, API_KEY_SCOPES, NotFoundError, ValidationFailedError, permissionsForScopes, type ApiKeyScope } from '@orbit/shared';
import type { ApiKey } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { PrismaService } from '../prisma/prisma.service';

export type ApiKeyView = Pick<ApiKey, 'id' | 'name' | 'prefix' | 'scopes' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>;

const VIEW_SELECT = { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;
/** `lastUsedAt` wird höchstens so oft geschrieben (kein Schreibzugriff je Aufruf). */
const LAST_USED_RESOLUTION_MS = 60_000;

const hashKey = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/**
 * Zugriffsschlüssel (Dienstzugang, AUT-12) für Systeme statt Menschen. Der Schlüssel wird einmal bei der Anlage im Klartext gezeigt und nur als SHA-256 gespeichert
 * (ein hochentropischer Zufallswert, kein Passwort – ein schneller Hash ist hier richtig). Ein Schlüssel kann genau seine Bereiche; Widerruf wirkt sofort.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platformControl: PlatformControlService,
  ) {}

  list(tenantId: string): Promise<ApiKeyView[]> {
    return this.prisma.forTenantId(tenantId).apiKey.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: VIEW_SELECT });
  }

  async create(tenantId: string, actorUserId: string, input: { name: string; scopes: string[] }): Promise<{ key: string; view: ApiKeyView }> {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 80) throw new ValidationFailedError('Der Name muss 3 bis 80 Zeichen lang sein.');
    const scopes = [...new Set(input.scopes)];
    if (scopes.length === 0 || scopes.some((s) => !(API_KEY_SCOPES as readonly string[]).includes(s))) {
      throw new ValidationFailedError(`Bitte mindestens einen gültigen Bereich wählen (${API_KEY_SCOPES.join(', ')}).`);
    }
    const prefix = randomBytes(5).toString('hex').slice(0, 8);
    const key = `${API_KEY_PREFIX}${prefix}_${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.forTenantId(tenantId).apiKey.create({ data: { tenantId, name, prefix, keyHash: hashKey(key), scopes, createdByUserId: actorUserId }, select: VIEW_SELECT });
    await this.audit.record({ tenantId, eventType: 'API_KEY_CREATED', actorType: 'USER', actorUserId, entityType: 'ApiKey', entityId: row.id, payload: { name, scopes, prefix } });
    return { key, view: row };
  }

  async revoke(tenantId: string, actorUserId: string, id: string): Promise<ApiKeyView> {
    const scoped = this.prisma.forTenantId(tenantId);
    const existing = await scoped.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Zugriffsschlüssel nicht gefunden.', { id });
    if (existing.revokedAt) return scoped.apiKey.findUniqueOrThrow({ where: { id }, select: VIEW_SELECT });
    const row = await scoped.apiKey.update({ where: { id }, data: { revokedAt: new Date() }, select: VIEW_SELECT });
    await this.audit.record({ tenantId, eventType: 'API_KEY_REVOKED', actorType: 'USER', actorUserId, entityType: 'ApiKey', entityId: id, payload: { name: existing.name, prefix: existing.prefix } });
    return row;
  }

  /** Prüft einen Schlüssel aus dem Header und liefert den Handelnden: ein Konto ohne Rollen, nur mit den Berechtigungen seiner Bereiche. */
  async authenticate(raw: string): Promise<AuthenticatedUser> {
    const row = await this.prisma.withRlsBypass((tx) => tx.apiKey.findUnique({ where: { keyHash: hashKey(raw) } }));
    if (!row || row.revokedAt) throw new UnauthorizedException('Ungültiger oder widerrufener Zugriffsschlüssel.');
    if (!(await this.platformControl.tenantGate(row.tenantId)).loginAllowed) throw new UnauthorizedException('Das Unternehmen ist derzeit gesperrt.');
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.prisma.withRlsBypass((tx) => tx.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })).catch(() => undefined);
    }
    return { id: `apikey:${row.id}`, tenantId: row.tenantId, email: `apikey-${row.prefix}@dienstzugang.invalid`, roles: [], permissions: permissionsForScopes(row.scopes) };
  }

  static scopesOf(scopes: readonly string[]): ApiKeyScope[] {
    return scopes.filter((s): s is ApiKeyScope => (API_KEY_SCOPES as readonly string[]).includes(s));
  }
}
