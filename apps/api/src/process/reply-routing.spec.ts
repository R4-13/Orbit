import { applyModelDecisions, askedLines, isCourtesy, routeStatements, type RoutingChild } from './reply-routing';

const child = (id: string, own: string, siblings: string[], asked: string[], awaiting: boolean): RoutingChild => ({ id, label: id, scope: { own, siblings }, asked, awaiting });

const rechnung = (awaiting = false) => child('rechnung', 'Eine Kopie der letzten Rechnung für die Steuer erhalten.', ['Wartungstermin verschieben', 'Angebot für einen neuen Heizungsregler'], [], awaiting);
const termin = (awaiting = false) => child('termin', 'Den Wartungstermin vom 28.10. auf den 4.11. verschieben.', ['Kopie der Rechnung', 'Angebot für einen neuen Heizungsregler'], awaiting ? ['Welcher Wartungsvertrag gilt für die Anlage?'] : [], awaiting);
const regler = (asked: string[] = ['Geht es nur um die Lieferung des Reglers oder auch um dessen Einbau?']) =>
  child('regler', 'Ein Angebot für einen neuen Heizungsregler erhalten.', ['Kopie der Rechnung', 'Wartungstermin verschieben'], asked, true);

describe('Zuordnung einer Antwort aus dem Gesprächszusammenhang', () => {
  it('„Bitte beides.“ gehört zur einzigen offenen Rückfrage – ohne gemeinsames Inhaltswort', () => {
    const result = routeStatements(['Bitte beides.'], [rechnung(), termin(), regler()]);
    expect(result.assigned).toEqual([{ text: 'Bitte beides.', childIds: ['regler'], basis: 'ONLY_OPEN_QUESTION' }]);
    expect(result.ambiguous).toEqual([]);
  });

  it('eine kurze Antwort mit einem Wort der gestellten Rückfrage wird dieser Rückfrage zugeordnet, auch bei mehreren offenen', () => {
    const result = routeStatements(['Ja, mit Einbau bitte.'], [rechnung(), termin(true), regler()]);
    expect(result.assigned).toEqual([{ text: 'Ja, mit Einbau bitte.', childIds: ['regler'], basis: 'TOPIC' }]);
  });

  it('bei mehreren offenen Rückfragen und einer Antwort ohne jeden Bezug ist die Zuordnung offen (es wird nachgefragt, nichts geraten)', () => {
    const result = routeStatements(['Bitte beides.'], [rechnung(), termin(true), regler()]);
    expect(result.assigned).toEqual([]);
    expect(result.ambiguous).toEqual([{ text: 'Bitte beides.', candidates: ['termin', 'regler'] }]);
  });

  it('ohne offene Rückfrage bleibt eine Aussage ohne Bezug unzugeordnet (am Hauptvorgang lesbar)', () => {
    const quiet = { ...regler([]), awaiting: false };
    const result = routeStatements(['Bitte beides.'], [rechnung(), termin(), quiet]);
    expect(result.assigned).toEqual([]);
    expect(result.unplaced).toEqual(['Bitte beides.']);
  });

  it('ordnet die Sätze einer gemeinsamen Antwort nach ihrem Gegenstand und lässt Höflichkeit weg', () => {
    const result = routeStatements(['Zur Rechnung: es ist die vom September.', 'Zum Termin: der Wartungstermin war bei Herrn Weber.', 'Vielen Dank!', 'Mit freundlichen Grüßen'], [rechnung(), termin(), regler()]);
    expect(result.assigned.map((a) => [a.childIds, a.basis])).toEqual([[['rechnung'], 'TOPIC'], [['termin'], 'TOPIC']]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it('eine Aussage, die von zwei Gegenständen mit verschiedenen Wörtern spricht, gilt für beide (gemeinsame Angabe)', () => {
    const result = routeStatements(['Rechnung und Wartungstermin bitte an die Hausverwaltung.'], [rechnung(), termin(), regler()]);
    expect(result.assigned).toEqual([{ text: 'Rechnung und Wartungstermin bitte an die Hausverwaltung.', childIds: ['rechnung', 'termin'], basis: 'SHARED' }]);
  });

  it('gleiche Treffer bei zwei Anliegen auf demselben Wort sind nicht zuzuordnen', () => {
    const a = child('a', 'Heizung warten lassen', [], [], false);
    const b = child('b', 'Heizung austauschen lassen', [], [], false);
    const result = routeStatements(['Die Heizung ist von 2012.'], [a, b]);
    expect(result.assigned).toEqual([]);
    expect(result.ambiguous[0]?.candidates).toEqual(['a', 'b']);
  });

  it('Höflichkeitsformeln sind keine Antwort; kurze Antworten schon', () => {
    expect(isCourtesy('Vielen Dank, mit freundlichen Grüßen')).toBe(true);
    expect(isCourtesy('Danke.')).toBe(true);
    expect(isCourtesy('Beides.')).toBe(false);
    expect(isCourtesy('Ja')).toBe(false);
  });

  it('die gestellten Rückfragen eines Entwurfs: nummerierte Zeilen, sonst alle', () => {
    expect(askedLines(['Damit wir Ihre Anfrage gut vorbereiten können, benötigen wir noch folgende Angaben:', '', '1. In welchem Ort befindet sich die Anlage?', '2. Nur Lieferung oder auch Einbau?'])).toEqual(['In welchem Ort befindet sich die Anlage?', 'Nur Lieferung oder auch Einbau?']);
    expect(askedLines(['Welcher Termin passt?'])).toEqual(['Welcher Termin passt?']);
  });
});

describe('Entscheidungen des Modells', () => {
  const open = [{ text: 'Bitte beides.', candidates: ['a', 'b'] }, { text: 'In Köln.', candidates: ['a', 'b'] }];
  it('übernimmt nur eindeutige Entscheidungen mit gültigen Verweisen', () => {
    const result = applyModelDecisions(open, ['a', 'b', 'c'], [
      { statement: 1, concerns: [2], certain: true },
      { statement: 2, concerns: [1, 2], certain: false },
    ]);
    expect(result.assigned).toEqual([{ text: 'Bitte beides.', childIds: ['b'], basis: 'MODEL' }]);
    expect(result.ambiguous).toEqual([open[1]]);
  });

  it('ungültige Verweise und doppelte Entscheidungen werden verworfen; gemeinsame Angaben dürfen mehreren Anliegen gelten', () => {
    const result = applyModelDecisions(open, ['a', 'b'], [
      { statement: 1, concerns: [3], certain: true },
      { statement: 2, concerns: [1, 2], certain: true },
      { statement: 2, concerns: [1], certain: true },
    ]);
    expect(result.assigned).toEqual([{ text: 'In Köln.', childIds: ['a', 'b'], basis: 'MODEL' }]);
    expect(result.ambiguous).toEqual([open[0]]);
  });
});
