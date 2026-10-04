import { z } from 'zod';

/**
 * Amendment 02 §5.2 / §8.6 — central, versioned contract for the semantic
 * triage result. The same schema validates the model output in the API,
 * runs in the worker and types the frontend; unknown execution-relevant
 * fields are rejected (`.strict()`), purely descriptive metadata must use
 * the separate `x-` namespace.
 */
export const TRIAGE_SCHEMA_VERSION = '1.0' as const;

const confidence = z.number().min(0).max(1);

export const FactCandidateSchema = z
  .object({
    /** Registry-style fact key, e.g. `request.product_or_service`. */
    key: z.string().min(1).max(120),
    value: z.unknown(),
    valueSchemaRef: z.string().max(120).optional(),
    unit: z.string().max(40).optional(),
    currency: z.string().length(3).optional(),
    confidence,
    /** References into the supplied evidence (message parts, attachment names) — never invented sources. */
    evidenceRefs: z.array(z.string().max(200)).max(20).default([]),
  })
  .strict();
export type FactCandidate = z.infer<typeof FactCandidateSchema>;

export const TriageIntentSchema = z
  .object({
    key: z.string().min(1).max(120),
    confidence,
    evidenceRefs: z.array(z.string().max(200)).max(20).default([]),
  })
  .strict();

export const TriageResultSchema = z
  .object({
    schemaVersion: z.literal(TRIAGE_SCHEMA_VERSION),
    businessRelevance: z.enum(['RELEVANT', 'NON_BUSINESS', 'UNCERTAIN']),
    /** Registry key or the explicit `UNKNOWN`. */
    category: z.string().min(1).max(120),
    intents: z.array(TriageIntentSchema).max(10).default([]),
    proposedBusinessGoals: z.array(z.string().max(120)).max(10).default([]),
    conversationRelation: z.enum(['NEW', 'CONTINUATION', 'UNCERTAIN']),
    senderRoleHypothesis: z.enum(['CUSTOMER', 'PROSPECT', 'SUPPLIER', 'OTHER', 'UNKNOWN']),
    urgency: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL', 'UNKNOWN']),
    extractedFactCandidates: z.array(FactCandidateSchema).max(50).default([]),
    confidence: z
      .object({ relevance: confidence, intent: confidence, extraction: confidence.optional() })
      .strict(),
    riskFlags: z.array(z.string().max(80)).max(20).default([]),
    /** Short, evidence-based business reason — never hidden chain-of-thought. */
    conciseReason: z.string().min(1).max(600),
    evidenceRefs: z.array(z.string().max(200)).max(30).default([]),
  })
  .strict();
export type TriageResult = z.infer<typeof TriageResultSchema>;

/** The explicit catch-all value; an unknown category is never promoted to a production definition automatically (§5.2). */
export const UNKNOWN_CATEGORY = 'UNKNOWN' as const;

/**
 * Seed data for the extensible category registry (§5.2: "Kategorien, Intent-
 * und Zielkataloge sind erweiterbare Registry-Daten"). Tenants extend this
 * later through the Process Registry; the triage prompt receives the list so
 * the model answers with registry keys instead of free text.
 */
export const DEFAULT_TRIAGE_CATEGORIES: ReadonlyArray<{ key: string; description: string }> = [
  { key: 'REQUEST_FOR_QUOTE', description: 'Ein Kunde oder Interessent bittet um ein Angebot oder eine Preisauskunft.' },
  { key: 'SALES_INQUIRY', description: 'Allgemeine Vertriebsanfrage oder Interesse, ohne konkrete Angebotsbitte.' },
  { key: 'INVOICE_RECEIVED', description: 'Eine Eingangsrechnung oder Zahlungsaufforderung eines Lieferanten.' },
  { key: 'SUPPLIER_OFFER', description: 'Ein Lieferant bietet dem Unternehmen etwas an (Einkaufsseite).' },
  { key: 'COMPLAINT_OR_SERVICE', description: 'Beschwerde, Serviceproblem oder Supportanfrage eines Kunden.' },
  { key: 'APPLICATION', description: 'Bewerbung oder Personalanfrage an das Unternehmen.' },
  { key: 'NEWSLETTER_OR_MARKETING', description: 'Newsletter, Werbung oder Massenmailing.' },
  { key: 'PRIVATE', description: 'Rein private Nachricht ohne Geschäftsbezug.' },
  { key: 'SPAM', description: 'Eindeutiger Spam oder Phishing.' },
  { key: UNKNOWN_CATEGORY, description: 'Keine der Kategorien ist sicher zutreffend.' },
];
