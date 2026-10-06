import { describe, expect, it } from 'vitest';
import { RESOLUTION_LADDER, describeResolutionAttempt, resolutionAttemptFor, resolutionDedupeKey } from './resolution';

describe('Auflösungsleiter (Amendment 02 v1.2 §30, BP-32)', () => {
  const external = { externalClarificationAvailable: true };

  it('eine Angabe aus der Nachricht ist über „Kommunikation“ geklärt – ohne Rückfrage und ohne Mensch', () => {
    const attempt = resolutionAttemptFor('request.product_sku', 'SATISFIED', [{ id: 'f1', status: 'CONFIRMED', sourceType: 'EMAIL' }], external);
    expect(attempt).toMatchObject({ strategy: 'COMMUNICATION', result: 'SATISFIED', nextAllowedStrategies: [], evidenceRefs: ['f1'] });
    expect(attempt.triedStrategies).toEqual(['CASE_FACT', 'COMMUNICATION']);
  });

  it('eine Angabe aus dem Fachsystem ist über „System of Record“ geklärt (R2), eine bestätigte Angabe durch einen Menschen über „Klärung“', () => {
    expect(resolutionAttemptFor('customer.id', 'SATISFIED', [{ id: 'f2', status: 'CONFIRMED', sourceType: 'SYSTEM_OF_RECORD' }], external)).toMatchObject({ strategy: 'SYSTEM_OF_RECORD', result: 'SATISFIED' });
    expect(resolutionAttemptFor('request.quantity', 'SATISFIED', [{ id: 'f3', status: 'CONFIRMED', sourceType: 'HUMAN' }], external)).toMatchObject({ strategy: 'HUMAN_REVIEW', result: 'SATISFIED' });
  });

  it('fehlt eine Angabe, ist die externe Sachrückfrage die nächste zulässige Stufe – der Mensch erst danach', () => {
    const attempt = resolutionAttemptFor('request.quantity', 'MISSING', [], external);
    expect(attempt).toMatchObject({ result: 'NOT_FOUND', nextAllowedStrategies: ['EXTERNAL_CLARIFICATION', 'HUMAN_REVIEW'] });
    expect(attempt.triedStrategies).toEqual(['CASE_FACT', 'COMMUNICATION']);
  });

  it('ist keine externe Rückfrage möglich (Capability/Policy/Limit), bleibt nur die menschliche Klärung', () => {
    expect(resolutionAttemptFor('request.quantity', 'MISSING', [], { externalClarificationAvailable: false }).nextAllowedStrategies).toEqual(['HUMAN_REVIEW']);
  });

  it('ein unbestätigter Kandidat zählt nicht als Auflösung', () => {
    const attempt = resolutionAttemptFor('request.quantity', 'INVALID', [{ id: 'f4', status: 'CANDIDATE', sourceType: 'EMAIL' }], external);
    expect(attempt.result).toBe('NOT_FOUND');
    expect(attempt.evidenceRefs).toEqual(['f4']);
  });

  it('ein Widerspruch geht nie an eine automatische Rückfrage, sondern an einen Menschen', () => {
    expect(resolutionAttemptFor('request.quantity', 'CONFLICTED', [{ id: 'a', status: 'CONFLICTED', sourceType: 'EMAIL' }, { id: 'b', status: 'CONFLICTED', sourceType: 'EMAIL' }], external)).toMatchObject({ result: 'CONFLICT', nextAllowedStrategies: ['HUMAN_REVIEW'] });
  });

  it('die Leiter ist geordnet: Fakt → Kommunikation → System → Quelle → Rückfrage → Mensch', () => {
    expect(RESOLUTION_LADDER).toEqual(['CASE_FACT', 'COMMUNICATION', 'SYSTEM_OF_RECORD', 'AUTHORIZED_SOURCE', 'EXTERNAL_CLARIFICATION', 'HUMAN_REVIEW']);
  });

  it('derselbe Faktenstand ergibt denselben Schlüssel (kein Protokollspam), ein neuer Stand einen neuen', () => {
    const a = resolutionAttemptFor('k', 'MISSING', [], external);
    expect(resolutionDedupeKey('c1', a)).toBe(resolutionDedupeKey('c1', resolutionAttemptFor('k', 'MISSING', [], external)));
    expect(resolutionDedupeKey('c1', a)).not.toBe(resolutionDedupeKey('c2', a));
    expect(resolutionDedupeKey('c1', a)).not.toBe(resolutionDedupeKey('c1', resolutionAttemptFor('k', 'SATISFIED', [{ id: 'x', status: 'CONFIRMED', sourceType: 'EMAIL' }], external)));
  });

  it('die Historienzeile ist fachlich und nennt den nächsten Schritt', () => {
    expect(describeResolutionAttempt(resolutionAttemptFor('request.quantity', 'MISSING', [], external))).toBe('Angabe „request.quantity“: nicht gefunden – nächster Schritt: Rückfrage beim Geschäftspartner');
    expect(describeResolutionAttempt(resolutionAttemptFor('request.product_sku', 'SATISFIED', [{ id: 'f1', status: 'CONFIRMED', sourceType: 'EMAIL' }], external))).toContain('geklärt über frühere Nachricht');
    expect(describeResolutionAttempt(resolutionAttemptFor('k', 'CONFLICTED', [], external))).toContain('widersprüchlich');
  });
});
