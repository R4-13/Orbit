import { TIME_REACHED_EVENT, type PlanProposal } from '@orbit/shared';

type Node = PlanProposal['nodes'][number];
type Edge = PlanProposal['edges'][number];

const node = (id: string, type: Node['type'], title: string, extra: Partial<Node> = {}): Node => ({
  id,
  type,
  title,
  inputs: {},
  preconditions: [],
  optional: false,
  onFailure: 'REVIEW',
  config: {},
  evidenceRefs: [],
  ...extra,
});

const edge = (source: string, target: string, condition?: Edge['condition']): Edge => ({ id: `e_${source}_${target}`, source, target, ...(condition ? { condition } : {}) });

/** Bedingung „Das Betriebswissen kann die Frage beantworten“ bzw. nicht – an jeder Kante des Zweigs, damit der nicht gewählte Zweig übersprungen wird und nichts nachläuft. */
const answerable = (value: boolean): Edge['condition'] => ({ eq: [{ stepOutput: { node: 'know', path: 'answerable' } }, { literal: value }] });

/**
 * Standardablauf „Allgemeine Frage zum Betrieb“ (Leistungen, Zeiten, Einsatzgebiet): Absender prüfen → aus dem Betriebswissen beantworten → bei belegter Antwort per Regel
 * `email.send.information` antworten, sonst eine Person informieren. Ein fester Ablauf statt freier KI-Planung, weil er immer gleich aussieht und die KI bei verzweigten
 * Plänen im Live-Test unzulässige Bedingungen schrieb (siehe `docs/ASSUMPTIONS.md`). Die Antwort selbst bleibt auf das Betriebswissen beschränkt (`knowledge.answer`).
 */
export function buildInformationProcedure(options: { message: string }): PlanProposal {
  return {
    goalKeys: ['inquiry.answered'],
    nodes: [
      node('sender_check', 'RESOLVE_CONTEXT', 'Absender prüfen', { capability: { key: 'context.lookup' } }),
      node('know', 'PREPARE', 'Aus dem Betriebswissen beantworten', { capability: { key: 'knowledge.answer' } }),
      node('reply_draft', 'PREPARE', 'Antwort vorbereiten', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, answer: { stepOutput: { node: 'know', path: 'answer' } } }, config: { purpose: 'INFORMATION' } }),
      node('reply_send', 'ACTION', 'Antwort senden', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'reply_draft', path: 'draftId' } } }, config: { purpose: 'INFORMATION' } }),
      node('answered', 'COMPLETE', 'Frage beantwortet'),
      node('notify_staff', 'ACTION', 'Zuständige Person informieren', { capability: { key: 'staff.notify' }, inputs: { message: { literal: options.message } } }),
      node('plan_further', 'REASSESS', 'Weiter planen', { purpose: 'Die Frage ist aus dem Betriebswissen nicht belegt beantwortbar: ORBIT plant frei weiter (Kontext, Rückfragen, Übergabe).', config: { replan: true } }),
      // Rückfall: gelingt das freie Weiterplanen nicht (z. B. keine KI erreichbar), bleibt der Vorgang bei einer Person – wie bisher.
      node('human_answers', 'MANUAL_TASK', 'Eine Person beantwortet die Frage', { purpose: 'Die Frage ist durch das Betriebswissen nicht belegt beantwortbar; eine Person antwortet.' }),
    ],
    edges: [
      edge('sender_check', 'know'),
      edge('know', 'reply_draft', answerable(true)),
      edge('reply_draft', 'reply_send', answerable(true)),
      edge('reply_send', 'answered', answerable(true)),
      edge('know', 'notify_staff', answerable(false)),
      edge('notify_staff', 'plan_further', answerable(false)),
      edge('plan_further', 'human_answers', answerable(false)),
    ],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Allgemeine Frage: aus dem Betriebswissen beantworten, sonst eine Person informieren.',
  };
}

/**
 * Interner Auftrag mit Zeitpunkt (FX-03, z. B. „Erinnere uns am Freitag um 8 Uhr an die Wartung bei Meier“): bis zum Zeitpunkt warten (zeitgesteuertes Ereignis), dann die zuständige
 * Person informieren. Ziel „Zuständige Person informiert“ – erreicht mit der bestätigten Meldung. Keine Nachricht nach außen, keine Preise, keine Zusagen.
 */
export function buildReminderProcedure(options: { message: string; until: string }): PlanProposal {
  return {
    goalKeys: ['staff.informed'],
    nodes: [
      node('wait_until', 'WAIT_EVENT', 'Bis zum Zeitpunkt warten', { config: { eventType: TIME_REACHED_EVENT, until: options.until } }),
      node('notify_staff', 'ACTION', 'Zuständige Person informieren', { capability: { key: 'staff.notify' }, inputs: { message: { literal: options.message } } }),
      node('reminded', 'COMPLETE', 'Auftrag erledigt'),
    ],
    edges: [edge('wait_until', 'notify_staff'), edge('notify_staff', 'reminded')],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Interner Auftrag mit Zeitpunkt: zum Zeitpunkt die zuständige Person informieren.',
  };
}

/**
 * Standardablauf „Nachfrage zum Stand einer früheren Anfrage“: Absender prüfen → Stand des früheren Vorgangs mitteilen (Regel `email.send.acknowledgement`; die Auskunft nennt nur den
 * Stand und den letzten Schritt, keine Zusagen, und nur an eine Adresse, die an jenem Vorgang beteiligt war) → fertig. Ein Mensch bleibt über den Vorgang selbst erreichbar.
 */
export function buildStatusProcedure(): PlanProposal {
  return {
    goalKeys: ['inquiry.answered'],
    nodes: [
      node('sender_check', 'RESOLVE_CONTEXT', 'Absender prüfen', { capability: { key: 'context.lookup' } }),
      node('status_draft', 'PREPARE', 'Statusauskunft vorbereiten', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' } }, config: { purpose: 'STATUS_UPDATE' } }),
      node('status_send', 'ACTION', 'Statusauskunft senden', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'status_draft', path: 'draftId' } } }, config: { purpose: 'STATUS_UPDATE' } }),
      node('answered', 'COMPLETE', 'Nachfrage beantwortet'),
    ],
    edges: [edge('sender_check', 'status_draft'), edge('status_draft', 'status_send'), edge('status_send', 'answered')],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Nachfrage zum Stand: den Stand des früheren Vorgangs mitteilen.',
  };
}
