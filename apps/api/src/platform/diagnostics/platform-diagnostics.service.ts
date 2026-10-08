import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { NotFoundError, redactString, redactValue, type DiagnosticSearchHit, type OrchestrationDiagnosticProjection, type PlatformPrincipal } from '@orbit/shared';
import { ORBIT_ENV } from '../../config/env.token';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';

const MAX_MESSAGE = 300;

function safe(message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  const text = redactString(message).split(/\r?\n/)[0]?.trim() ?? '';
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text || undefined;
}

/**
 * Technische Diagnose eines Case (Amendment 03 §17, Amendment 02 v1.2 §35.3). Liest ausschließlich AUS den autoritativen Domänenobjekten (Plan, Knoten,
 * Ledger, AgentRun, Korrelation) – es gibt keinen zweiten Datenspeicher (Governance GOV-07). Metadaten, keine Fachinhalte: keine Mailtexte, Entwürfe,
 * Payloads oder Tool-Ein-/Ausgaben; Fehlermeldungen geschwärzt. Jeder Zugriff ist mandantenscharf, begründet und auditiert (OPS-33).
 */
@Injectable()
export class PlatformDiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  /**
   * Referenzsuche (Amendment 03 §16.1): zu einer Kennung (Vorgang, Plan, Aktion, Lauf, Support-Sitzung) wird gefunden, zu welchem Mandanten und Vorgang sie
   * gehört. Antwort nur mit Art, Mandant, Vorgang und Zustand – nie Inhalte. Wie jeder Plattformzugriff ist die Suche begründet und auditiert; die Treffer
   * führen zur mandantenscharfen Diagnose. Ein unbekanntes oder fremdes Format liefert keine Treffer (keine Fehlermeldung, die etwas verrät).
   */
  async search(principal: PlatformPrincipal, input: { reference: string; reason: string }): Promise<DiagnosticSearchHit[]> {
    const reference = input.reference.trim();
    const hits: DiagnosticSearchHit[] = [];
    const looksLikeId = /^[0-9a-fA-F-]{8,64}$/.test(reference);
    if (looksLikeId) {
      // Support-Sitzungen sind nur im Plattform-Scope lesbar (eigene Policy), die Betriebstabellen der Mandanten nur mit RLS-Bypass.
      const sessions = await this.prisma.withPlatformScope((tx) => tx.platformSupportSession.findMany({ where: { id: reference }, select: { id: true, targetTenantId: true, status: true, createdAt: true }, take: 5 }));
      const [cases, plans, intents, runs] = await this.prisma.withRlsBypass((tx) =>
        Promise.all([
          tx.case.findMany({ where: { id: reference }, select: { id: true, tenantId: true, orchestrationStatus: true, createdAt: true }, take: 5 }),
          tx.processPlan.findMany({ where: { id: reference }, select: { id: true, tenantId: true, caseId: true, status: true, createdAt: true }, take: 5 }),
          tx.actionIntent.findMany({ where: { id: reference }, select: { id: true, tenantId: true, caseId: true, status: true, createdAt: true }, take: 5 }),
          tx.agentRun.findMany({ where: { id: reference }, select: { id: true, tenantId: true, caseId: true, status: true, startedAt: true }, take: 5 }),
        ]),
      );
      const tenantIds = [...new Set([...cases.map((c) => c.tenantId), ...plans.map((p) => p.tenantId), ...intents.map((i) => i.tenantId), ...runs.map((r) => r.tenantId), ...sessions.map((s) => s.targetTenantId)])];
      const names = new Map((await this.prisma.withRlsBypass((tx) => tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }))).map((t) => [t.id, t.name]));
      const name = (id: string) => names.get(id) ?? 'Unbekannter Mandant';
      for (const c of cases) hits.push({ kind: 'CASE', tenantId: c.tenantId, tenantName: name(c.tenantId), caseId: c.id, status: c.orchestrationStatus, createdAt: c.createdAt.toISOString() });
      for (const p of plans) hits.push({ kind: 'PLAN', tenantId: p.tenantId, tenantName: name(p.tenantId), caseId: p.caseId, status: p.status, createdAt: p.createdAt.toISOString() });
      for (const i of intents) hits.push({ kind: 'ACTION', tenantId: i.tenantId, tenantName: name(i.tenantId), caseId: i.caseId, status: i.status, createdAt: i.createdAt.toISOString() });
      for (const r of runs) hits.push({ kind: 'AGENT_RUN', tenantId: r.tenantId, tenantName: name(r.tenantId), caseId: r.caseId ?? undefined, status: r.status, createdAt: r.startedAt.toISOString() });
      for (const s of sessions) hits.push({ kind: 'SUPPORT_SESSION', tenantId: s.targetTenantId, tenantName: name(s.targetTenantId), status: s.status, createdAt: s.createdAt.toISOString() });
    }
    await this.audit.record({
      eventType: 'PLATFORM_DIAGNOSTICS_READ',
      actor: { userId: principal.userId, roles: principal.platformRoles },
      targetType: 'ReferenceSearch',
      targetId: looksLikeId ? reference : 'ungueltige-kennung',
      reason: input.reason,
      extra: { kind: 'REFERENCE_SEARCH', hits: hits.length, kinds: [...new Set(hits.map((h) => h.kind))] },
    });
    return hits;
  }

  /**
   * Diagnose-Export (OAS-05): dieselbe Projektion wie die Ansicht, als Datei – mit Kopfdaten (Version, Zeitpunkt, Umgebung, Rollen des Exportierenden, Begründung),
   * nochmals geschwärzt (zweite Stufe zusätzlich zur Projektion). Der Export verlässt das System, deshalb verlangt die Route ein Step-up; das Audit hält Umfang,
   * Größe und Prüfsumme des exportierten Inhalts fest – nie den Inhalt selbst.
   */
  async exportCase(principal: PlatformPrincipal, input: { tenantId: string; caseId: string; reason: string }): Promise<{ filename: string; content: string }> {
    const projection = await this.caseDiagnostics(principal, input);
    const envelope = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      environment: this.env.ORBIT_ENVIRONMENT,
      exportedByRoles: principal.platformRoles,
      reason: redactString(input.reason),
      projection,
    };
    const content = JSON.stringify(redactValue(envelope), null, 2);
    await this.audit.record({
      eventType: 'PLATFORM_DIAGNOSTIC_EXPORTED',
      actor: { userId: principal.userId, roles: principal.platformRoles },
      targetType: 'Case',
      targetId: input.caseId,
      targetTenantId: input.tenantId,
      reason: input.reason,
      extra: { format: 'json', exportVersion: 1, bytes: Buffer.byteLength(content, 'utf8'), sha256: createHash('sha256').update(content).digest('hex'), nodes: projection.nodes.length, actions: projection.actions.length },
    });
    return { filename: `diagnose-${input.caseId}.json`, content };
  }

  async caseDiagnostics(principal: PlatformPrincipal, input: { tenantId: string; caseId: string; reason: string; supportSessionId?: string }): Promise<OrchestrationDiagnosticProjection> {
    const db = this.prisma.forTenantId(input.tenantId);
    const caseRow = await db.case.findFirst({ where: { id: input.caseId } });
    if (!caseRow) {
      // Gleiche Antwort für „existiert nicht“ und „anderer Mandant“: kein Orakel über fremde Case-IDs.
      throw new NotFoundError('Vorgang nicht gefunden.');
    }

    const [plans, intents, runs, correlations] = await Promise.all([
      db.processPlan.findMany({ where: { caseId: caseRow.id }, orderBy: { revision: 'asc' }, include: { nodes: true } }),
      db.actionIntent.findMany({ where: { caseId: caseRow.id }, orderBy: { createdAt: 'asc' }, include: { receipts: { orderBy: { createdAt: 'asc' } } } }),
      db.agentRun.findMany({ where: { caseId: caseRow.id }, orderBy: { startedAt: 'asc' }, include: { toolInvocations: { orderBy: { createdAt: 'asc' } } } }),
      db.caseCorrelation.findMany({ where: { caseId: caseRow.id }, orderBy: { createdAt: 'asc' } }),
    ]);

    const projection: OrchestrationDiagnosticProjection = {
      caseId: caseRow.id,
      tenantId: input.tenantId,
      caseStatus: caseRow.orchestrationStatus,
      caseRevision: caseRow.revision,
      generatedAt: new Date().toISOString(),
      planRevisions: plans.map((p) => ({
        planId: p.id,
        revision: p.revision,
        status: p.status,
        source: p.source,
        blueprintKey: p.blueprintKey ?? undefined,
        blueprintVersion: p.blueprintVersion ?? undefined,
        planHash: p.planHash,
        createdAt: p.createdAt.toISOString(),
        activatedAt: p.activatedAt?.toISOString(),
      })),
      nodes: plans.flatMap((p) =>
        p.nodes.map((n) => ({
          planRevision: p.revision,
          nodeKey: n.nodeKey,
          type: n.type,
          state: n.state,
          attempts: n.attempts,
          executionMode: n.executionMode ?? undefined,
          errorCode: n.errorCode ?? undefined,
          errorMessage: safe(n.errorMessage),
          agentRunId: n.agentRunId ?? undefined,
          startedAt: n.startedAt?.toISOString(),
          completedAt: n.completedAt?.toISOString(),
          retryAt: n.retryAt?.toISOString(),
        })),
      ),
      actions: intents.map((i) => ({
        intentId: i.id,
        nodeKey: i.nodeKey,
        capabilityKey: i.capabilityKey,
        purpose: i.purpose ?? undefined,
        status: i.status,
        planRevision: i.planRevision,
        payloadHash: i.payloadHash,
        idempotencyKey: i.idempotencyKey,
        errorCode: i.errorCode ?? undefined,
        receipts: i.receipts.map((r) => ({ status: r.status, executionMode: r.executionMode, providerRef: r.providerRef ?? undefined, at: r.createdAt.toISOString() })),
      })),
      agentRuns: runs.map((r) => ({
        id: r.id,
        agentType: r.agentType,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString(),
        errorMessage: safe(r.errorMessage),
        toolInvocations: r.toolInvocations.map((t) => ({ toolName: t.toolName, status: t.status, policyAction: t.policyAction ?? undefined, policyMode: t.policyMode ?? undefined, at: t.createdAt.toISOString() })),
      })),
      correlations: correlations.map((c) => ({ emailMessageId: c.emailMessageId, status: c.status, rule: c.rule, at: c.createdAt.toISOString() })),
      providerRuns: [],
    };

    await this.audit.record({
      eventType: input.supportSessionId ? 'PLATFORM_SUPPORT_ACCESS' : 'PLATFORM_DIAGNOSTICS_READ',
      actor: { userId: principal.userId, roles: principal.platformRoles },
      targetType: 'Case',
      targetId: caseRow.id,
      targetTenantId: input.tenantId,
      supportSessionId: input.supportSessionId,
      reason: input.reason,
      extra: { nodes: projection.nodes.length, actions: projection.actions.length, agentRuns: projection.agentRuns.length },
    });
    return projection;
  }
}
