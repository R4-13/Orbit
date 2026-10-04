import { Injectable } from '@nestjs/common';
import { CASE_ORCHESTRATION_LABELS, NODE_STATE_PRESENTATION, PERMISSIONS, type Permission } from '@orbit/shared';
import { CaseOrchestrationService } from '../process/case-orchestration.service';

export interface SondeCaseContext {
  caseId: string;
  nodeId?: string;
  planRevision?: number;
}

const MAX_NODES = 40;

/**
 * Amendment 02 §17.4 — Sonde in the case. The context is assembled on the SERVER from the same read model the graph uses,
 * for the authenticated user only (a context for a case the user may not read is simply not built), and it is read-only:
 * Sonde can explain what is missing or why a case waits, but every action stays a command with the user's own permissions,
 * policy and approval — Sonde cannot approve, send or skip anything through this block.
 */
@Injectable()
export class SondeCaseContextService {
  constructor(private readonly orchestration: CaseOrchestrationService) {}

  async build(tenantId: string, permissions: readonly Permission[], context: SondeCaseContext): Promise<string | null> {
    if (!permissions.includes(PERMISSIONS.CASE_READ)) return null;
    const viewer = { tenantId, permissions };
    let graph;
    try {
      graph = await this.orchestration.projection(viewer, context.caseId, { mode: 'COMBINED', planRevision: context.planRevision });
    } catch {
      return null; // unknown or foreign case: no context, no error detail
    }

    const lines: string[] = [
      'Aktueller Vorgangs-Kontext (nur lesend, serverseitig für diesen Nutzer geprüft):',
      `- Status: ${CASE_ORCHESTRATION_LABELS[graph.overallStatus] ?? graph.overallStatus}${graph.blueprint ? `; Prozess: ${graph.blueprint.title} (${graph.blueprint.key} ${graph.blueprint.version})` : '; Ad-hoc-Plan'}; Planrevision ${graph.planRevision ?? '–'}`,
    ];
    if (graph.attentionReasons.length > 0) lines.push(`- Braucht Aufmerksamkeit: ${graph.attentionReasons.join(' | ')}`);
    if (graph.nodes.length > 0) {
      lines.push('- Schritte:');
      for (const node of graph.nodes.slice(0, MAX_NODES)) {
        lines.push(`  • ${node.title} [${node.id}]: ${NODE_STATE_PRESENTATION[node.state].label}${node.executionMode ? ` (${node.executionMode === 'LIVE' ? 'live' : 'simuliert'})` : ''}${node.conciseReason ? ` – ${node.conciseReason}` : ''}`);
      }
    }
    if (context.nodeId) {
      try {
        const detail = await this.orchestration.nodeDetail(viewer, context.caseId, context.nodeId, context.planRevision);
        lines.push(`- Ausgewählter Schritt: ${detail.title} – ${NODE_STATE_PRESENTATION[detail.state].label}. ${detail.stateExplanation}`);
        if (detail.preview?.recipient) lines.push(`  Empfänger: ${detail.preview.recipient}; Betreff: ${detail.preview.subject ?? '–'}`);
        if (detail.action) lines.push(`  Aktion: ${detail.action.status}${detail.action.receipts.length === 0 ? ' (noch nichts ausgeführt)' : ''}`);
        if (detail.availableActions.length > 0) lines.push(`  Dem Nutzer stehen in der Oberfläche diese Aktionen zur Verfügung: ${detail.availableActions.map((a) => a.title).join(', ')}.`);
      } catch {
        /* the selected step does not exist in this revision: ignore */
      }
    }
    const caseActions = graph.availableActions.map((a) => a.title);
    if (caseActions.length > 0) lines.push(`- Vorgangsweite Aktionen in der Oberfläche: ${caseActions.join(', ')}.`);
    lines.push('Regeln: Erkläre und fasse zusammen. Führe keine Freigabe, keinen Versand und keine Statusänderung selbst aus; verweise dafür auf die genannten Schaltflächen im Vorgang. Der Kontext enthält keine Rohtexte externer Nachrichten.');
    return lines.join('\n');
  }
}
