/**
 * Seed data for AgentDefinition (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1)
 * — the tenant-bootstrap counterpart to DEFAULT_POLICY_CONFIG (policy.ts).
 * Every new tenant gets exactly these three rows at bootstrap, matching
 * (byte-for-byte, for the prompts) what was hard-coded as string literals
 * in IntakeService before this feature existed — the migration from
 * "literal in code" to "row in DB, resolved at runtime" is behavior-
 * preserving by construction, not a rewrite of what the agents actually do.
 *
 * `baseType` mirrors packages/domain/prisma/schema.prisma's `AgentType`
 * enum as a plain string union (same pattern as PolicyMode below) —
 * @orbit/shared cannot depend on the Prisma client (@orbit/domain depends
 * on @orbit/shared, not the reverse).
 */
export type AgentBaseType = 'ORCHESTRATOR' | 'COMMUNICATION' | 'FINANCE' | 'SALES';

export interface DefaultAgentDefinition {
  key: string;
  name: string;
  description: string;
  baseType: AgentBaseType;
  systemPrompt: string;
  allowedTools: readonly string[];
}

export const DEFAULT_AGENT_DEFINITIONS: readonly DefaultAgentDefinition[] = [
  {
    key: 'triage',
    name: 'Triage Agent',
    description: 'Stuft jedes eingehende Intake-Event vor jeder Domain-Klassifikation als geschäftlich relevant/irrelevant ein (Channel Event Runtime).',
    baseType: 'COMMUNICATION',
    systemPrompt:
      'Du bist der Triage-Agent. Stufe das eingehende Ereignis ausschließlich mit assess_relevance ein — BUSINESS_ACTIONABLE, BUSINESS_INFORMATIONAL, NON_ACTIONABLE, PRIVATE_PERSONAL oder UNKNOWN_REQUIRES_REVIEW. Du führst selbst niemals eine Geschäftsaktion aus und entscheidest nicht, was als Nächstes passiert — das übernimmt die aufrufende Anwendungslogik anhand deiner Einstufung.',
    allowedTools: ['assess_relevance'],
  },
  {
    key: 'communication-intake',
    name: 'Communication/Intake Agent',
    description: 'Klassifiziert jede eingehende Nachricht als FINANCE/SALES/OTHER (§12).',
    baseType: 'COMMUNICATION',
    systemPrompt: 'Du bist der Communication/Intake-Agent. Klassifiziere die eingehende Nachricht mit classify_message.',
    allowedTools: ['classify_message'],
  },
  {
    key: 'finance-intake',
    name: 'Finance/AP Agent',
    description: 'Liest eine angehängte Rechnung aus und erstellt einen Buchungsvorschlag (§12).',
    baseType: 'FINANCE',
    systemPrompt:
      'Du bist der Finance/AP-Agent. Lies die angehängte Rechnung aus (extract_invoice) und erstelle danach, sofern ein Bruttobetrag ermittelt wurde, einen Buchungsvorschlag (create_booking_proposal).',
    allowedTools: ['extract_invoice', 'create_booking_proposal'],
  },
  {
    key: 'sales-intake',
    name: 'Sales/CRM Agent',
    description: 'Legt Unternehmen/Kontakt an und erzeugt einen Lead für eingehende Interessenten (§12).',
    baseType: 'SALES',
    systemPrompt:
      'Du bist der Sales/CRM-Agent. Lege für den Absender Unternehmen (create_company) und Kontakt (create_contact) an, sofern nötig, und erzeuge anschließend einen Lead (create_lead).',
    allowedTools: ['create_company', 'create_contact', 'create_lead'],
  },
] as const;
