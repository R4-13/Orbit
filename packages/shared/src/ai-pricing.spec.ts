import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_OUTPUT_TOKENS, MODEL_PRICE_CATALOG, actualCost, costProfileOf, findModelPrice, inputTokensUpperBound, tierFor, worstCaseCost } from './ai-pricing';

const luna = costProfileOf('openai', 'gpt-6-luna')!;

describe('Preiskatalog und Kostenrechnung', () => {
  it('jeder Katalogeintrag nennt Quelle (Adresse), Prüfdatum und eine Währung', () => {
    for (const entry of MODEL_PRICE_CATALOG) {
      expect(entry.source.url).toMatch(/^https:\/\//);
      expect(entry.source.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.profile.currency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('das konfigurierte Modell hat den amtlichen Preis; ein unbekanntes Modell hat keinen (kein Raten)', () => {
    expect(findModelPrice('openai', 'gpt-6-luna')?.profile).toMatchObject({ inputPerMtok: 0.1, outputPerMtok: 0.5, currency: 'USD' });
    expect(costProfileOf('openai', 'gpt-unbekannt')).toBeNull();
    expect(costProfileOf('openai', undefined)).toBeNull();
  });

  it('eine vollständige Überschreibung aus der Umgebung geht vor dem Katalog, eine unvollständige gilt nicht', () => {
    expect(costProfileOf('openai', 'gpt-6-luna', { inputPerMtok: 1, outputPerMtok: 2, currency: 'eur' })).toEqual({ currency: 'EUR', inputPerMtok: 1, outputPerMtok: 2 });
    expect(costProfileOf('openai', 'gpt-6-luna', { inputPerMtok: 1, outputPerMtok: null, currency: 'EUR' })).toBe(luna);
    expect(costProfileOf('openai', 'gpt-x', { inputPerMtok: 1, outputPerMtok: 2 })).toBeNull();
  });

  it('tatsächliche Kosten: Token mal Preis; ohne gemeldete Token null (nie 0 unterstellt); darüber die höhere Stufe', () => {
    expect(actualCost({ inputTokens: 272_000, outputTokens: 1_000_000 }, luna)).toBeCloseTo(0.0272 + 0.5, 9);
    expect(actualCost({ inputTokens: 3_350, outputTokens: 300 }, luna)).toBeCloseTo(0.000485, 9);
    expect(actualCost({ inputTokens: 10 }, luna)).toBeNull();
    expect(actualCost(undefined, luna)).toBeNull();
    expect(tierFor(luna, 272_000)).toBe(luna);
    expect(actualCost({ inputTokens: 272_001, outputTokens: 0 }, luna)).toBeCloseTo((272_001 * 0.2) / 1_000_000, 9);
  });

  it('schlimmster Fall: pessimistische Eingabe plus volle Ausgabegrenze – nie unter den tatsächlichen Kosten eines gewöhnlichen Aufrufs', () => {
    const request = { systemPrompt: 'x'.repeat(2_000), messages: [{ content: 'y'.repeat(8_000) }], tools: [{ name: 't' }] };
    const worst = worstCaseCost(luna, request);
    expect(inputTokensUpperBound(request)).toBeGreaterThanOrEqual(5_000);
    expect(worst).toBeGreaterThan(actualCost({ inputTokens: 3_000, outputTokens: 600 }, luna)!);
    expect(worst).toBeCloseTo((inputTokensUpperBound(request) * 0.1 + DEFAULT_MAX_OUTPUT_TOKENS * 0.5) / 1_000_000, 9);
    expect(worstCaseCost(luna, { ...request, maxTokens: 100 })).toBeLessThan(worst);
  });
});
