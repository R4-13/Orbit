import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import type { PlatformSupportSession } from '@orbit/domain';
import {
  NotFoundError,
  PERMISSIONS,
  PLATFORM_SCOPES,
  PermissionDeniedError,
  SUPPORT_SCOPES,
  ValidationFailedError,
  describeSupportIssue,
  redactValue,
  supportScopesNeedApproval,
  validateSupportRequest,
  type OrchestrationDiagnosticProjection,
  type PlatformPrincipal,
  type SupportScope,
} from '@orbit/shared';
import { ORBIT_ENV } from '../../config/env.token';
import { PrismaService } from '../../prisma/prisma.service';
import { CaseOrchestrationService } from '../../process/case-orchestration.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformDiagnosticsService } from '../diagnostics/platform-diagnostics.service';

export interface SupportSessionView {
  id: string;
  targetTenantId: string;
  operatorUserId: string;
  reasonCode: string;
  freeTextReason: string;
  ticketRef: string | null;
  mode: string;
  scopes: string[];
  status: 'REQUESTED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CLOSED';
  requestedMinutes: number;
  requiresApproval: boolean;
  approvedByUserId: string | null;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  version: number;
}

export interface SupportTenantContext {
  tenantId: string;
  status: string;
  suspensionScopes: string[];
  featureCohorts: string[];
  policies: Array<{ action: string; mode: string }>;
  integrations: Array<{ connectorType: string; status: string; grantedCapabilities: unknown[] }>;
}

const actorOf = (principal: PlatformPrincipal) => ({ userId: principal.userId, roles: principal.platformRoles });

/**
 * Support-Sessions (Amendment 03 §18). Es gibt keinen Impersonation-Account und keinen „als Kunde“-Zugriff: jeder Zugriff auf Mandanteninhalte läuft über eine
 * ausdrücklich angeforderte, begründete, zeitlich begrenzte Sitzung mit enumerierten Scopes.
 *
 *  - Anforderung: Modus + Scopes + Dauer (≤ Plattformrichtlinie, kein Frontend-Standard) + Grund. Diagnose-/Metadaten-Scopes aktivieren sofort; Scopes mit
 *    Fachinhalt (`case.payload.read`) verlangen die Freigabe einer ZWEITEN Person (DB-Check: Genehmiger ≠ Anfordernder).
 *  - Die Dauer läuft ab Aktivierung und wird nie verlängert – weder stillschweigend noch per Endpunkt; wer mehr Zeit braucht, fordert neu an.
 *  - Jeder Zugriff prüft Sitzung, Ablauf, Anfordernden und Scope **bei jedem Aufruf** und wird mit Sitzungs-ID, Mandant und betroffenen Objekten auditiert.
 *  - `tenant.action.execute` / `ASSISTED_ACTION` sind in dieser Version nicht verfügbar (konkrete Policy/Freigabe fehlt) und werden abgelehnt.
 */
@Injectable()
export class PlatformSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly diagnostics: PlatformDiagnosticsService,
    private readonly orchestration: CaseOrchestrationService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  // ── Lebenszyklus ───────────────────────────────────────────────────────────────────────────────────────────────────

  async request(actor: PlatformPrincipal, input: { tenantId: string; mode: string; scopes: string[]; minutes: number; reasonCode: string; freeTextReason: string; ticketRef?: string }): Promise<SupportSessionView> {
    const issues = validateSupportRequest({ mode: input.mode, scopes: input.scopes, minutes: input.minutes, maxMinutes: this.env.PLATFORM_SUPPORT_SESSION_MAX_MINUTES });
    if (issues.length > 0) throw new ValidationFailedError('Die Support-Session kann so nicht angefordert werden.', { issues: issues.map((code) => ({ code, message: describeSupportIssue(code) })) });
    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundError('Mandant nicht gefunden.');

    const needsApproval = supportScopesNeedApproval(input.scopes);
    const now = new Date();
    const scopes = [...new Set(input.scopes)].sort();
    const created = await this.prisma.withPlatformScope(async (tx) => {
      const row = await tx.platformSupportSession.create({
        data: {
          targetTenantId: input.tenantId,
          operatorUserId: actor.userId,
          reasonCode: input.reasonCode,
          freeTextReason: input.freeTextReason,
          ticketRef: input.ticketRef,
          mode: input.mode,
          scopes,
          requestedMinutes: input.minutes,
          status: needsApproval ? 'REQUESTED' : 'ACTIVE',
          activatedAt: needsApproval ? null : now,
          expiresAt: needsApproval ? null : new Date(now.getTime() + input.minutes * 60_000),
        },
      });
      await this.audit.record({ eventType: 'PLATFORM_SUPPORT_SESSION_REQUESTED', actor: actorOf(actor), targetType: 'SupportSession', targetId: row.id, targetTenantId: input.tenantId, supportSessionId: row.id, reason: input.freeTextReason, after: { mode: input.mode, scopes, minutes: input.minutes, reasonCode: input.reasonCode, ticketRef: input.ticketRef ?? null, requiresApproval: needsApproval } }, tx);
      if (!needsApproval) await this.audit.record({ eventType: 'PLATFORM_SUPPORT_SESSION_ACTIVATED', actor: actorOf(actor), targetType: 'SupportSession', targetId: row.id, targetTenantId: input.tenantId, supportSessionId: row.id, reason: 'Aktivierung ohne Fachinhalt (keine Freigabe nötig)', after: { expiresAt: row.expiresAt?.toISOString() } }, tx);
      return row;
    });
    return this.toView(created);
  }

  async approve(actor: PlatformPrincipal, sessionId: string, input: { reason: string; expectedVersion: number }): Promise<SupportSessionView> {
    const result = await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.platformSupportSession.findUnique({ where: { id: sessionId } });
      if (!before) throw new NotFoundError('Support-Session nicht gefunden.');
      if (before.status !== 'REQUESTED') throw new ConflictException('Nur eine angeforderte Support-Session kann freigegeben werden.');
      if (before.operatorUserId === actor.userId) throw new ForbiddenException('Die Freigabe muss durch eine andere Person erfolgen (Vier-Augen-Prinzip).');
      const now = new Date();
      const updated = await tx.platformSupportSession.updateMany({
        where: { id: sessionId, version: input.expectedVersion, status: 'REQUESTED' },
        data: { status: 'ACTIVE', approvedByUserId: actor.userId, approvedAt: now, activatedAt: now, expiresAt: new Date(now.getTime() + before.requestedMinutes * 60_000), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Die Support-Session wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.platformSupportSession.findUniqueOrThrow({ where: { id: sessionId } });
      await this.audit.record({ eventType: 'PLATFORM_SUPPORT_SESSION_ACTIVATED', actor: actorOf(actor), targetType: 'SupportSession', targetId: sessionId, targetTenantId: before.targetTenantId, supportSessionId: sessionId, reason: input.reason, before: { status: before.status }, after: { status: after.status, expiresAt: after.expiresAt?.toISOString(), approvedBy: actor.userId } }, tx);
      return after;
    });
    return this.toView(result);
  }

  /** Schließen durch den Anfordernden; Widerruf durch Freigeber/Security (jederzeit, auch für laufende Sitzungen). */
  async close(actor: PlatformPrincipal, sessionId: string, input: { reason: string; revoke: boolean }): Promise<SupportSessionView> {
    const result = await this.prisma.withPlatformScope(async (tx) => {
      const before = await tx.platformSupportSession.findUnique({ where: { id: sessionId } });
      if (!before) throw new NotFoundError('Support-Session nicht gefunden.');
      const mayRevoke = actor.platformScopes.includes(PLATFORM_SCOPES.SUPPORT_SESSION_APPROVE);
      if (input.revoke ? !mayRevoke : before.operatorUserId !== actor.userId && !mayRevoke) throw new PermissionDeniedError('Diese Support-Session darf nicht von Ihnen beendet werden.');
      if (!['REQUESTED', 'ACTIVE'].includes(this.effectiveStatus(before))) throw new ConflictException('Die Support-Session ist bereits beendet.');
      const status = input.revoke ? 'REVOKED' : 'CLOSED';
      const after = await tx.platformSupportSession.update({ where: { id: sessionId }, data: { status, closedAt: new Date(), closedByUserId: actor.userId, closeReason: input.reason, version: { increment: 1 } } });
      await this.audit.record({ eventType: 'PLATFORM_SUPPORT_SESSION_CLOSED', actor: actorOf(actor), targetType: 'SupportSession', targetId: sessionId, targetTenantId: before.targetTenantId, supportSessionId: sessionId, reason: input.reason, before: { status: before.status }, after: { status } }, tx);
      return after;
    });
    return this.toView(result);
  }

  async list(actor: PlatformPrincipal, filter: { tenantId?: string; status?: string } = {}): Promise<SupportSessionView[]> {
    const seesAll = actor.platformScopes.includes(PLATFORM_SCOPES.SUPPORT_SESSION_APPROVE) || actor.platformScopes.includes(PLATFORM_SCOPES.AUDIT_READ);
    const rows = await this.prisma.withPlatformScope((tx) =>
      tx.platformSupportSession.findMany({
        where: { ...(seesAll ? {} : { operatorUserId: actor.userId }), ...(filter.tenantId ? { targetTenantId: filter.tenantId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    const views = rows.map((r) => this.toView(r));
    return filter.status ? views.filter((v) => v.status === filter.status) : views;
  }

  async get(actor: PlatformPrincipal, sessionId: string): Promise<SupportSessionView> {
    const row = await this.prisma.withPlatformScope((tx) => tx.platformSupportSession.findUnique({ where: { id: sessionId } }));
    if (!row) throw new NotFoundError('Support-Session nicht gefunden.');
    const seesAll = actor.platformScopes.includes(PLATFORM_SCOPES.SUPPORT_SESSION_APPROVE) || actor.platformScopes.includes(PLATFORM_SCOPES.AUDIT_READ);
    if (!seesAll && row.operatorUserId !== actor.userId) throw new NotFoundError('Support-Session nicht gefunden.');
    return this.toView(row);
  }

  // ── Zugriff (jeder Aufruf prüft die Sitzung neu) ───────────────────────────────────────────────────────────────────

  /** Prüft Sitzung, Ablauf, Anfordernden und Scope. Wirft 403 – sofort, auch wenn das Plattform-Token noch gültig ist. */
  private async authorize(actor: PlatformPrincipal, sessionId: string, scope: SupportScope): Promise<PlatformSupportSession> {
    const row = await this.prisma.withPlatformScope((tx) => tx.platformSupportSession.findUnique({ where: { id: sessionId } }));
    const deny = async (reason: string): Promise<never> => {
      await this.audit.record({ eventType: 'PLATFORM_ACCESS_DENIED', actor: actorOf(actor), targetType: 'SupportSession', targetId: sessionId, targetTenantId: row?.targetTenantId, supportSessionId: row ? sessionId : undefined, reason, extra: { scope } });
      throw new ForbiddenException('Kein gültiger Support-Zugriff: ' + reason);
    };
    if (!row || row.operatorUserId !== actor.userId) return deny('Keine eigene Support-Session mit dieser Kennung.');
    if (this.effectiveStatus(row) !== 'ACTIVE') return deny(`Die Support-Session ist nicht aktiv (${this.effectiveStatus(row)}).`);
    if (!row.scopes.includes(scope)) return deny(`Der Scope „${scope}“ ist für diese Session nicht erteilt.`);
    return row;
  }

  async tenantContext(actor: PlatformPrincipal, sessionId: string): Promise<SupportTenantContext> {
    const session = await this.authorize(actor, sessionId, SUPPORT_SCOPES.TENANT_CONFIG_READ);
    const db = this.prisma.forTenantId(session.targetTenantId);
    const [tenant, policies, integrations] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: session.targetTenantId } }),
      db.policyConfig.findMany({ select: { action: true, mode: true } }),
      db.integration.findMany({ select: { connectorType: true, status: true, grantedCapabilities: true } }),
    ]);
    await this.accessed(actor, session, 'tenant.config', session.targetTenantId, { policies: policies.length, integrations: integrations.length });
    return {
      tenantId: tenant.id,
      status: tenant.status,
      suspensionScopes: tenant.suspensionScopes,
      featureCohorts: tenant.featureCohorts,
      policies: policies.map((p) => ({ action: p.action, mode: p.mode })).sort((a, b) => a.action.localeCompare(b.action)),
      integrations: integrations.map((i) => ({ connectorType: i.connectorType, status: i.status, grantedCapabilities: Array.isArray(i.grantedCapabilities) ? i.grantedCapabilities : [] })),
    };
  }

  /** Metadaten ohne Titel/Inhalte: Kennungen, Typen, Status, Zeiten. */
  async caseMetadata(actor: PlatformPrincipal, sessionId: string) {
    const session = await this.authorize(actor, sessionId, SUPPORT_SCOPES.CASE_METADATA_READ);
    const cases = await this.prisma.forTenantId(session.targetTenantId).case.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, type: true, status: true, orchestrationStatus: true, blueprintKey: true, blueprintVersion: true, createdAt: true, completedAt: true } });
    await this.accessed(actor, session, 'case.metadata', undefined, { count: cases.length });
    return cases.map((c) => ({ id: c.id, type: c.type, status: c.status, orchestrationStatus: c.orchestrationStatus, blueprintKey: c.blueprintKey, blueprintVersion: c.blueprintVersion, createdAt: c.createdAt.toISOString(), completedAt: c.completedAt?.toISOString() ?? null }));
  }

  async caseDiagnostics(actor: PlatformPrincipal, sessionId: string, caseId: string): Promise<OrchestrationDiagnosticProjection> {
    const session = await this.authorize(actor, sessionId, SUPPORT_SCOPES.DIAGNOSTICS_READ);
    return this.diagnostics.caseDiagnostics(actor, { tenantId: session.targetTenantId, caseId, reason: `Support-Session ${session.id}: ${session.freeTextReason}`.slice(0, 480), supportSessionId: session.id });
  }

  /**
   * Fachinhalt eines Falls (Business-Projektion samt Knotendetails, Fakten, Entwurfstexte) – ausschließlich mit Scope `case.payload.read` in einer
   * freigegebenen Session. Secrets werden zusätzlich geschwärzt; jeder Zugriff nennt Fall, Knoten und Entwürfe im Audit.
   */
  async casePayload(actor: PlatformPrincipal, sessionId: string, caseId: string) {
    const session = await this.authorize(actor, sessionId, SUPPORT_SCOPES.CASE_PAYLOAD_READ);
    const viewer = { tenantId: session.targetTenantId, permissions: [PERMISSIONS.CASE_READ] };
    const graph = await this.orchestration.projection(viewer, caseId);
    const nodeIds = graph.nodes.filter((n) => n.state !== 'PLANNED').map((n) => n.id);
    const nodes = await Promise.all(nodeIds.map((id) => this.orchestration.nodeDetail(viewer, caseId, id)));
    const drafts = await this.prisma.forTenantId(session.targetTenantId).communicationDraft.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' }, select: { id: true, purpose: true, version: true, status: true, toAddress: true, subject: true, bodyText: true } });
    await this.accessed(actor, session, 'case.payload', caseId, { nodes: nodeIds, drafts: drafts.map((d) => d.id) });
    return redactValue({ caseId, status: graph.overallStatus, nodes, drafts }) as { caseId: string; status: string; nodes: unknown[]; drafts: unknown[] };
  }

  private async accessed(actor: PlatformPrincipal, session: PlatformSupportSession, area: string, objectId: string | undefined, extra: Record<string, unknown>): Promise<void> {
    await this.audit.record({ eventType: 'PLATFORM_SUPPORT_ACCESS', actor: actorOf(actor), targetType: area, targetId: objectId ?? session.targetTenantId, targetTenantId: session.targetTenantId, supportSessionId: session.id, reason: session.freeTextReason, extra });
  }

  // ── Hilfen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Eine aktive Sitzung ist ab `expiresAt` abgelaufen – unabhängig davon, ob schon jemand den Status geschrieben hat. */
  private effectiveStatus(row: { status: string; expiresAt: Date | null }): string {
    return row.status === 'ACTIVE' && row.expiresAt && row.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : row.status;
  }

  private toView(row: PlatformSupportSession): SupportSessionView {
    return {
      id: row.id,
      targetTenantId: row.targetTenantId,
      operatorUserId: row.operatorUserId,
      reasonCode: row.reasonCode,
      freeTextReason: row.freeTextReason,
      ticketRef: row.ticketRef,
      mode: row.mode,
      scopes: row.scopes,
      status: this.effectiveStatus(row) as SupportSessionView['status'],
      requestedMinutes: row.requestedMinutes,
      requiresApproval: supportScopesNeedApproval(row.scopes),
      approvedByUserId: row.approvedByUserId,
      createdAt: row.createdAt.toISOString(),
      activatedAt: row.activatedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      closeReason: row.closeReason,
      version: row.version,
    };
  }
}

