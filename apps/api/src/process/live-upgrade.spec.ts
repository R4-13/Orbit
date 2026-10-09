import { downstreamOf, earliestFirst, evaluateUpgrade, isReservedTestAddress, isUpgradableSimulation, type UpgradeEdge, type UpgradeNode } from './live-upgrade';

const edges: UpgradeEdge[] = [
  ['interpret', 'context'],
  ['context', 'extract'],
  ['extract', 'reqs'],
  ['reqs', 'ask_draft'],
  ['ask_draft', 'ask'],
  ['ask', 'wait'],
  ['wait', 'extract2'],
  ['extract2', 'reqs2'],
  ['reqs2', 'review'],
  ['review', 'price'],
  ['price', 'quote'],
  ['quote', 'deliver'],
].map(([source, target]) => ({ source: source!, target: target! }));

const node = (key: string, type: string, state: string, capabilityKey?: string, executionMode?: string): UpgradeNode => ({ key, type, state, capabilityKey, executionMode });

/** Der Fall aus der Praxis: Anfrage verstanden, Rückfrage „gesendet“ – aber alles nur simuliert, jetzt wartet der Vorgang auf eine Antwort. */
const waitingAfterSimulation = (): UpgradeNode[] => [
  node('interpret', 'INTERPRET', 'SUCCEEDED', undefined, 'LIVE'),
  node('context', 'RESOLVE_CONTEXT', 'SUCCEEDED', 'context.lookup', 'LIVE'),
  node('extract', 'PREPARE', 'SUCCEEDED', 'facts.extract_from_message', 'SIMULATED'),
  node('reqs', 'EVALUATE_REQUIREMENTS', 'SUCCEEDED', 'requirements.resolve', 'SIMULATED'),
  node('ask_draft', 'PREPARE', 'SUCCEEDED', 'communication.draft', 'LIVE'),
  node('ask', 'ACTION', 'SUCCEEDED', 'email.send', 'SIMULATED'),
  node('wait', 'WAIT_EVENT', 'WAITING'),
  node('extract2', 'PREPARE', 'PLANNED', 'facts.extract_from_message'),
  node('reqs2', 'EVALUATE_REQUIREMENTS', 'PLANNED', 'requirements.resolve'),
  node('review', 'MANUAL_TASK', 'SKIPPED'),
  node('price', 'ACTION', 'PLANNED', 'pricing.resolve'),
  node('quote', 'ACTION', 'PLANNED', 'quote.create'),
  node('deliver', 'ACTION', 'PLANNED', 'email.send'),
];

describe('Live-Abgleich: was ist aufwertbar, was darf wiederholt werden', () => {
  it('erkennt simulierte Ergebnisse mit echtem Weg; nicht aufwertbar sind echte Ergebnisse und Preise aus der Test-Preisquelle', () => {
    expect(isUpgradableSimulation(node('extract', 'PREPARE', 'SUCCEEDED', 'facts.extract_from_message', 'SIMULATED'))).toBe(true);
    expect(isUpgradableSimulation(node('reqs', 'EVALUATE_REQUIREMENTS', 'SUCCEEDED', 'requirements.resolve', 'SIMULATED'))).toBe(true);
    expect(isUpgradableSimulation(node('ask', 'ACTION', 'SUCCEEDED', 'email.send', 'SIMULATED'))).toBe(true);
    expect(isUpgradableSimulation(node('ask', 'ACTION', 'SUCCEEDED', 'email.send', 'LIVE'))).toBe(false);
    expect(isUpgradableSimulation(node('price', 'ACTION', 'SUCCEEDED', 'pricing.resolve', 'SIMULATED'))).toBe(false); // es gibt keine echte Preisquelle
    expect(isUpgradableSimulation(node('extract', 'PREPARE', 'FAILED', 'facts.extract_from_message', 'SIMULATED'))).toBe(false);
  });

  it('der Fall im Wartezustand nach simuliertem Versand wird ab der Analyse wiederholt: Analyse, Entwurf, Versand und Warten werden zurückgesetzt', () => {
    const verdict = evaluateUpgrade(waitingAfterSimulation(), edges, 'extract');
    expect(verdict).toEqual({ ok: true, resetKeys: ['extract', 'reqs', 'ask_draft', 'ask', 'wait', 'review'] });
  });

  it('ab dem Versand: nur Versand und Warten', () => {
    const verdict = evaluateUpgrade(waitingAfterSimulation(), edges, 'ask');
    expect(verdict).toEqual({ ok: true, resetKeys: ['ask', 'wait', 'review'] });
  });

  it('wurde schon echt gesendet, wird nichts wiederholt (nie doppelt senden)', () => {
    const nodes = waitingAfterSimulation().map((n) => (n.key === 'ask' ? { ...n, executionMode: 'LIVE' } : n));
    const verdict = evaluateUpgrade(nodes, edges, 'extract');
    expect(verdict).toMatchObject({ ok: false, reason: 'Die Nachricht wurde bereits echt gesendet.' });
  });

  it('ist danach schon ein Angebot entstanden oder hat eine Person gearbeitet, bleibt der Schritt ehrlich simuliert', () => {
    const quoted = waitingAfterSimulation().map((n) => (n.key === 'quote' ? { ...n, state: 'SUCCEEDED', executionMode: 'LIVE' } : n));
    expect(evaluateUpgrade(quoted, edges, 'extract')).toMatchObject({ ok: false, reason: expect.stringContaining('quote') });
    const manual = waitingAfterSimulation().map((n) => (n.key === 'review' ? { ...n, state: 'WAITING' } : n));
    expect(evaluateUpgrade(manual, edges, 'extract')).toMatchObject({ ok: false, reason: expect.stringContaining('Person') });
  });

  it('ein laufender oder ungewisser Schritt verhindert die Wiederholung', () => {
    expect(evaluateUpgrade(waitingAfterSimulation().map((n) => (n.key === 'ask_draft' ? { ...n, state: 'RUNNING' } : n)), edges, 'extract')).toMatchObject({ ok: false, reason: expect.stringContaining('läuft gerade') });
    expect(evaluateUpgrade(waitingAfterSimulation().map((n) => (n.key === 'ask' ? { ...n, state: 'OUTCOME_UNKNOWN' } : n)), edges, 'extract')).toMatchObject({ ok: false, reason: expect.stringContaining('ungewiss') });
  });

  it('ein noch nicht gesendeter Versand (wartet auf Freigabe) darf zurückgesetzt werden', () => {
    const nodes = waitingAfterSimulation().map((n) => (n.key === 'ask' ? { ...n, state: 'AWAITING_APPROVAL', executionMode: null } : n.key === 'wait' ? { ...n, state: 'PLANNED' } : n));
    expect(evaluateUpgrade(nodes, edges, 'extract')).toMatchObject({ ok: true });
  });

  it('Hilfsfunktionen: Nachfolger, Reihenfolge, reservierte Testadressen', () => {
    expect([...downstreamOf('ask', edges)].slice(0, 3)).toEqual(['wait', 'extract2', 'reqs2']);
    expect(earliestFirst(['ask', 'extract', 'reqs'], edges, waitingAfterSimulation().map((n) => n.key))).toEqual(['extract', 'reqs', 'ask']);
    for (const address of ['a@example.com', 'a@firma-meier.example', 'a@kunde.invalid', 'a@x.test', 'a@localhost', 'a@sub.example.org']) expect(isReservedTestAddress(address)).toBe(true);
    for (const address of ['kunde@gmail.com', 'info@musterwerk.de', 'a@examples.de', 'kein-at-zeichen']) expect(isReservedTestAddress(address)).toBe(false);
  });
});
