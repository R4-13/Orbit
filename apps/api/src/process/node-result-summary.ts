/**
 * Das Ergebnis eines Schritts in Worten für die Vorgangsansicht – nie der Roh-Output (der bleibt der Plattform-Diagnose vorbehalten). Es wird nur
 * beschrieben, was die Person zum Nachvollziehen braucht: was erkannt wurde, was fehlt, welcher nächste Schritt gewählt wurde.
 */
const NEXT_STEP_LABELS: Record<string, string> = {
  ASK_CUSTOMER: 'Rückfragen an die Kundschaft stellen',
  PROPOSE_SITE_VISIT: 'Einen Vor-Ort-Termin vorschlagen',
  PROPOSE_PHONE_CALL: 'Einen Telefontermin vorschlagen',
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const asList = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.map(asRecord).filter((v): v is Record<string, unknown> => v !== undefined) : []);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

export function summarizeNodeResult(capabilityKey: string | undefined, output: unknown): string[] {
  const out = asRecord(output);
  if (!out || !capabilityKey) return [];
  const lines: string[] = [];

  if (capabilityKey === 'requirements.resolve') {
    const analysis = asRecord(out.analysis);
    const missing = asList(out.missing);
    const internal = asList(out.internalMissing);
    if (analysis) {
      const type = text(analysis.requestType);
      const summary = text(analysis.summary);
      if (type) lines.push(`Anfrage erkannt als: ${type}.`);
      if (summary) lines.push(`So wurde sie verstanden: ${summary}`);
      const next = text(analysis.nextStep);
      if (next && NEXT_STEP_LABELS[next]) {
        const site = asRecord(analysis.siteVisit);
        const reason = text(site?.reason);
        lines.push(`Gewählter nächster Schritt: ${NEXT_STEP_LABELS[next]}.${reason && site?.recommended === true ? ` Grund: ${reason}` : ''}`);
      }
    } else {
      lines.push('Geprüft nach den festen Regeln des Prozesses (keine KI-Analyse der Anfrage).');
    }
    const questions = missing.map((m) => text(m.question)).filter((q): q is string => Boolean(q));
    if (questions.length > 0) lines.push(`Wird erfragt (${questions.length}): ${questions.join(' · ')}`);
    else if (out.complete === true) lines.push('Alle benötigten Angaben liegen vor.');
    const internalLabels = internal.map((m) => text(m.question)).filter((q): q is string => Boolean(q));
    if (internalLabels.length > 0) lines.push(`Intern nachzutragen: ${internalLabels.join(' · ')}`);
  }

  if (capabilityKey === 'communication.draft') {
    const appointment = asRecord(out.appointment);
    if (appointment) {
      const kind = appointment.kind === 'PHONE_CALL' ? 'Telefontermin' : 'Vor-Ort-Termin';
      const count = typeof appointment.slotCount === 'number' ? appointment.slotCount : 0;
      lines.push(
        appointment.source === 'GOOGLE_CALENDAR' && count > 0
          ? `Terminvorschlag: ${kind} – ${count} freie ${count === 1 ? 'Zeit' : 'Zeiten'} aus dem verbundenen Kalender in der Nachricht.`
          : `Terminvorschlag: ${kind} – keine Kalenderzeiten verfügbar, die Nachricht bittet um Terminwünsche.`,
      );
    }
  }
  return lines;
}
