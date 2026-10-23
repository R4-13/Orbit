import { describe, expect, it } from 'vitest';
import { hasQualifier, insertedQualifiers, isHedged, omittedQualifiers, qualifierMarkers } from './meaning-guard';

describe('Sinnerhalt: Einschränkungen erkennen', () => {
  it('erkennt Verneinung, Bedingung, Gegensatz und Begrenzung unabhängig von der Wortform', () => {
    expect(qualifierMarkers('Wir brauchen keine Rechnung, außer sie ist falsch.')).toEqual(['ausser', 'kein']);
    expect(qualifierMarkers('Das gilt nur, falls jemand da ist, spätestens bis Freitag.')).toEqual(['grenze', 'nur', 'wenn']);
    expect(qualifierMarkers('Termin ohne Anfahrtskosten, aber nicht vor 9 Uhr.')).toEqual(['aber', 'grenze', 'nicht', 'ohne']);
    expect(qualifierMarkers('Bitte den Termin verschieben.')).toEqual([]);
    expect(hasQualifier('Wir kommen niemals vor acht.')).toBe(true);
  });

  it('keine, keinen, kein sind dieselbe Verneinung', () => {
    expect(qualifierMarkers('keinen Termin')).toEqual(qualifierMarkers('kein Termin'));
  });

  it('ausgelassen und eingefügt sind getrennte Befunde', () => {
    expect(omittedQualifiers('Heizung tauschen', 'Heizung tauschen, aber nicht vor dem Winter')).toEqual(['aber', 'grenze', 'nicht']);
    expect(insertedQualifiers('Heizung nicht tauschen', 'Heizung tauschen')).toEqual(['nicht']);
    expect(omittedQualifiers('Heizung tauschen', 'Heizung tauschen')).toEqual([]);
  });

  it('Vorbehalt: Bedingung, Vermutung, Alternative, Begrenzung', () => {
    expect(isHedged('Es sind 140 m², falls der Keller mitzählt.')).toBe(true);
    expect(isHedged('Es sind vermutlich 140 m².')).toBe(true);
    expect(isHedged('Es sind 140 oder 150 m².')).toBe(true);
    expect(isHedged('Es sind 140 m².')).toBe(false);
  });
});
