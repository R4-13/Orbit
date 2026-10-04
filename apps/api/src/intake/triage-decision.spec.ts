import { buildTriageFixture } from '@orbit/shared';
import { CATEGORY_DOMAIN_ROUTES, deriveAppliedRelevance, routeForCategory } from './triage-decision';

const THRESHOLDS = { minConfidence: 0.6, exclusionMinConfidence: 0.85 };

describe('deriveAppliedRelevance (Amendment 02 §3.1/§14.3 — deterministic thresholds over a model proposal)', () => {
  it('acts on a confident RELEVANT proposal', () => {
    const result = buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'REQUEST_FOR_QUOTE', confidence: { relevance: 0.9, intent: 0.9 } });
    expect(deriveAppliedRelevance(result, THRESHOLDS).relevance).toBe('BUSINESS_ACTIONABLE');
  });

  it('sends a RELEVANT proposal below the configured threshold to review, naming both numbers', () => {
    const result = buildTriageFixture({ businessRelevance: 'RELEVANT', confidence: { relevance: 0.4, intent: 0.9 } });
    const applied = deriveAppliedRelevance(result, THRESHOLDS);
    expect(applied.relevance).toBe('UNKNOWN_REQUIRES_REVIEW');
    expect(applied.basis).toContain('0.40');
    expect(applied.basis).toContain('0.6');
  });

  it('honours a different configured threshold instead of a product constant', () => {
    const result = buildTriageFixture({ businessRelevance: 'RELEVANT', confidence: { relevance: 0.7, intent: 0.9 } });
    expect(deriveAppliedRelevance(result, { minConfidence: 0.9, exclusionMinConfidence: 0.95 }).relevance).toBe('UNKNOWN_REQUIRES_REVIEW');
    expect(deriveAppliedRelevance(result, { minConfidence: 0.5, exclusionMinConfidence: 0.95 }).relevance).toBe('BUSINESS_ACTIONABLE');
  });

  it('only hides a NON_BUSINESS input at the stricter exclusion confidence — a wrongly hidden customer request is the costlier error', () => {
    const lowish = buildTriageFixture({ businessRelevance: 'NON_BUSINESS', category: 'NEWSLETTER_OR_MARKETING', confidence: { relevance: 0.8, intent: 0.9 } });
    expect(deriveAppliedRelevance(lowish, THRESHOLDS).relevance).toBe('UNKNOWN_REQUIRES_REVIEW');

    const sure = buildTriageFixture({ businessRelevance: 'NON_BUSINESS', category: 'NEWSLETTER_OR_MARKETING', confidence: { relevance: 0.97, intent: 0.9 } });
    expect(deriveAppliedRelevance(sure, THRESHOLDS).relevance).toBe('NON_ACTIONABLE');
  });

  it('maps a confidently private message to PRIVATE_PERSONAL, other exclusions to NON_ACTIONABLE', () => {
    const priv = buildTriageFixture({ businessRelevance: 'NON_BUSINESS', category: 'PRIVATE', confidence: { relevance: 0.95, intent: 0.9 } });
    expect(deriveAppliedRelevance(priv, THRESHOLDS).relevance).toBe('PRIVATE_PERSONAL');
  });

  it('always reviews an UNCERTAIN proposal, whatever its confidence number says', () => {
    const result = buildTriageFixture({ businessRelevance: 'UNCERTAIN', confidence: { relevance: 0.99, intent: 0.99 } });
    expect(deriveAppliedRelevance(result, THRESHOLDS).relevance).toBe('UNKNOWN_REQUIRES_REVIEW');
  });

  it.each(['PROMPT_INJECTION_SUSPECTED', 'PHISHING_SUSPECTED', 'IDENTITY_MISMATCH'])(
    'a %s risk flag forces human review even for a confident, otherwise actionable proposal',
    (flag) => {
      const result = buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'REQUEST_FOR_QUOTE', confidence: { relevance: 0.99, intent: 0.99 }, riskFlags: [flag] });
      const applied = deriveAppliedRelevance(result, THRESHOLDS);
      expect(applied.relevance).toBe('UNKNOWN_REQUIRES_REVIEW');
      expect(applied.basis).toContain(flag);
    },
  );

  it('does not treat an informational risk flag (e.g. MULTIPLE_INTENTS) as a blocker', () => {
    const result = buildTriageFixture({ businessRelevance: 'RELEVANT', confidence: { relevance: 0.9, intent: 0.9 }, riskFlags: ['MULTIPLE_INTENTS'] });
    expect(deriveAppliedRelevance(result, THRESHOLDS).relevance).toBe('BUSINESS_ACTIONABLE');
  });
});

describe('routeForCategory', () => {
  it('routes only configured categories; everything else has no route (and is therefore reviewed, never hidden)', () => {
    expect(routeForCategory('REQUEST_FOR_QUOTE')).toBe('SALES');
    expect(routeForCategory('INVOICE_RECEIVED')).toBe('FINANCE');
    expect(routeForCategory('COMPLAINT_OR_SERVICE')).toBeUndefined();
    expect(routeForCategory('APPLICATION')).toBeUndefined();
    expect(routeForCategory('UNKNOWN')).toBeUndefined();
    expect(Object.keys(CATEGORY_DOMAIN_ROUTES)).not.toContain('PRIVATE');
  });
});
