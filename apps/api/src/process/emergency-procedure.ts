import type { PlanProposal } from '@orbit/shared';

export interface EmergencyProcedureOptions {
  /** Kurze, sachliche Meldung an die zuständige Person (ohne Zusagen). */
  message: string;
  /** Soll der Absender zusätzlich eine Eingangsbestätigung erhalten? Nur wenn die Voraussetzungen erfüllt sind (Kundschaft, ausführbar, nicht deaktiviert). */
  acknowledgeSender: boolean;
}

/**
 * Das Notfallverfahren: ein fester, vom Betrieb vorgegebener Ablauf (keine KI-Planung) für jede als kritisch eingestufte Nachricht.
 *
 *   Absender prüfen ─┬─ zuständige Person benachrichtigen (mit Erinnerung und Eskalation) ──┬─ Mensch übernimmt
 *                    └─ Eingangsbestätigung vorbereiten → senden (Regel `email.send.acknowledgement`) ┘
 *
 * Die Bestätigung ist ausdrücklich keine Zusage: sie sagt der Absenderin bzw. dem Absender nur, dass die Nachricht angekommen ist und eine Person informiert wurde.
 * Ob sie ohne Freigabe hinausgeht, bestimmt allein die Regel des Betriebs; das Verfahren umgeht sie nicht. Scheitert die Bestätigung, bleibt die Benachrichtigung
 * unberührt (optional + SKIP).
 */
export function buildEmergencyProcedure(options: EmergencyProcedureOptions): PlanProposal {
  const nodes: PlanProposal['nodes'] = [
    {
      id: 'sender_check',
      type: 'RESOLVE_CONTEXT',
      title: 'Absender prüfen',
      capability: { key: 'context.lookup' },
      inputs: {},
      preconditions: [],
      optional: false,
      onFailure: 'REVIEW',
      config: {},
      evidenceRefs: [],
    },
    {
      id: 'notify_staff',
      type: 'ACTION',
      title: 'Zuständige Person benachrichtigen',
      capability: { key: 'staff.notify' },
      inputs: { message: { literal: options.message }, urgent: { literal: true } },
      preconditions: [],
      optional: false,
      onFailure: 'REVIEW',
      config: {},
      evidenceRefs: [],
    },
  ];
  const edges: PlanProposal['edges'] = [{ id: 'e_check_notify', source: 'sender_check', target: 'notify_staff' }];

  if (options.acknowledgeSender) {
    nodes.push(
      {
        id: 'ack_draft',
        type: 'PREPARE',
        title: 'Eingangsbestätigung vorbereiten',
        capability: { key: 'communication.draft' },
        inputs: { to: { fact: 'contact.email' } },
        preconditions: [],
        optional: true,
        onFailure: 'SKIP',
        config: { purpose: 'ACKNOWLEDGEMENT' },
        evidenceRefs: [],
      },
      {
        id: 'ack_send',
        type: 'ACTION',
        title: 'Eingangsbestätigung senden',
        capability: { key: 'email.send' },
        inputs: { draftId: { stepOutput: { node: 'ack_draft', path: 'draftId' } } },
        preconditions: [],
        optional: true,
        onFailure: 'SKIP',
        config: { purpose: 'ACKNOWLEDGEMENT' },
        evidenceRefs: [],
      },
    );
    edges.push({ id: 'e_check_draft', source: 'sender_check', target: 'ack_draft' }, { id: 'e_draft_send', source: 'ack_draft', target: 'ack_send' });
  }

  nodes.push({
    id: 'human_takes_over',
    type: 'MANUAL_TASK',
    title: 'Eine Person übernimmt den Notfall',
    purpose: 'Die zuständige Person entscheidet und handelt. ORBIT macht dazu keine Zusagen.',
    inputs: {},
    preconditions: [],
    optional: false,
    onFailure: 'REVIEW',
    config: {},
    evidenceRefs: [],
  });
  edges.push({ id: 'e_notify_human', source: 'notify_staff', target: 'human_takes_over' });
  if (options.acknowledgeSender) edges.push({ id: 'e_send_human', source: 'ack_send', target: 'human_takes_over' });

  return {
    goalKeys: ['emergency.handled'],
    nodes,
    edges,
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: options.acknowledgeSender
      ? 'Notfallverfahren: die zuständige Person wird sofort benachrichtigt, der Absender erhält eine Eingangsbestätigung ohne Zusagen, danach übernimmt ein Mensch.'
      : 'Notfallverfahren: die zuständige Person wird sofort benachrichtigt, danach übernimmt ein Mensch.',
  };
}
