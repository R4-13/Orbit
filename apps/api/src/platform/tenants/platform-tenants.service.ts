import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { NotFoundError, ValidationFailedError, type AutomationPresetKey, type PlatformPrincipal } from '@orbit/shared';
import { ORBIT_ENV } from '../../config/env.token';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantsService } from '../../tenants/tenants.service';
import { PlatformAuditService } from '../audit/platform-audit.service';

export interface PlatformTenantSummary {
  tenantId: string;
  displayName: string;
  slug: string;
  lifecycleStatus: string;
  userCount: number;
  deletionRequested: boolean;
  suspensionScopes: string[];
  featureCohorts: string[];
  createdAt: string;
}

export interface ProvisionTenantInput {
  name: string;
  slug?: string;
  industry?: string;
  automationPreset: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  reason: string;
}

export interface ProvisionedTenant {
  tenant: PlatformTenantSummary;
  adminEmail: string;
  /** Einmaliges Startpasswort: nur in dieser Antwort, nirgends gespeichert oder protokolliert. */
  temporaryPassword: string;
}

/** Aus dem Namen eine Kennung ableiten: ASCII, Kleinbuchstaben, Bindestriche (Umlaute und ß werden aufgelöst). */
export function slugify(name: string): string {
  const folded = name.replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'betrieb';
}

export interface PlatformOverview {
  environment: string;
  generatedAt: string;
  tenants: { total: number; byStatus: Record<string, number> };
  platformIdentities: { active: number; disabled: number };
  activePlatformSessions: number;
  platformAuditEventsLast24h: number;
  /** Bereiche, die diese Version noch nicht liefert – bewusst ausgewiesen statt mit erfundenen Werten gefüllt. */
  notYetAvailable: string[];
}

/**
 * Mandantenregister der Plattform (Amendment 03 §6.1): Metadaten und Aggregate – keine Fachdaten. Die mandantenübergreifende Lesung läuft über den
 * RLS-Bypass-Pfad ausschließlich hinter Plattform-Guards und liefert nur Zähler/Status, nie Geschäftsinhalte.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
    private readonly tenantProvisioning: TenantsService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Neukunde anlegen: der Betrieb mit seinen Standardrollen, Regeln in der gewählten Automatisierungsstufe, Branche im Betriebsprofil und dem ersten
   * Administrator. Das Startpasswort wird erzeugt und nur in der Antwort gezeigt; im Audit stehen Mandant, Branche und Stufe, nie das Passwort.
   */
  async provision(actor: PlatformPrincipal, input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    const email = input.adminEmail.trim().toLowerCase();
    const explicit = Boolean(input.slug);
    const taken = await this.prisma.withRlsBypass(async (tx) => ({
      slugs: new Set((await tx.tenant.findMany({ select: { slug: true } })).map((t) => t.slug)),
      emailUsed: (await tx.user.count({ where: { email } })) > 0,
    }));
    if (taken.emailUsed) throw new ValidationFailedError('Diese E-Mail-Adresse gehört schon zu einem Benutzer. Bitte eine andere Adresse für den Administrator verwenden.');
    let slug = input.slug ?? slugify(input.name);
    if (taken.slugs.has(slug)) {
      if (explicit) throw new ValidationFailedError(`Die Kennung „${slug}“ ist schon vergeben.`);
      let n = 2;
      while (taken.slugs.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    const temporaryPassword = `${randomBytes(15).toString('base64url')}-${randomBytes(2).toString('hex')}`;
    const { tenant } = await this.tenantProvisioning.bootstrapTenant({
      name: input.name.trim(),
      slug,
      adminEmail: email,
      adminPassword: temporaryPassword,
      adminFirstName: input.adminFirstName.trim(),
      adminLastName: input.adminLastName.trim(),
      industry: input.industry?.trim() || undefined,
      automationPreset: input.automationPreset as AutomationPresetKey,
    });
    await this.audit.record({
      eventType: 'PLATFORM_TENANT_PROVISIONED',
      actor: { userId: actor.userId, roles: actor.platformRoles },
      targetType: 'Tenant',
      targetId: tenant.id,
      targetTenantId: tenant.id,
      reason: input.reason,
      extra: { slug, industry: input.industry?.trim() || null, automationPreset: input.automationPreset },
    });
    return { tenant: await this.get(tenant.id), adminEmail: email, temporaryPassword };
  }

  async list(): Promise<PlatformTenantSummary[]> {
    return this.prisma.withRlsBypass(async (tx) => {
      const tenants = await tx.tenant.findMany({ orderBy: { createdAt: 'asc' } });
      const counts = await tx.user.groupBy({ by: ['tenantId'], _count: { _all: true } });
      const userCount = new Map(counts.map((c) => [c.tenantId, c._count._all]));
      return tenants.map((t) => ({
        tenantId: t.id,
        displayName: t.name,
        slug: t.slug,
        lifecycleStatus: t.status,
        userCount: userCount.get(t.id) ?? 0,
        deletionRequested: Boolean(t.deletionRequestedAt),
        suspensionScopes: t.suspensionScopes,
        featureCohorts: t.featureCohorts,
        createdAt: t.createdAt.toISOString(),
      }));
    });
  }

  async get(tenantId: string): Promise<PlatformTenantSummary> {
    const found = (await this.list()).find((t) => t.tenantId === tenantId);
    if (!found) throw new NotFoundError('Mandant nicht gefunden.');
    return found;
  }

  async overview(): Promise<PlatformOverview> {
    const tenants = await this.list();
    const byStatus: Record<string, number> = {};
    for (const t of tenants) byStatus[t.lifecycleStatus] = (byStatus[t.lifecycleStatus] ?? 0) + 1;
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [active, disabled, sessions, auditCount] = await this.prisma.withPlatformScope((tx) =>
      Promise.all([
        tx.platformUser.count({ where: { status: 'ACTIVE' } }),
        tx.platformUser.count({ where: { status: 'DISABLED' } }),
        tx.platformSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
        tx.auditLog.count({ where: { domain: 'PLATFORM', createdAt: { gte: since } } }),
      ]),
    );
    return {
      environment: this.env.ORBIT_ENVIRONMENT,
      generatedAt: new Date().toISOString(),
      tenants: { total: tenants.length, byStatus },
      platformIdentities: { active, disabled },
      activePlatformSessions: sessions,
      platformAuditEventsLast24h: auditCount,
      notYetAvailable: ['Aktive Prüfung der KI-Anbieter (ihre Gesundheit entsteht nur aus echten Aufrufen)'],
    };
  }
}
