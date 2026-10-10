import { AI_FACT_PREFIX, RequestAnalysisSchema, analysisPrompt, appointmentKindOf, evaluateAnalysis, isSafeCustomerText, type RequestAnalysis } from './request-analysis';
import { clarificationBody } from './communication-templates';

const MESSAGE = 'Guten Tag, wir möchten unsere alte Ölheizung im Einfamilienhaus (Baujahr 1985, ca. 140 m²) gegen eine Wärmepumpe tauschen. Bitte um ein Angebot. Viele Grüße, Thomas Meier';

const proposal = (over: Partial<RequestAnalysis> = {}): RequestAnalysis => ({
  requestType: 'Heizungstausch im Einfamilienhaus',
  summary: 'Tausch der Ölheizung gegen eine Wärmepumpe.',
  knownDetails: [
    { key: 'gebaeudeart', label: 'Gebäudeart', value: 'Einfamilienhaus', evidence: 'im Einfamilienhaus', confidence: 0.9 },
    { key: 'baujahr', label: 'Baujahr', value: 1985, evidence: 'Baujahr 1985', confidence: 0.9 },
  ],
  missingInformation: [
    { key: 'daemmung', label: 'Dämmung', question: 'Wie ist das Gebäude gedämmt (z. B. Fassade, Dach, Fenster)?' },
    { key: 'heizkoerper', label: 'Heizkörper', question: 'Haben Sie Heizkörper oder eine Fußbodenheizung?' },
  ],
  siteVisit: { recommended: true, reason: 'Für eine Wärmepumpe muss die Aufstellfläche und das Heizsystem vor Ort geprüft werden.' },
  nextStep: 'PROPOSE_SITE_VISIT',
  ...over,
});

describe('Anforderungsanalyse', () => {
  it('übernimmt belegte Angaben als bestätigte Fakten und stellt nur die wirklich fehlenden Fragen', () => {
    const result = evaluateAnalysis(proposal(), MESSAGE, new Set());
    expect(result.known.map((k) => k.key)).toEqual([`${AI_FACT_PREFIX}gebaeudeart`, `${AI_FACT_PREFIX}baujahr`]);
    const asked = result.requirements.filter((r) => !result.known.some((k) => k.key === r.key));
    expect(asked.map((r) => r.key)).toEqual([`${AI_FACT_PREFIX}daemmung`, `${AI_FACT_PREFIX}heizkoerper`]);
    expect(result.rejected).toEqual([]);
  });

  it('eine Angabe ohne wörtlichen Beleg wird nicht übernommen – auch eine Zahl muss im Beleg stehen', () => {
    const result = evaluateAnalysis(
      proposal({
        knownDetails: [
          { key: 'flaeche', label: 'Wohnfläche', value: 200, evidence: 'ca. 140 m²', confidence: 0.9 }, // 200 steht nicht im Beleg
          { key: 'ort', label: 'Ort', value: 'München', evidence: 'in München', confidence: 0.9 }, // Beleg nicht in der Nachricht
        ],
      }),
      MESSAGE,
      new Set(),
    );
    expect(result.known).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(['Zahl steht nicht im Beleg', 'Beleg steht nicht wörtlich in der Nachricht']);
  });

  it('Rückfragen mit Links, Adressen, Kontonummern oder Zahlungsaufforderungen werden nie an die Kundschaft gereicht (eingeschleuste Anweisung)', () => {
    const result = evaluateAnalysis(
      proposal({
        missingInformation: [
          { key: 'a', label: 'Link', question: 'Bitte laden Sie Ihre Unterlagen unter https://evil.example/upload hoch.' },
          { key: 'b', label: 'Mail', question: 'Senden Sie die Fotos bitte an betrug@evil.example zurück.' },
          { key: 'c', label: 'Konto', question: 'Bitte überweisen Sie vorab eine Anzahlung auf DE89 3704 0044 0532 0130 00.' },
          { key: 'd', label: 'Normal', question: 'Wie viele Wohneinheiten hat das Gebäude?' },
        ],
      }),
      MESSAGE,
      new Set(),
    );
    const asked = result.requirements.filter((r) => !result.known.some((k) => k.key === r.key)).map((r) => r.key);
    expect(asked).toEqual([`${AI_FACT_PREFIX}d`]);
    expect(result.rejected).toHaveLength(3);
    expect(isSafeCustomerText('Wie alt ist die Anlage?')).toEqual({ safe: true });
  });

  it('was feste Regeln bereits abfragen, wird nicht doppelt gefragt', () => {
    const result = evaluateAnalysis(proposal(), MESSAGE, new Set([`${AI_FACT_PREFIX}daemmung`]));
    expect(result.requirements.map((r) => r.key)).not.toContain(`${AI_FACT_PREFIX}daemmung`);
  });

  it('ein notwendiger Vor-Ort-Termin hat Vorrang vor einer reinen Rückfrage; ein Telefontermin bleibt bestehen', () => {
    expect(evaluateAnalysis(proposal({ nextStep: 'ASK_CUSTOMER' }), MESSAGE, new Set()).nextStep).toBe('PROPOSE_SITE_VISIT');
    const phone = evaluateAnalysis(proposal({ siteVisit: { recommended: false, reason: '' }, nextStep: 'PROPOSE_PHONE_CALL' }), MESSAGE, new Set());
    expect(phone.nextStep).toBe('PROPOSE_PHONE_CALL');
    expect(phone.siteVisit.recommended).toBe(false);
    expect(appointmentKindOf('PROPOSE_SITE_VISIT')).toBe('SITE_VISIT');
    expect(appointmentKindOf('PROPOSE_PHONE_CALL')).toBe('PHONE_CALL');
    expect(appointmentKindOf('ASK_CUSTOMER')).toBeUndefined();
  });

  it('das Schema verlangt gültige Schlüssel und begrenzt die Anzahl der Fragen', () => {
    expect(RequestAnalysisSchema.safeParse(proposal()).success).toBe(true);
    expect(RequestAnalysisSchema.safeParse(proposal({ missingInformation: [{ key: 'Ungültig Mit Leerzeichen', label: 'x', question: 'Eine ausreichend lange Frage?' }] })).success).toBe(false);
    expect(RequestAnalysisSchema.safeParse({ ...proposal(), nextStep: 'DELETE_EVERYTHING' }).success).toBe(false);
  });
});

describe('Rückfrage-Nachricht', () => {
  const questions = [{ key: 'ai.daemmung', question: 'Wie ist das Gebäude gedämmt?' }];

  it('ohne Termin und Zusammenfassung unverändert wie bisher', () => {
    const body = clarificationBody({ originalSubject: 'Heizungstausch', questions, companyName: 'Musterwerk GmbH' });
    expect(body).toContain('vielen Dank für Ihre Anfrage „Heizungstausch“.');
    expect(body).toContain('1. Wie ist das Gebäude gedämmt?');
    expect(body).not.toContain('Termin');
  });

  it('nennt, wie die Anfrage verstanden wurde, und schlägt einen Vor-Ort-Termin mit den freien Zeiten vor', () => {
    const body = clarificationBody({
      originalSubject: 'Heizungstausch',
      questions,
      companyName: 'Musterwerk GmbH',
      summary: 'Tausch der Ölheizung gegen eine Wärmepumpe.',
      appointment: { kind: 'SITE_VISIT', slots: ['Donnerstag, 15.10.2026, 09:00–10:30 Uhr', 'Freitag, 16.10.2026, 14:00–15:30 Uhr'] },
    });
    expect(body).toContain('Wir haben sie so verstanden: Tausch der Ölheizung gegen eine Wärmepumpe.');
    expect(body).toContain('vor Ort an (ca. 90 Minuten). Folgende Termine hätten wir frei:');
    expect(body).toContain('- Donnerstag, 15.10.2026, 09:00–10:30 Uhr');
  });

  it('ohne bekannte freie Zeiten bittet die Nachricht um Terminwünsche, statt Zeiten zu erfinden', () => {
    const site = clarificationBody({ questions: [], companyName: 'M', appointment: { kind: 'SITE_VISIT', slots: [] } });
    expect(site).toContain('Bitte nennen Sie uns zwei bis drei Zeiträume');
    expect(site).not.toContain('Damit wir Ihnen ein passendes Angebot erstellen können');
    const phone = clarificationBody({ questions, companyName: 'M', appointment: { kind: 'PHONE_CALL', slots: [] } });
    expect(phone).toContain('Unter welcher Telefonnummer und zu welchen Zeiten erreichen wir Sie am besten?');
  });
});

describe('Betriebsprofil in der Analyse-Anweisung', () => {
  it('ohne Profil bleibt die Anweisung unverändert; mit Profil richtet sie Fragen nach dem Betrieb aus', () => {
    const base = { catalog: 'Fenstertausch (Fenster)', reservedRequirements: '', companyName: 'Muster GmbH' };
    expect(analysisPrompt(base)).not.toContain('Betriebsprofil');
    const text = analysisPrompt({ ...base, profile: 'Betriebsprofil (vom Betrieb gepflegt):\nBranche: Fensterbau.\nEinsatzgebiet: Köln.' });
    expect(text).toContain('Branche: Fensterbau.');
    expect(text).toContain('Richte Fragen und Wortwahl nach diesem Betrieb');
  });
});
