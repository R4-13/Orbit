import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BlueprintDefinitionSchema,
  DEFAULT_CAPABILITIES,
  effectiveLimits,
  nextActions,
  validateBlueprintDefinition,
  validatePlan,
  type BlueprintDefinition,
  type NodeState,
  type PlanNode,
  type PlanValidationContext,
  type RuntimeEdge,
  type RuntimeNode,
} from '@orbit/shared';

const FIXTURE = join(__dirname, '../../../../../fixtures/process/request-for-quote.handoff.blueprint.json');
const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const blueprint: BlueprintDefinition = BlueprintDefinitionSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
const graph = blueprint.referenceGraph as NonNullable<BlueprintDefinition['referenceGraph']>;

const ALL = [...catalogue.keys()];
const validationContext = (unavailable: string[] = []): PlanValidationContext => ({
  blueprint,
  capabilities: catalogue,
  executability: new Map(ALL.map((key) => [key, { executable: !unavailable.includes(key), reasons: unavailable.includes(key) ? ['nicht angebunden'] : [] }])),
  knownFactKeys: new Set(['contact.email']),
  collectableFactKeys: new Set(blueprint.requiredFacts.map((f) => f.key)),
  policyModes: new Map([...catalogue.values()].flatMap((c) => [[c.policyAction, 'AUTONOMOUS' as const], ...Object.values(c.policyActionByPurpose ?? {}).map((a) => [a, 'AUTONOMOUS' as const])] as Array<[string, 'AUTONOMOUS']>)),
  limits: (({ maxSteps, maxExternalActions, maxAutoQuestions }) => ({ maxSteps, maxExternalActions, maxAutoQuestions }))(effectiveLimits(blueprint.limits)),
});
const proposal = () => ({ goalKeys: blueprint.goals, nodes: graph.nodes, edges: graph.edges, unresolvedRequirements: [], assumptions: [], conciseExplanation: 'Standardablauf' });
const errorCodes = (result: ReturnType<typeof validatePlan>) => result.issues.filter((i) => i.severity === 'ERROR').map((i) => `${i.code}:${i.nodeId ?? ''}`);

interface Script {
  /** Fähigkeiten, die der Betrieb tatsächlich ausführen kann. */
  available: string[];
  /** Ergebnis der Prüfung „alles Nötige da?“ bei der 1., 2., … Auswertung. */
  complete: boolean[];
  /** Was auf jede Rückfrage folgt. */
  waits: Array<'ANSWER' | 'TIMEOUT'>;
  /** Ob die Kundschaft einen Termin gewählt hat (Fakt appointment.agreed) und die Buchung gelingt. */
  appointment?: 'BOOKED' | 'CHOSEN_BUT_REFUSED' | 'NONE';
  /** Die Kundschaft hat eine Preisfrage gestellt; die Auskunft aus dem Betriebswissen ist beantwortbar oder nicht. */
  price?: 'ANSWERABLE' | 'NOT_ANSWERABLE';
}

/** Spielt den Ablauf nach den Regeln der Engine (`nextActions`) durch und liefert die ausgeführten Schritte. */
function simulate(script: Script): { executed: string[]; skipped: string[] } {
  const state = new Map<string, NodeState>(graph.nodes.map((n) => [n.id, 'PLANNED']));
  const outputs: Record<string, unknown> = {};
  const executed: string[] = [];
  let evaluation = 0;
  const waits = [...script.waits];
  const nodes = (): RuntimeNode[] => graph.nodes.map((n) => ({ key: n.id, state: state.get(n.id) as NodeState, definition: n as PlanNode }));
  const edges: RuntimeEdge[] = graph.edges.map((e) => ({ key: e.id, source: e.source, target: e.target, condition: e.condition }));
  for (let guard = 0; guard < 200; guard += 1) {
    const ctx = {
      facts: { 'contact.email': 'kunde@example.test', ...(script.appointment && script.appointment !== 'NONE' ? { 'appointment.agreed': 'Dienstag 10 Uhr' } : {}), ...(script.price ? { 'request.price_question': 'Was kostet das?' } : {}) },
      stepOutputs: outputs,
      config: {},
      sourceRefs: {},
      requirements: {},
      capabilities: new Set(script.available),
      receipts: new Set<string>(),
    };
    const actions = nextActions(nodes(), edges, ctx);
    if (actions.length === 0) break;
    for (const action of actions) {
      if (action.action === 'SKIP') {
        state.set(action.nodeKey, 'SKIPPED');
        continue;
      }
      if (action.action === 'BLOCK') throw new Error(`blockiert: ${action.nodeKey} – ${action.reason}`);
      executed.push(action.nodeKey);
      if (/^reqs\d*$/.test(action.nodeKey)) {
        outputs[action.nodeKey] = { complete: script.complete[Math.min(evaluation, script.complete.length - 1)], missing: [] };
        evaluation += 1;
      } else if (/^wait\d$/.test(action.nodeKey)) {
        if (waits.shift() === 'TIMEOUT') {
          state.set(action.nodeKey, 'SKIPPED'); // Wartezeit abgelaufen: der Schritt ist als optional gekennzeichnet und entfällt
          continue;
        }
        outputs[action.nodeKey] = { eventId: `ev-${action.nodeKey}` };
      } else if (action.nodeKey === 'book') {
        if (script.appointment !== 'BOOKED') {
          state.set('book', 'SKIPPED'); // Buchung nicht möglich: optional, entfällt
          continue;
        }
        outputs.book = { eventId: 'cal-1', start: '2026-10-20T08:00:00Z', end: '2026-10-20T09:00:00Z', kind: 'SITE_VISIT' };
      } else if (action.nodeKey === 'kb') {
        outputs.kb = { answerable: script.price === 'ANSWERABLE', answer: script.price === 'ANSWERABLE' ? 'Preise nennen wir nach Besichtigung.' : '' };
      } else if (action.nodeKey === 'lead') {
        outputs.lead = { leadId: 'lead-1' };
      } else {
        outputs[action.nodeKey] = { draftId: `draft-${action.nodeKey}` };
      }
      state.set(action.nodeKey, 'SUCCEEDED');
    }
  }
  return { executed, skipped: [...state].filter(([, s]) => s === 'SKIPPED').map(([id]) => id) };
}

const FULL = ['context.lookup', 'facts.extract_from_message', 'requirements.resolve', 'communication.draft', 'email.send', 'calendar.book', 'crm.lead.create', 'staff.notify'];
const asked = (executed: string[]) => executed.filter((id) => /^ask\d$/.test(id));

describe('Blueprint „Anfrage aufnehmen und übergeben“', () => {
  it('besteht die Blueprint-Prüfung und verspricht kein Angebot, keinen Preis und keinen Empfänger', () => {
    const result = validateBlueprintDefinition(JSON.parse(readFileSync(FIXTURE, 'utf8')), catalogue);
    expect(result.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    const text = readFileSync(FIXTURE, 'utf8');
    expect(text).not.toMatch(/pricing\.resolve|quote\.(create|render)/);
    expect(text).not.toMatch(/@/);
    expect(blueprint.dynamicRequirements?.outcome).toBe('HANDOFF');
  });

  it('ist als Plan zulässig – zwei Klärungsrunden, höchstens sechs externe Aktionen', () => {
    const result = validatePlan(proposal(), validationContext());
    expect(errorCodes(result)).toEqual([]);
    expect(result.stats).toMatchObject({ clarifications: 2, externalActions: 6 });
  });

  it('bleibt auch für Betriebe ohne Kalender zulässig (der Buchungsschritt entfällt dort), nicht aber ohne die Übergabe selbst', () => {
    expect(errorCodes(validatePlan(proposal(), validationContext(['calendar.book'])))).toEqual([]);
    expect(errorCodes(validatePlan(proposal(), validationContext(['crm.lead.create'])))).toEqual(['CAPABILITY_NOT_EXECUTABLE:lead']);
    expect(errorCodes(validatePlan(proposal(), validationContext(['email.send'])))).toContain('CAPABILITY_NOT_EXECUTABLE:ask1');
  });

  it('eine dritte Klärungsrunde wäre über der Grenze dieses Ablaufs', () => {
    const extra = { ...proposal(), nodes: [...graph.nodes, { ...(graph.nodes.find((n) => n.id === 'ask2') as PlanNode), id: 'ask3' }] };
    expect(errorCodes(validatePlan(extra, validationContext()))).toContain('LIMIT_QUESTIONS:');
  });

  describe('Ablauf nach den Regeln der Engine', () => {
    it('ist alles da, wird nicht gefragt: sofort Übergabe, Benachrichtigung und Eingangsbestätigung', () => {
      const { executed } = simulate({ available: FULL, complete: [true], waits: [] });
      expect(asked(executed)).toEqual([]);
      expect(executed).toEqual(['interpret', 'context', 'extract', 'reqs', 'lead', 'notify', 'ack_draft', 'ack', 'done']);
    });

    it('wird nach der ersten Antwort alles klar, folgt keine zweite Runde', () => {
      const { executed, skipped } = simulate({ available: FULL, complete: [false, true], waits: ['ANSWER'] });
      expect(asked(executed)).toEqual(['ask1']);
      expect(executed).toContain('reqs2');
      expect(skipped).toEqual(expect.arrayContaining(['ask2', 'wait2']));
      expect(executed.indexOf('lead')).toBeGreaterThan(executed.indexOf('reqs2'));
    });

    it('fehlt auch nach zwei Antworten noch etwas, wird nicht weiter gefragt: die Anfrage geht mit den offenen Punkten an einen Menschen', () => {
      const { executed } = simulate({ available: FULL, complete: [false, false, false], waits: ['ANSWER', 'ANSWER'] });
      expect(asked(executed)).toEqual(['ask1', 'ask2']);
      expect(executed).toEqual(expect.arrayContaining(['lead', 'notify', 'done']));
      expect(executed.indexOf('lead')).toBeGreaterThan(executed.indexOf('reqs3'));
    });

    it('bleibt die Antwort aus, entfallen die weiteren Runden – die Anfrage wird mit dem übergeben, was vorliegt', () => {
      const { executed } = simulate({ available: FULL, complete: [false, false], waits: ['TIMEOUT'] });
      expect(asked(executed)).toEqual(['ask1']);
      expect(executed).not.toContain('extract2');
      expect(executed).toEqual(expect.arrayContaining(['lead', 'notify', 'ack', 'done']));
    });

    it('mit Kalender und gewähltem Termin: Buchung, Terminbestätigung statt Eingangsbestätigung', () => {
      const { executed } = simulate({ available: FULL, complete: [false, true], waits: ['ANSWER'], appointment: 'BOOKED' });
      expect(executed).toEqual(expect.arrayContaining(['book', 'confirm_draft', 'confirm', 'lead']));
      expect(executed).not.toContain('ack');
      expect(executed.indexOf('book')).toBeLessThan(executed.indexOf('lead')); // die Übergabe nennt den gebuchten Termin
    });

    it('ohne angebundenen Kalender entfällt die Buchung von selbst; der Wunsch geht in die Übergabe, die Kundschaft bekommt die Eingangsbestätigung', () => {
      const { executed, skipped } = simulate({ available: FULL.filter((c) => c !== 'calendar.book'), complete: [false, true], waits: ['ANSWER'], appointment: 'CHOSEN_BUT_REFUSED' });
      expect(skipped).toEqual(expect.arrayContaining(['book', 'confirm_draft', 'confirm']));
      expect(executed).toEqual(expect.arrayContaining(['lead', 'ack']));
    });

    it('lehnt der Kalender die Buchung ab (z. B. Terminwahl nicht eindeutig), geht der Wunsch ebenso an die zuständige Person', () => {
      const { executed, skipped } = simulate({ available: FULL, complete: [false, true], waits: ['ANSWER'], appointment: 'CHOSEN_BUT_REFUSED' });
      expect(skipped).toContain('confirm');
      expect(executed).toEqual(expect.arrayContaining(['book', 'lead', 'ack']));
    });

    it('mit Preisfrage und gesicherter Auskunft: die Auskunft geht hinaus, die Eingangsbestätigung entfällt (sie ist darin enthalten)', () => {
      const { executed, skipped } = simulate({ available: FULL, complete: [true], waits: [], price: 'ANSWERABLE' });
      expect(executed).toEqual(expect.arrayContaining(['lead', 'kb', 'info_draft', 'info']));
      expect(skipped).toEqual(expect.arrayContaining(['ack_draft', 'ack']));
      expect(executed.indexOf('info')).toBeGreaterThan(executed.indexOf('lead'));
    });

    it('mit Preisfrage ohne gesicherte Auskunft: keine Auskunft aus dem Nichts – es bleibt bei der Eingangsbestätigung, die Frage steht im Lead als offen', () => {
      const { executed, skipped } = simulate({ available: FULL, complete: [true], waits: [], price: 'NOT_ANSWERABLE' });
      expect(skipped).toEqual(expect.arrayContaining(['info_draft', 'info']));
      expect(executed).toEqual(expect.arrayContaining(['kb', 'ack_draft', 'ack']));
    });

    it('ohne Preisfrage entfällt der Auskunftsteil ganz', () => {
      const { executed, skipped } = simulate({ available: FULL, complete: [true], waits: [] });
      expect(skipped).toEqual(expect.arrayContaining(['kb', 'info_draft', 'info']));
      expect(executed).not.toContain('kb');
    });

    it('der Abschluss verlangt die Übergabe: erst der bestätigte Nachweis der Übergabe erfüllt das Kriterium', () => {
      expect(blueprint.completionCriteria).toEqual({ receiptConfirmed: { purpose: 'CRM_HANDOFF' } });
    });
  });
});
