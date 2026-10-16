import { analyseInterventions, median, normalizeReason, type AttentionSample, type CaseSample, type InterventionInput } from './interventions';

const c = (id: string, status: string, attentionReasons: string[] = [], type = 'SALES'): CaseSample => ({ id, type, status, attentionReasons });
const minutes = (n: number) => new Date(Date.UTC(2026, 9, 1, 8, 0) + n * 60_000);
const att = (caseId: string, responsibility: string, reaction: number | null, state = 'ACKNOWLEDGED'): AttentionSample => ({ caseId, kind: 'MANUAL_REVIEW', responsibility, state, firstSeenAt: minutes(0), acknowledgedAt: reaction === null ? null : minutes(reaction) });
const empty: InterventionInput = { days: 30, cases: [], attention: [], approvals: [], policyModes: {} };
const approvals = (action: string, approved: number, rejected: number) => [...Array(approved).fill({ policyAction: action, status: 'APPROVED', decisionReason: null }), ...Array(rejected).fill({ policyAction: action, status: 'REJECTED', decisionReason: 'zu hoch' })];

describe('Bericht „Wo greifen Menschen ein?“', () => {
  it('ohne Daten: leerer Bericht, keine Quote, keine Vorschläge', () => {
    const r = analyseInterventions(empty);
    expect(r.cases).toMatchObject({ total: 0, automated: 0, withHuman: 0, automationRate: null });
    expect(r.suggestions).toEqual([]);
    expect(r.attention.medianReactionMinutes).toBeNull();
  });

  it('automatisch = abgeschlossen ohne Meldung; Handarbeit = Meldung oder wartend/fehlgeschlagen', () => {
    const r = analyseInterventions({
      ...empty,
      cases: [c('a', 'COMPLETED'), c('b', 'COMPLETED'), c('m', 'MANUAL_REVIEW', ['Prüfung nötig']), c('w', 'WAITING_FOR_APPROVAL'), c('x', 'COMPLETED'), c('o', 'IN_PROGRESS')],
      attention: [att('x', 'GENERAL', 10)],
    });
    expect(r.cases).toMatchObject({ total: 6, automated: 2, withHuman: 3, running: 1 });
    expect(r.cases.automationRate).toBeCloseTo(2 / 5); // der laufende Vorgang ohne Meldung zählt nicht mit
    expect(r.cases.byType).toEqual([{ type: 'SALES', total: 6, withHuman: 3 }]);
  });

  it('häufige Ablehnung: Vorschlag erst ab genug Entscheidungen', () => {
    const few = analyseInterventions({ ...empty, approvals: approvals('email.send.reply', 1, 3) });
    expect(few.suggestions).toEqual([]);
    const many = analyseInterventions({ ...empty, approvals: approvals('email.send.reply', 6, 4) });
    expect(many.suggestions).toEqual([expect.objectContaining({ kind: 'OFT_ABGELEHNT', subject: 'email.send.reply', evidence: '4 von 10 Entscheidungen abgelehnt (40 %).' })]);
  });

  it('immer freigegeben: Vorschlag „autonom“ nur, wenn die Aktion es noch nicht ist', () => {
    const base = { ...empty, approvals: approvals('email.send.acknowledgement', 12, 0) };
    expect(analyseInterventions({ ...base, policyModes: { 'email.send.acknowledgement': 'REQUIRE_APPROVAL' } }).suggestions).toEqual([expect.objectContaining({ kind: 'IMMER_FREIGEGEBEN' })]);
    expect(analyseInterventions({ ...base, policyModes: { 'email.send.acknowledgement': 'AUTONOMOUS' } }).suggestions).toEqual([]);
    expect(analyseInterventions(base).suggestions).toEqual([]); // Betriebsart unbekannt: kein Vorschlag
    expect(analyseInterventions({ ...empty, approvals: approvals('x', 9, 0), policyModes: { x: 'REQUIRE_APPROVAL' } }).suggestions).toEqual([]); // zu wenige
  });

  it('gleichartige Gründe werden zusammengefasst und gezählt', () => {
    expect(normalizeReason('Schritt 3 (sales-intake): Werkzeug "create_contact" fehlgeschlagen')).toBe('Schritt # (sales-intake): Werkzeug … fehlgeschlagen');
    const r = analyseInterventions({
      ...empty,
      cases: [c('1', 'MANUAL_REVIEW', ['Schritt 1: Eingabe "a" fehlt']), c('2', 'MANUAL_REVIEW', ['Schritt 2: Eingabe "b" fehlt']), c('3', 'MANUAL_REVIEW', ['Schritt 9: Eingabe "c" fehlt']), c('4', 'MANUAL_REVIEW', ['Etwas anderes'])],
    });
    expect(r.topReasons[0]).toEqual({ reason: 'Schritt #: Eingabe … fehlt', count: 3 });
    expect(r.suggestions).toEqual([expect.objectContaining({ kind: 'HAEUFIGER_GRUND', evidence: '3 Vorgänge im Zeitraum.' })]);
  });

  it('langsame Übernahme: Median je Zuständigkeit, erst ab drei Meldungen', () => {
    const slow = [att('1', 'COMPLAINTS', 300), att('2', 'COMPLAINTS', 600), att('3', 'COMPLAINTS', 500), att('4', 'EMERGENCY', 5), att('5', 'EMERGENCY', 4)];
    const r = analyseInterventions({ ...empty, attention: slow });
    expect(r.suggestions).toEqual([expect.objectContaining({ kind: 'LANGSAME_REAKTION', subject: 'COMPLAINTS', evidence: 'Median 500 Minuten bis zur Übernahme (3 Meldungen).' })]);
    expect(r.attention.medianReactionMinutes).toBe(300);
    expect(median([])).toBeNull();
    expect(median([1, 3])).toBe(2);
  });
});
