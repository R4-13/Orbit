/**
 * Live-Abgleich (reine Entscheidungslogik, ohne Datenbank): ein Schritt, der nur **simuliert** lief oder an einer fehlenden Verbindung hängt, wird
 * wiederholt, sobald der echte Weg verfügbar ist – aber nur, wenn die Wiederholung gefahrlos ist.
 *
 * Gefahrlos heißt: kein Schritt danach hat bereits etwas Unumkehrbares bewirkt (echter Versand, angelegtes Angebot, Aufgabe), keine Person hat danach
 * schon Arbeit erledigt, und nichts ist gerade in Ausführung oder ungewiss. Sonst bliebe der Schritt simuliert – ehrlich gekennzeichnet –, statt
 * dass ORBIT etwas doppelt tut.
 */

/** Welche Fähigkeiten einen echten Weg haben, den ORBIT nachholen kann – und welcher Art er ist. */
export const UPGRADABLE_CAPABILITIES: Readonly<Record<string, 'AI' | 'MAIL'>> = {
  'facts.extract_from_message': 'AI',
  'requirements.resolve': 'AI',
  'email.send': 'MAIL',
};

/**
 * Fähigkeiten, deren erneute Ausführung nichts doppelt bewirkt: Lesen, Auswerten und Entwürfe (neue Version).
 * `pricing.resolve` steht bewusst hier, ist aber nicht aufwertbar: es gibt keine echte Preisquelle.
 */
export const REDO_SAFE_CAPABILITIES: ReadonlySet<string> = new Set(['context.lookup', 'facts.extract_from_message', 'requirements.resolve', 'communication.draft', 'pricing.resolve']);

/** Knotentypen ohne eigene Wirkung nach außen, die beim Zurücksetzen unbedenklich sind. */
const NEUTRAL_NODE_TYPES: ReadonlySet<string> = new Set(['INTERPRET', 'RESOLVE_CONTEXT', 'PREPARE', 'EVALUATE_REQUIREMENTS', 'DECISION', 'REASSESS', 'WAIT_EVENT', 'COMPLETE']);

/** Zustände, in denen ein Schritt nichts bewirkt hat und unberührt bleibt. */
const INERT: ReadonlySet<string> = new Set(['PLANNED', 'READY', 'SUPERSEDED', 'CANCELLED']);

export interface UpgradeNode {
  key: string;
  type: string;
  state: string;
  executionMode?: string | null;
  capabilityKey?: string;
}

export interface UpgradeEdge {
  source: string;
  target: string;
}

export type UpgradeVerdict = { ok: true; resetKeys: string[] } | { ok: false; reason: string };

/** Alle Knoten, die (über Kanten) hinter `startKey` liegen. */
export function downstreamOf(startKey: string, edges: readonly UpgradeEdge[]): Set<string> {
  const out = new Set<string>();
  const queue = [startKey];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.source === current && !out.has(edge.target)) {
        out.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return out;
}

/** Ist dieser Knoten ein simuliertes Ergebnis, das einen echten Weg hat? */
export function isUpgradableSimulation(node: UpgradeNode): boolean {
  return node.state === 'SUCCEEDED' && node.executionMode === 'SIMULATED' && node.capabilityKey !== undefined && node.capabilityKey in UPGRADABLE_CAPABILITIES;
}

/**
 * Darf ab `startKey` wiederholt werden? Liefert die Schritte, die zurückgesetzt werden (der Startschritt und alles dahinter, was schon etwas getan hat
 * oder übersprungen wurde – die Entscheidungen der Bedingungen werden neu getroffen).
 */
export function evaluateUpgrade(nodes: readonly UpgradeNode[], edges: readonly UpgradeEdge[], startKey: string): UpgradeVerdict {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const start = byKey.get(startKey);
  if (!start) return { ok: false, reason: 'Der Schritt existiert nicht.' };
  const affected = [startKey, ...downstreamOf(startKey, edges)].map((key) => byKey.get(key)).filter((n): n is UpgradeNode => n !== undefined);

  for (const node of affected) {
    if (node.state === 'RUNNING') return { ok: false, reason: `„${node.key}“ läuft gerade.` };
    if (node.state === 'OUTCOME_UNKNOWN') return { ok: false, reason: `Das Ergebnis von „${node.key}“ ist ungewiss und muss zuerst abgeglichen werden.` };
    // Unberührte Schritte bleiben, wie sie sind; übersprungene werden zurückgesetzt (ob sie nötig sind, wird neu entschieden), haben aber nichts bewirkt.
    if (INERT.has(node.state) || node.state === 'SKIPPED') continue;

    if (node.capabilityKey === 'email.send') {
      // Eine bereits echt gesendete Nachricht wird nie ein zweites Mal gesendet; eine simulierte (oder noch nicht gesendete) darf nachgeholt werden.
      if (node.state === 'SUCCEEDED' && node.executionMode !== 'SIMULATED') return { ok: false, reason: 'Die Nachricht wurde bereits echt gesendet.' };
      continue;
    }
    if (node.type === 'MANUAL_TASK' || node.type === 'APPROVAL') return { ok: false, reason: `Zu „${node.key}“ gibt es bereits eine Aufgabe oder Entscheidung einer Person.` };
    if (node.capabilityKey !== undefined) {
      if (REDO_SAFE_CAPABILITIES.has(node.capabilityKey)) continue;
      if (node.state === 'SUCCEEDED') return { ok: false, reason: `„${node.key}“ hat bereits etwas angelegt, das nicht doppelt entstehen darf.` };
      continue;
    }
    if (!NEUTRAL_NODE_TYPES.has(node.type)) return { ok: false, reason: `„${node.key}“ kann nicht gefahrlos wiederholt werden.` };
  }

  const resetKeys = affected.filter((n) => n.key === startKey || !INERT.has(n.state)).map((n) => n.key);
  return { ok: true, resetKeys };
}

/** Reservierte Test-Adressen (RFC 2606/6761): dort wohnt nie eine echte Person; ein echter Versand dorthin wäre sinnlos und verschmutzt das Postfach. */
export function isReservedTestAddress(address: string): boolean {
  const domain = address.split('@')[1]?.trim().toLowerCase();
  if (!domain) return false;
  return /(^|\.)example(\.(com|org|net))?$/.test(domain) || /\.(invalid|test|localhost)$/.test(domain) || domain === 'localhost';
}

/** Der frühere Knoten zuerst: nach der Tiefe im Graphen (kürzester Weg von den Wurzeln). */
export function earliestFirst(keys: readonly string[], edges: readonly UpgradeEdge[], allKeys: readonly string[]): string[] {
  const incoming = new Map<string, number>(allKeys.map((k) => [k, 0]));
  for (const e of edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  const depth = new Map<string, number>();
  const queue = allKeys.filter((k) => (incoming.get(k) ?? 0) === 0);
  for (const k of queue) depth.set(k, 0);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const e of edges) {
      if (e.source !== current) continue;
      const next = (depth.get(current) ?? 0) + 1;
      if (next > (depth.get(e.target) ?? -1)) {
        depth.set(e.target, next);
        queue.push(e.target);
      }
    }
  }
  return [...keys].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0));
}
