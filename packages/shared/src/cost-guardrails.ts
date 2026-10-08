/**
 * Kosten-Leitplanken der KI-Nutzung (Amendment 03 §12.3, FinOps): Warnschwelle, Soft-Limit und – wo das Produkt es zulässt – Hard-Limit, je Plattform, Mandant oder
 * Profil, jeweils für den laufenden Kalendermonat (UTC); dazu eine Erkennung ungewöhnlicher Nutzung. Reine, deterministische Regeln auf echten Messwerten
 * (`AIUsageRecord.estimatedCost`): Aufrufe ohne Kostenprofil haben keinen Betrag und zählen nicht als „0 €“ – sie werden getrennt ausgewiesen.
 */
export const COST_LIMIT_SCOPES = ['GLOBAL', 'TENANT', 'PROFILE'] as const;
export type CostLimitScope = (typeof COST_LIMIT_SCOPES)[number];

export const COST_LIMIT_STATES = ['OK', 'WARNING', 'SOFT_EXCEEDED', 'HARD_EXCEEDED'] as const;
export type CostLimitState = (typeof COST_LIMIT_STATES)[number];

export interface CostLimitDefinition {
  scope: CostLimitScope;
  /** Nur bei `TENANT`. */
  targetTenantId?: string | null;
  /** Nur bei `PROFILE`. */
  profileKey?: string | null;
  warnAmount?: number | null;
  softAmount?: number | null;
  hardAmount?: number | null;
  /** Hard-Limit wird durchgesetzt (neue KI-Aufrufe werden ehrlich abgewiesen); sonst nur gemeldet. */
  hardEnforced: boolean;
}

/** Eindeutiger Schlüssel je Geltungsbereich: es gibt höchstens ein Limit je Bereich. */
export function costLimitScopeKey(limit: Pick<CostLimitDefinition, 'scope' | 'targetTenantId' | 'profileKey'>): string {
  if (limit.scope === 'GLOBAL') return 'GLOBAL';
  if (limit.scope === 'TENANT') return `TENANT:${limit.targetTenantId ?? ''}`;
  return `PROFILE:${limit.profileKey ?? ''}`;
}

/** Gilt das Limit für diesen Aufruf? (Plattformweite Limits gelten für alle.) */
export function costLimitApplies(limit: Pick<CostLimitDefinition, 'scope' | 'targetTenantId' | 'profileKey'>, call: { tenantId: string; profileKey: string }): boolean {
  if (limit.scope === 'GLOBAL') return true;
  if (limit.scope === 'TENANT') return limit.targetTenantId === call.tenantId;
  return limit.profileKey === call.profileKey;
}

/** Zustand eines Limits bei bisher aufgelaufenen Kosten. Die strengste überschrittene Stufe zählt; gleich der Schwelle gilt als überschritten. */
export function costLimitState(spent: number, limit: Pick<CostLimitDefinition, 'warnAmount' | 'softAmount' | 'hardAmount'>): CostLimitState {
  if (limit.hardAmount != null && spent >= limit.hardAmount) return 'HARD_EXCEEDED';
  if (limit.softAmount != null && spent >= limit.softAmount) return 'SOFT_EXCEEDED';
  if (limit.warnAmount != null && spent >= limit.warnAmount) return 'WARNING';
  return 'OK';
}

/** Leere Liste = zulässig. Beträge positiv, Schwellen streng aufsteigend, Bereichsangaben passend zum Bereich, Durchsetzung nur mit Hard-Limit. */
export function validateCostLimit(input: CostLimitDefinition): string[] {
  const issues: string[] = [];
  const amounts = [input.warnAmount, input.softAmount, input.hardAmount];
  if (amounts.every((a) => a == null)) issues.push('Mindestens eine Schwelle (Warnung, Soft- oder Hard-Limit) ist erforderlich.');
  for (const amount of amounts) if (amount != null && !(amount > 0 && Number.isFinite(amount))) issues.push('Beträge müssen größer als 0 sein.');
  const set = amounts.filter((a): a is number => a != null);
  for (let i = 1; i < set.length; i++) if ((set[i] as number) <= (set[i - 1] as number)) issues.push('Die Schwellen müssen aufsteigen: Warnung < Soft-Limit < Hard-Limit.');
  if (input.scope === 'TENANT' && !input.targetTenantId) issues.push('Für ein Mandanten-Limit ist ein Mandant anzugeben.');
  if (input.scope === 'PROFILE' && !input.profileKey) issues.push('Für ein Profil-Limit ist ein Profil anzugeben.');
  if (input.scope !== 'TENANT' && input.targetTenantId) issues.push('Ein Mandant ist nur bei einem Mandanten-Limit zulässig.');
  if (input.scope !== 'PROFILE' && input.profileKey) issues.push('Ein Profil ist nur bei einem Profil-Limit zulässig.');
  if (input.hardEnforced && input.hardAmount == null) issues.push('Ein durchgesetztes Limit braucht ein Hard-Limit.');
  return [...new Set(issues)];
}

/** Beginn des laufenden Kalendermonats (UTC): Limits gelten je Monat. */
export function costPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const COST_STATE_LABELS: Record<CostLimitState, string> = {
  OK: 'Im Rahmen',
  WARNING: 'Warnschwelle erreicht',
  SOFT_EXCEEDED: 'Soft-Limit überschritten',
  HARD_EXCEEDED: 'Hard-Limit überschritten',
};

export interface CostStateChange {
  limitId: string;
  from: CostLimitState | null;
  to: CostLimitState;
}

/**
 * Wechsel, über die jemand informiert werden muss. Wie bei der Laufzeitüberwachung: gleicher Zustand ⇒ nichts; erste Beobachtung „im Rahmen“ ⇒ nichts; erste
 * Beobachtung oberhalb der Schwelle ⇒ Meldung; Rückkehr in den Rahmen (z. B. neuer Monat) ⇒ Meldung.
 */
export function costStateChanges(previous: ReadonlyMap<string, CostLimitState> | undefined, current: ReadonlyArray<{ limitId: string; state: CostLimitState }>): CostStateChange[] {
  const out: CostStateChange[] = [];
  for (const c of current) {
    const from = previous?.get(c.limitId) ?? null;
    if (from === c.state) continue;
    if (from === null && c.state === 'OK') continue;
    out.push({ limitId: c.limitId, from, to: c.state });
  }
  return out;
}

export interface UsageAnomalyInput {
  /** Anrufe und Kosten der letzten 24 Stunden. */
  recent: { requests: number; cost: number };
  /** Anzahl Aufrufe je Tag der sieben Tage davor (ältester zuerst; Tage ohne Nutzung als 0). */
  baselineDailyRequests: readonly number[];
}

export interface UsageAnomaly {
  anomalous: boolean;
  /** Vielfaches der üblichen Tagesnutzung; `null`, wenn es keine Vergleichsbasis gibt. */
  factor: number | null;
  baselineAverage: number;
}

export const ANOMALY_FACTOR = 3;
export const ANOMALY_MIN_REQUESTS = 30;

/**
 * Ungewöhnliche Nutzung: die letzten 24 Stunden liegen deutlich (Standard: ×3) über dem Tagesdurchschnitt der sieben Tage davor **und** erreichen eine
 * Mindestmenge (kleine Zahlen schwanken stark). Ohne Vergleichsbasis (nie genutzt) gilt allein die Mindestmenge nicht als Auffälligkeit, damit eine neue
 * Nutzung nicht sofort alarmiert – dafür gibt es die Limits.
 */
export function detectUsageAnomaly(input: UsageAnomalyInput, factor = ANOMALY_FACTOR, minRequests = ANOMALY_MIN_REQUESTS): UsageAnomaly {
  const days = input.baselineDailyRequests;
  const baselineAverage = days.length === 0 ? 0 : days.reduce((sum, d) => sum + d, 0) / days.length;
  if (baselineAverage <= 0) return { anomalous: false, factor: null, baselineAverage };
  const ratio = input.recent.requests / baselineAverage;
  return { anomalous: input.recent.requests >= minRequests && ratio >= factor, factor: Math.round(ratio * 10) / 10, baselineAverage: Math.round(baselineAverage * 10) / 10 };
}
