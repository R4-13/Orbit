/**
 * „Wo greifen Menschen ein?“ (AUT-11): reine Auswertung ohne Datenbank. Aus den Vorgängen, Meldungen und Freigaben eines Zeitraums entsteht ein Bericht mit festen,
 * nachvollziehbaren Vorschlägen – kein Modell, keine Schätzung. Vorschläge ändern nie selbst etwas; sie zeigen, wo eine Einstellung oder Pflege lohnt.
 */

export interface CaseSample {
  id: string;
  type: string;
  status: string;
  attentionReasons: readonly string[];
}

export interface AttentionSample {
  caseId: string;
  kind: string;
  responsibility: string;
  state: string;
  firstSeenAt: Date;
  acknowledgedAt: Date | null;
}

export interface ApprovalSample {
  policyAction: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionReason: string | null;
}

export interface InterventionInput {
  days: number;
  cases: readonly CaseSample[];
  attention: readonly AttentionSample[];
  approvals: readonly ApprovalSample[];
  /** Aktuelle Betriebsart je Aktion (`AUTONOMOUS`, `REQUIRE_APPROVAL`, …); unbekannte Aktionen fehlen. */
  policyModes: Readonly<Record<string, string>>;
}

export interface InterventionSuggestion {
  kind: 'OFT_ABGELEHNT' | 'IMMER_FREIGEGEBEN' | 'HAEUFIGER_GRUND' | 'LANGSAME_REAKTION';
  /** Worauf sich der Vorschlag bezieht (Aktion, Grund, Zuständigkeit). */
  subject: string;
  message: string;
  evidence: string;
}

export interface InterventionReport {
  days: number;
  cases: { total: number; automated: number; withHuman: number; running: number; automationRate: number | null; byType: Array<{ type: string; total: number; withHuman: number }> };
  attention: { total: number; open: number; byKind: Array<{ kind: string; count: number }>; medianReactionMinutes: number | null };
  approvals: { total: number; approved: number; rejected: number; pending: number; byAction: Array<{ action: string; approved: number; rejected: number; pending: number; rejectionRate: number | null }> };
  topReasons: Array<{ reason: string; count: number }>;
  suggestions: InterventionSuggestion[];
}

/** Mindestanzahl an Entscheidungen, ab der eine Quote etwas aussagt. */
export const MIN_DECISIONS_FOR_REJECTION_HINT = 5;
export const MIN_DECISIONS_FOR_AUTONOMY_HINT = 10;
export const REJECTION_RATE_HINT = 0.4;
export const MIN_REASON_COUNT = 3;
export const SLOW_REACTION_MINUTES = 240;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Fasst gleichartige Gründe zusammen: Zahlen, Kennungen und Namen in Anführungszeichen fallen weg, die Länge ist begrenzt. */
export function normalizeReason(reason: string): string {
  return reason
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/"[^"]*"|„[^“]*“|'[^']*'/g, '…')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

const rate = (part: number, total: number): number | null => (total === 0 ? null : part / total);
const sortedCounts = (map: Map<string, number>): Array<[string, number]> => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export function analyseInterventions(input: InterventionInput): InterventionReport {
  const touched = new Set<string>(input.attention.map((a) => a.caseId));
  for (const c of input.cases) if (c.status === 'MANUAL_REVIEW' || c.status === 'WAITING_FOR_APPROVAL' || c.status === 'FAILED') touched.add(c.id);
  const automated = input.cases.filter((c) => c.status === 'COMPLETED' && !touched.has(c.id)).length;
  const withHuman = input.cases.filter((c) => touched.has(c.id)).length;

  const byType = new Map<string, { total: number; withHuman: number }>();
  for (const c of input.cases) {
    const entry = byType.get(c.type) ?? { total: 0, withHuman: 0 };
    entry.total += 1;
    if (touched.has(c.id)) entry.withHuman += 1;
    byType.set(c.type, entry);
  }

  const kinds = new Map<string, number>();
  for (const a of input.attention) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
  const reactionMinutes = (a: AttentionSample): number | null => (a.acknowledgedAt ? (a.acknowledgedAt.getTime() - a.firstSeenAt.getTime()) / 60_000 : null);
  const reactions = input.attention.map(reactionMinutes).filter((m): m is number => m !== null && m >= 0);

  const actions = new Map<string, { approved: number; rejected: number; pending: number }>();
  for (const a of input.approvals) {
    const entry = actions.get(a.policyAction) ?? { approved: 0, rejected: 0, pending: 0 };
    if (a.status === 'APPROVED') entry.approved += 1;
    else if (a.status === 'REJECTED') entry.rejected += 1;
    else entry.pending += 1;
    actions.set(a.policyAction, entry);
  }
  const byAction = [...actions.entries()]
    .map(([action, v]) => ({ action, ...v, rejectionRate: rate(v.rejected, v.approved + v.rejected) }))
    .sort((a, b) => b.approved + b.rejected + b.pending - (a.approved + a.rejected + a.pending) || a.action.localeCompare(b.action));

  const reasons = new Map<string, number>();
  for (const c of input.cases) {
    if (!touched.has(c.id)) continue;
    for (const r of new Set(c.attentionReasons.map(normalizeReason).filter(Boolean))) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const topReasons = sortedCounts(reasons).slice(0, 10).map(([reason, count]) => ({ reason, count }));

  const suggestions: InterventionSuggestion[] = [];
  for (const row of byAction) {
    const decided = row.approved + row.rejected;
    const mode = input.policyModes[row.action];
    if (decided >= MIN_DECISIONS_FOR_REJECTION_HINT && (row.rejectionRate ?? 0) >= REJECTION_RATE_HINT) {
      suggestions.push({
        kind: 'OFT_ABGELEHNT',
        subject: row.action,
        message: 'Diese Aktion wird häufig abgelehnt: die Freigabepflicht beibehalten und die Ursache prüfen (Anweisung, Vorlage oder Profil).',
        evidence: `${row.rejected} von ${decided} Entscheidungen abgelehnt (${Math.round((row.rejectionRate ?? 0) * 100)} %).`,
      });
    } else if (decided >= MIN_DECISIONS_FOR_AUTONOMY_HINT && row.rejected === 0 && mode && mode !== 'AUTONOMOUS') {
      suggestions.push({
        kind: 'IMMER_FREIGEGEBEN',
        subject: row.action,
        message: 'Diese Aktion wurde ausnahmslos freigegeben: sie könnte in den Richtlinien auf „autonom“ gestellt werden, um Wartezeit zu sparen.',
        evidence: `${row.approved} von ${decided} Entscheidungen freigegeben, keine abgelehnt; aktuelle Betriebsart: ${mode}.`,
      });
    }
  }
  for (const { reason, count } of topReasons) {
    if (count >= MIN_REASON_COUNT) {
      suggestions.push({
        kind: 'HAEUFIGER_GRUND',
        subject: reason,
        message: 'Dieser Grund führt wiederholt zu Handarbeit: fehlende Angaben im Profil, ein fehlender Prozess oder eine zu enge Regel können die Ursache sein.',
        evidence: `${count} Vorgänge im Zeitraum.`,
      });
    }
  }
  const byResponsibility = new Map<string, number[]>();
  for (const a of input.attention) {
    const minutes = reactionMinutes(a);
    if (minutes !== null && minutes >= 0) byResponsibility.set(a.responsibility, [...(byResponsibility.get(a.responsibility) ?? []), minutes]);
  }
  for (const [responsibility, minutes] of byResponsibility) {
    const m = median(minutes);
    if (minutes.length >= 3 && m !== null && m > SLOW_REACTION_MINUTES) {
      suggestions.push({
        kind: 'LANGSAME_REAKTION',
        subject: responsibility,
        message: 'Meldungen dieses Bereichs werden spät übernommen: Zuständigkeit, Vertretung und bevorzugten Kanal im Verzeichnis prüfen.',
        evidence: `Median ${Math.round(m)} Minuten bis zur Übernahme (${minutes.length} Meldungen).`,
      });
    }
  }

  const approved = input.approvals.filter((a) => a.status === 'APPROVED').length;
  const rejected = input.approvals.filter((a) => a.status === 'REJECTED').length;
  return {
    days: input.days,
    // Die Quote bezieht sich nur auf Vorgänge, bei denen sich schon zeigt, wer sie erledigt hat; laufende ohne Meldung zählen weder dafür noch dagegen.
    cases: { total: input.cases.length, automated, withHuman, running: input.cases.length - automated - withHuman, automationRate: rate(automated, automated + withHuman), byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total || a.type.localeCompare(b.type)) },
    attention: { total: input.attention.length, open: input.attention.filter((a) => a.state === 'OPEN').length, byKind: sortedCounts(kinds).map(([kind, count]) => ({ kind, count })), medianReactionMinutes: median(reactions) },
    approvals: { total: input.approvals.length, approved, rejected, pending: input.approvals.length - approved - rejected, byAction },
    topReasons,
    suggestions,
  };
}
