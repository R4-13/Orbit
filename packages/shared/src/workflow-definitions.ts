/**
 * Seed data for the two durable `WorkflowDefinition`s that Finance/Sales
 * intake migrated onto in Channel Event Runtime Increment G (mandatory
 * per the user's design — see docs/CHANNEL_EVENT_RUNTIME_PLAN.md).
 * Mirrors `DEFAULT_AGENT_DEFINITIONS`'s pattern: every new tenant gets
 * these two rows at bootstrap.
 *
 * Each is deliberately a single step — `IntakeService` still does its
 * existing pre-processing (document upload/checksum for Finance, no
 * pre-processing needed for Sales) BEFORE triggering the run; only the
 * actual agent-turn execution (previously `IntakeService`'s own bespoke
 * `runAgentTurn()`) moved onto the durable, already-tested
 * `WorkflowRunnerService` engine — the one with real restart-safety and
 * approval-pause/resume, not a second, parallel reimplementation of it.
 */
export interface DefaultWorkflowStepDefinition {
  agentDefinitionKey: string;
  inputMapping: Record<string, string>;
}

export interface DefaultWorkflowDefinition {
  key: string;
  name: string;
  description: string;
  triggerType: 'EMAIL';
  steps: readonly DefaultWorkflowStepDefinition[];
}

export const DEFAULT_WORKFLOW_DEFINITIONS: readonly DefaultWorkflowDefinition[] = [
  {
    key: 'finance-invoice-intake',
    name: 'Finance — Rechnungseingang',
    description: 'Liest eine bereits hochgeladene Rechnung aus und erstellt einen Buchungsvorschlag (Channel Event Runtime).',
    triggerType: 'EMAIL',
    steps: [
      {
        agentDefinitionKey: 'finance-intake',
        inputMapping: {
          documentId: '$.trigger.input.documentId',
          caseId: '$.trigger.input.caseId',
          subject: '$.trigger.input.subject',
        },
      },
    ],
  },
  {
    key: 'sales-lead-intake',
    name: 'Sales — Interessenten-Anfrage',
    description: 'Legt Unternehmen/Kontakt an und erzeugt einen Lead für eine eingehende Interessenten-Nachricht (Channel Event Runtime).',
    triggerType: 'EMAIL',
    steps: [
      {
        agentDefinitionKey: 'sales-intake',
        inputMapping: {
          subject: '$.trigger.input.subject',
          content: '$.trigger.input.content',
          caseId: '$.trigger.input.caseId',
        },
      },
    ],
  },
] as const;
