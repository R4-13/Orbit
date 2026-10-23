import { AI_FACT_PREFIX, RequestAnalysisSchema, isAppointmentSchedulingRequirement, analysisPrompt, appointmentKindOf, evaluateAnalysis, isSafeCustomerText, isSecondReading, type RequestAnalysisInput } from './request-analysis';
import { clarificationBody } from './communication-templates';

const MESSAGE = 'Guten Tag, wir möchten unsere alte Ölheizung im Einfamilienhaus (Baujahr 1985, ca. 140 m²) gegen eine Wärmepumpe tauschen. Bitte um ein Angebot. Viele Grüße, Thomas Meier';

const proposal = (over: Partial<RequestAnalysisInput> = {}): RequestAnalysisInput => ({
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
  siteVisit: { recommended: true, reason: 'Bei der alten Ölheizung im Einfamilienhaus (Baujahr 1985) müssen Aufstellfläche und Leitungswege für die Wärmepumpe vor Ort geprüft werden.' },
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

describe('Rückfragen nur, wenn sie gebraucht werden und nicht beschaffbar sind', () => {
  it('klar außerhalb des Leistungsumfangs gibt es keine Detailfragen zur Ausführung – die Einschätzung bleibt am Ergebnis', () => {
    const result = evaluateAnalysis(proposal({ withinOffering: 'NO' }), MESSAGE, new Set());
    expect(result.requirements.filter((r) => !r.key.startsWith('ai.baujahr') && !r.key.startsWith('ai.gebaeudeart'))).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toContain('Anfrage liegt klar außerhalb des Leistungsumfangs: keine Detailfragen');
    expect(result.withinOffering).toBe('NO');
  });

  it('im Zweifel (UNSURE) oder bei passendem Angebot wird wie bisher gefragt', () => {
    for (const withinOffering of ['UNSURE', 'YES'] as const) {
      expect(evaluateAnalysis(proposal({ withinOffering }), MESSAGE, new Set()).requirements.map((r) => r.key)).toEqual(expect.arrayContaining(['ai.daemmung', 'ai.heizkoerper']));
    }
    expect(evaluateAnalysis(proposal(), MESSAGE, new Set()).requirements.map((r) => r.key)).toContain('ai.daemmung'); // ohne Angabe = UNSURE
  });

  it('eine Angabe, die für den nächsten Schritt nicht gebraucht wird oder aus vorhandenen Quellen beschaffbar ist, wird der Kundschaft nicht abgefragt', () => {
    const result = evaluateAnalysis(
      proposal({
        missingInformation: [
          { key: 'daemmung', label: 'Dämmung', question: 'Wie ist das Gebäude gedämmt (z. B. Fassade, Dach, Fenster)?', neededNow: true, lookupPossible: false },
          { key: 'farbe', label: 'Wunschfarbe', question: 'Welche Farbe sollen die Heizkörper haben?', neededNow: false, lookupPossible: false },
          { key: 'anschrift', label: 'Anschrift', question: 'Wie lautet Ihre Rechnungsanschrift?', neededNow: true, lookupPossible: true },
        ],
      }),
      MESSAGE,
      new Set(),
    );
    expect(result.requirements.filter((r) => r.key.startsWith('ai.') && !['ai.baujahr', 'ai.gebaeudeart'].includes(r.key)).map((r) => r.key)).toEqual(['ai.daemmung']);
    expect(result.rejected.map((r) => r.reason)).toEqual(expect.arrayContaining(['wird für den nächsten Schritt nicht gebraucht', 'ist aus vorhandenen Quellen beschaffbar: die Kundschaft wird nicht gefragt']));
  });
});

describe('Terminfragen als zusätzliche Angabe', () => {
  const base = { requestType: 'Badsanierung', summary: 'Komplettes Bad.', knownDetails: [], siteVisit: { recommended: true, reason: 'Das Bad soll komplett saniert werden; die alten Leitungen müssen vor Ort angesehen werden.' }, nextStep: 'PROPOSE_SITE_VISIT' as const };
  const missing = [
    { key: 'preferred_visit_times', label: 'Mögliche Besichtigungstermine', question: 'Welche Tage oder Zeitfenster passen Ihnen für eine Besichtigung?' },
    { key: 'renovation_period', label: 'Zeitraum der Sanierung', question: 'Für welchen Zeitraum planen Sie die Badsanierung?' },
  ];

  it('erkennt Fragen nach den Terminzeiten, nicht aber nach dem Zeitraum der Leistung', () => {
    expect(isAppointmentSchedulingRequirement(missing[0]!)).toBe(true);
    expect(isAppointmentSchedulingRequirement({ key: 'availability', label: 'Verfügbarkeit' })).toBe(true);
    expect(isAppointmentSchedulingRequirement({ key: 'phone_availability', label: 'Erreichbarkeit' })).toBe(true);
    expect(isAppointmentSchedulingRequirement(missing[1]!)).toBe(false);
    expect(isAppointmentSchedulingRequirement({ key: 'roof_access', label: 'Zugang zum Dach' })).toBe(false);
  });

  it('mit geplantem Termin wird die Terminfrage nicht zusätzlich verlangt (der Termin wird gesondert vereinbart), die übrigen Fragen bleiben', () => {
    const result = evaluateAnalysis({ ...base, missingInformation: missing }, 'Wir wollen unser Bad komplett sanieren, die Leitungen sind alt.', new Set());
    expect(result.requirements.map((r) => r.key)).toEqual(['ai.renovation_period']);
    expect(result.rejected).toEqual([{ what: 'Mögliche Besichtigungstermine', reason: 'Der Termin wird gesondert vereinbart' }]);
  });

  it('ohne Termin bleibt die Frage erhalten (es gibt keine andere Stelle, die sie stellt)', () => {
    const result = evaluateAnalysis({ ...base, siteVisit: { recommended: false, reason: '' }, nextStep: 'ASK_CUSTOMER', missingInformation: missing }, 'Wir wollen unser Bad komplett sanieren, die Leitungen sind alt.', new Set());
    expect(result.requirements.map((r) => r.key)).toEqual(['ai.preferred_visit_times', 'ai.renovation_period']);
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
      appointment: { kind: 'SITE_VISIT', slots: ['Donnerstag, 15.10.2026, 09:00–10:30 Uhr', 'Freitag, 16.10.2026, 14:00–15:30 Uhr'], minutes: 90 },
    });
    expect(body).toContain('Wir haben sie so verstanden: Tausch der Ölheizung gegen eine Wärmepumpe.');
    expect(body).toContain('vor Ort an (ca. 90 Minuten). Folgende Termine hätten wir frei:');
    expect(body).toContain('- Donnerstag, 15.10.2026, 09:00–10:30 Uhr');
  });

  it('bei einer Übergabe steht die KI-Zusammenfassung nicht in der Nachricht an die Kundschaft, und es ist nie von einem Angebot die Rede', () => {
    const body = clarificationBody({
      originalSubject: 'Badsanierung',
      questions,
      companyName: 'Musterwerk GmbH',
      summary: 'Tom bittet um ein Angebot. Der Betrieb nennt keine Preise vorab.',
      appointment: { kind: 'SITE_VISIT', slots: [] },
      intent: 'HANDOFF',
    });
    expect(body).not.toContain('so verstanden');
    expect(body).not.toContain('Der Betrieb nennt');
    expect(body).not.toMatch(/Angebot/);
    expect(body).toContain('Damit wir Ihre Anfrage gut vorbereiten können, benötigen wir noch folgende Angaben:');
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

import { acknowledgementBody, appointmentConfirmationBody, attachmentRequestBody, caseStatusPhrase, informationBody, statusUpdateBody } from './communication-templates';

describe('Weitere Mitteilungen', () => {
  it('die Eingangsbestätigung zitiert den Betreff ohne „Re:“/„AW:“', () => {
    expect(acknowledgementBody({ originalSubject: 'Re: Badsanierung – bitte um Angebot', companyName: 'M' })).toContain('Nachricht zu „Badsanierung – bitte um Angebot“.');
    expect(acknowledgementBody({ originalSubject: 'AW: RE: Heizung', companyName: 'M' })).toContain('zu „Heizung“');
    expect(acknowledgementBody({ originalSubject: 'Re: Heating', companyName: 'M', lang: 'en' })).toContain('regarding "Heating"');
    expect(acknowledgementBody({ originalSubject: 'Rechnung 5', companyName: 'M' })).toContain('zu „Rechnung 5“'); // „Re“ am Wortanfang ohne Doppelpunkt bleibt
  });

  it('die Eingangsbestätigung sagt nur, was stimmt; bei einem Notfall kommt der Hinweis auf den Notruf dazu', () => {
    const normal = acknowledgementBody({ originalSubject: 'Heizung', companyName: 'Muster GmbH' });
    expect(normal).toContain('Sie ist bei uns eingegangen.');
    expect(normal).not.toContain('112');
    expect(normal).not.toMatch(/innerhalb|heute|morgen|Stunden/);
    const emergency = acknowledgementBody({ originalSubject: 'Rohrbruch', companyName: 'Muster GmbH', emergency: true });
    expect(emergency).toContain('als dringend eingestuft');
    expect(emergency).toContain('Notruf 112');
  });

  it('der Stand wird in Worten der Kundschaft ausgedrückt, ohne interne Begriffe', () => {
    for (const status of ['IN_PROGRESS', 'WAITING_FOR_INFORMATION', 'MANUAL_REVIEW', 'COMPLETED', 'CANCELLED', 'UNBEKANNT']) {
      const phrase = caseStatusPhrase(status);
      expect(phrase).toMatch(/^(Ihre Anfrage|Wir warten)/);
      expect(phrase).not.toMatch(/MANUAL|REVIEW|WAITING|Freigabe|Orchestr/);
    }
    const body = statusUpdateBody({ referenceTitle: 'Neue Anfrage: Fenster', status: 'WAITING_FOR_INFORMATION', lastStep: 'Wir haben Ihnen Rückfragen gesendet.', companyName: 'Muster GmbH' });
    expect(body).toContain('„Neue Anfrage: Fenster“');
    expect(body).toContain('Wir warten auf Ihre Rückmeldung');
  });

  it('Anhang anfordern, Auskunft und Terminbestätigung tragen Rahmen und Absender', () => {
    expect(attachmentRequestBody({ originalSubject: 'Rechnung', what: 'der Anhang', companyName: 'Muster GmbH' })).toContain('noch einmal als Antwort');
    expect(informationBody({ answer: 'Wir sind Mo–Fr von 7 bis 16 Uhr erreichbar.', companyName: 'Muster GmbH' })).toContain('Wir sind Mo–Fr von 7 bis 16 Uhr erreichbar.');
    expect(appointmentConfirmationBody({ kind: 'SITE_VISIT', label: 'Do., 15.10.2026, 10:00–11:00 Uhr', companyName: 'Muster GmbH' })).toContain('Vor-Ort-Termin ist bestätigt');
    expect(appointmentConfirmationBody({ kind: 'PHONE_CALL', label: 'Fr., 16.10.2026, 09:00 Uhr', companyName: 'Muster GmbH' })).toContain('Telefontermin ist bestätigt');
  });
});

describe('Terminwahl: nur eine konkrete Angabe zählt', () => {
  it('eine vertagende Antwort ist keine Wahl; konkrete Angaben sind es', async () => {
    const { isConcreteAppointmentChoice } = await import('./request-analysis');
    for (const text of ['Welcher der Termine passt, sage ich Ihnen noch.', 'Den Termin sage ich Ihnen noch.', 'Ich melde mich später mit einem Termin.', 'Das weiß ich noch nicht.', '']) expect(isConcreteAppointmentChoice(text)).toBe(false);
    for (const text of ['Der erste Termin passt mir gut', 'Mittwoch, 21.10. um 9 Uhr', 'Donnerstag Nachmittag wäre gut', 'Am 22.10. ab 14 Uhr', 'Ich bin vormittags erreichbar']) expect(isConcreteAppointmentChoice(text)).toBe(true);
    expect(isConcreteAppointmentChoice('Der zweite Termin passt, den Rest sage ich Ihnen noch.')).toBe(true);
  });
});

describe('Termin: fallbezogene Grundlage, Dauer nur mit Grundlage (Messlauf 21.10.)', () => {
  const PRICE_MESSAGE = 'Hallo, was kostet es ungefähr, vier Heizkörper zu tauschen? Tom';
  const priceProposal = (over: Partial<RequestAnalysisInput> = {}): RequestAnalysisInput => ({
    requestType: 'Preisauskunft Heizkörpertausch',
    summary: 'Die Person möchte eine Größenordnung für den Tausch von vier Heizkörpern.',
    knownDetails: [],
    missingInformation: [],
    siteVisit: { recommended: true, reason: 'Heizkörper tauschen' },
    nextStep: 'PROPOSE_SITE_VISIT',
    inquiryKind: 'PRICE_INFORMATION',
    ...over,
  });

  it('eine reine Preisfrage führt nicht automatisch in den Terminablauf', () => {
    const result = evaluateAnalysis(priceProposal(), PRICE_MESSAGE, new Set());
    expect(result.nextStep).toBe('ASK_CUSTOMER');
    expect(result.siteVisit.recommended).toBe(false);
    expect(result.rejected.map((r) => r.reason)).toContain('Reine Preisfrage: kein automatischer Wechsel in den Terminablauf');
    expect(result.appointmentMinutes).toBeUndefined();
  });

  it('keine pauschale Gegenregel: eine fallbezogene Begründung erlaubt den Vor-Ort-Termin, eine Standardbegründung nicht', () => {
    const generic = evaluateAnalysis(proposal({ siteVisit: { recommended: true, reason: 'Für ein verlässliches Angebot ist eine Besichtigung vor Ort nötig.' } }), MESSAGE, new Set());
    expect(generic.nextStep).toBe('ASK_CUSTOMER');
    expect(generic.rejected.map((r) => r.what)).toContain('Vor-Ort-Termin');
    const specific = evaluateAnalysis(proposal(), MESSAGE, new Set());
    expect(specific.nextStep).toBe('PROPOSE_SITE_VISIT');
    expect(specific.appointmentBasis).toBe('CASE');
  });

  it('die Dauer steht nur mit Grundlage: Betriebsvorgabe oder aus dem Umfang begründet, sonst bleibt sie leer', () => {
    expect(evaluateAnalysis(proposal(), MESSAGE, new Set()).appointmentMinutes).toBeUndefined();
    const reasoned = evaluateAnalysis(proposal({ siteVisit: { recommended: true, reason: 'Bei der alten Ölheizung im Einfamilienhaus müssen Aufstellfläche und Leitungswege geprüft werden.', durationMinutes: 120, durationReason: 'Einfamilienhaus mit 140 m² und Ölheizung: Heizraum, Leitungswege und Aufstellfläche begehen.' } }), MESSAGE, new Set());
    expect(reasoned.appointmentMinutes).toBe(120);
    const unreasoned = evaluateAnalysis(proposal({ siteVisit: { recommended: true, reason: proposal().siteVisit.reason, durationMinutes: 90, durationReason: 'dauert so lange' } }), MESSAGE, new Set());
    expect(unreasoned.appointmentMinutes).toBeUndefined();
    const policy = evaluateAnalysis(proposal(), MESSAGE, new Set(), [], { siteVisit: { minutes: 60, requiredFor: ['Wärmepumpe'] } });
    expect(policy).toMatchObject({ appointmentBasis: 'POLICY', appointmentMinutes: 60 });
  });

  it('die Nachricht nennt die Dauer nur, wenn sie begründet ist', () => {
    const slots = ['Donnerstag, 15.10.2026, ab 09:00 Uhr'];
    const without = clarificationBody({ originalSubject: 'X', questions: [], companyName: 'Musterwerk GmbH', appointment: { kind: 'SITE_VISIT', slots } });
    expect(without).not.toMatch(/Minuten/);
    expect(without).toContain('- Donnerstag, 15.10.2026, ab 09:00 Uhr');
    const withMinutes = clarificationBody({ originalSubject: 'X', questions: [], companyName: 'Musterwerk GmbH', appointment: { kind: 'SITE_VISIT', slots, minutes: 120 } });
    expect(withMinutes).toContain('(ca. 120 Minuten)');
  });
});

describe('Zweite Lesart derselben Aussage (Funktionsnachweis 23.10.)', () => {
  const base = { key: 'ai.quote_request', oldValue: 'Angebot erbeten', newValue: 'bitte um Angebot', fromSameMessage: false, messageHasChangeCue: false };
  it('eine andere Fassung einer Textangabe aus einer späteren Nachricht ohne Änderungshinweis ist nur eine zweite Lesart', () => {
    expect(isSecondReading(base)).toBe(true);
  });
  it('mit Änderungshinweis, aus derselben Nachricht, mit Zahlen oder für andere Schlüssel gilt sie nicht', () => {
    expect(isSecondReading({ ...base, messageHasChangeCue: true })).toBe(false);
    expect(isSecondReading({ ...base, fromSameMessage: true })).toBe(false);
    expect(isSecondReading({ ...base, oldValue: 'Gasheizung von 1985', newValue: 'Gasheizung von 1995' })).toBe(false);
    expect(isSecondReading({ ...base, key: 'request.delivery_address' })).toBe(false);
    expect(isSecondReading({ ...base, newValue: ' angebot erbeten ' })).toBe(false);
  });
});
