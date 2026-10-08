import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { NotFoundError } from '@orbit/shared';
import { ORBIT_ENV } from '../../config/env.token';
import { PrismaService } from '../../prisma/prisma.service';

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
  ) {}

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
      notYetAvailable: ['Kostenlimits und Anomalie-Alarme'],
    };
  }
}
