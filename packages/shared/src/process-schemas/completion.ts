import { evaluateExpr, type EvalContext, type Expr } from './expressions';

/**
 * Deterministische Abschlussbewertung (Amendment 02 v1.2 §36, BP-40): ein Vorgang gilt erst als abgeschlossen, wenn die Abschlusskriterien des
 * Blueprints **und** – soweit angegeben – die Kriterien jedes einzelnen Ziels nachweislich erfüllt sind. Kein Modell entscheidet darüber. Jede
 * Bewertung wird als Schnappschuss mit Nachweisen festgehalten (Fallereignis `completion.evaluated`), erfüllt oder nicht.
 */
export type GoalStatus = 'ACHIEVED' | 'NOT_ACHIEVED' | 'NOT_EVALUABLE';
export type GoalBasis = 'GOAL_CRITERIA' | 'COMPLETION_CRITERIA';

export interface GoalEvaluation {
  goal: string;
  status: GoalStatus;
  basis: GoalBasis;
}

export interface CompletionEvaluation {
  /** Der Vorgang darf abgeschlossen werden. */
  met: boolean;
  /** Ergebnis der allgemeinen Abschlusskriterien (null = nicht auswertbar). */
  criteriaMet: boolean | null;
  goals: GoalEvaluation[];
  evidenceRefs: string[];
}

export interface CompletionDefinition {
  goals: readonly string[];
  completionCriteria: Expr;
  /** Optionale Kriterien je Ziel; Ziele ohne Eintrag folgen den allgemeinen Abschlusskriterien. */
  goalCriteria?: Readonly<Record<string, Expr>>;
}

function tryEvaluate(expr: Expr, ctx: EvalContext): boolean | null {
  try {
    return evaluateExpr(expr, ctx);
  } catch {
    return null;
  }
}

export function evaluateCompletion(def: CompletionDefinition, ctx: EvalContext, evidenceRefs: readonly string[]): CompletionEvaluation {
  const criteriaMet = tryEvaluate(def.completionCriteria, ctx);
  const goals: GoalEvaluation[] = def.goals.map((goal) => {
    const own = def.goalCriteria?.[goal];
    if (own) {
      const result = tryEvaluate(own, ctx);
      return { goal, basis: 'GOAL_CRITERIA' as const, status: result === null ? ('NOT_EVALUABLE' as const) : result ? ('ACHIEVED' as const) : ('NOT_ACHIEVED' as const) };
    }
    return { goal, basis: 'COMPLETION_CRITERIA' as const, status: criteriaMet === null ? ('NOT_EVALUABLE' as const) : criteriaMet ? ('ACHIEVED' as const) : ('NOT_ACHIEVED' as const) };
  });
  const met = criteriaMet === true && goals.every((g) => g.status === 'ACHIEVED');
  return { met, criteriaMet, goals, evidenceRefs: [...evidenceRefs] };
}

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { ACHIEVED: 'erreicht', NOT_ACHIEVED: 'noch nicht erreicht', NOT_EVALUABLE: 'nicht prüfbar' };

/** Fachliche Zeile für die Vorgangshistorie. */
export function describeCompletionEvaluation(evaluation: Pick<CompletionEvaluation, 'met' | 'goals'>): string {
  const goals = evaluation.goals.map((g) => `${g.goal}: ${GOAL_STATUS_LABELS[g.status]}`).join(' · ');
  return `${evaluation.met ? 'Abschluss geprüft – alle Kriterien erfüllt' : 'Abschluss geprüft – noch nicht erfüllt'}${goals ? ` (${goals})` : ''}`;
}
