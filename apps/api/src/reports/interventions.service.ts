import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { analyseInterventions, type InterventionReport } from './interventions';

/** Obergrenzen, damit ein Bericht auch bei sehr viel Betrieb schnell bleibt; wird eine erreicht, steht das im Bericht. */
const MAX_CASES = 5000;
const MAX_ATTENTION = 5000;
const MAX_APPROVALS = 5000;

export interface InterventionReportResponse extends InterventionReport {
  generatedAt: string;
  /** Eine der Obergrenzen wurde erreicht: der Bericht umfasst nicht alles. */
  truncated: boolean;
}

@Injectable()
export class InterventionsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(tenantId: string, days: number, now = new Date()): Promise<InterventionReportResponse> {
    const since = new Date(now.getTime() - days * 24 * 3_600_000);
    const scoped = this.prisma.forTenantId(tenantId);
    const [cases, attention, approvals, policies] = await Promise.all([
      scoped.case.findMany({ where: { createdAt: { gte: since } }, select: { id: true, type: true, orchestrationStatus: true, attentionReasons: true }, orderBy: { createdAt: 'desc' }, take: MAX_CASES }),
      scoped.attentionItem.findMany({ where: { firstSeenAt: { gte: since } }, select: { caseId: true, kind: true, responsibility: true, state: true, firstSeenAt: true, acknowledgedAt: true }, orderBy: { firstSeenAt: 'desc' }, take: MAX_ATTENTION }),
      scoped.approval.findMany({ where: { requestedAt: { gte: since } }, select: { policyAction: true, status: true, decisionReason: true }, orderBy: { requestedAt: 'desc' }, take: MAX_APPROVALS }),
      scoped.policyConfig.findMany({ select: { action: true, mode: true } }),
    ]);
    const report = analyseInterventions({
      days,
      cases: cases.map((c) => ({ id: c.id, type: String(c.type), status: String(c.orchestrationStatus), attentionReasons: c.attentionReasons })),
      attention,
      approvals: approvals.map((a) => ({ policyAction: a.policyAction, status: a.status, decisionReason: a.decisionReason })),
      policyModes: Object.fromEntries(policies.map((p) => [p.action, String(p.mode)])),
    });
    return { ...report, generatedAt: now.toISOString(), truncated: cases.length >= MAX_CASES || attention.length >= MAX_ATTENTION || approvals.length >= MAX_APPROVALS };
  }
}
