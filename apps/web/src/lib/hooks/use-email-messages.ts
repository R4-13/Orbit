import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailMessage, IntakeEventStatus } from '@orbit/domain';
import type { SimulatedTriageScenario } from '@orbit/shared';
import { apiFetch } from '../api-client';

export function useEmailMessages() {
  return useQuery({
    queryKey: ['email-messages'],
    queryFn: () => apiFetch<EmailMessage[]>('/v1/email-messages'),
  });
}

export interface SimulateIncomingEmailInput {
  fromAddress: string;
  toAddresses: string[];
  subject: string;
  bodyText: string;
  attachment?: { fileName: string; mimeType: string; contentBase64: string };
  /** Demo only: the structured result the SIMULATED AI returns for this message. Refused by the API when a real provider is in use. */
  simulatedTriageScenario?: SimulatedTriageScenario;
}

export interface SimulateIncomingEmailResult {
  category: 'FINANCE' | 'SALES' | 'OTHER';
  case: { id: string } | null;
  agentRunIds: string[];
  intakeStatus?: IntakeEventStatus;
}

/** Stands in for a real Mail-Connector webhook (§23/§29/§34) — see docs/KNOWN_LIMITATIONS.md. */
export function useSimulateIncomingEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SimulateIncomingEmailInput) =>
      apiFetch<SimulateIncomingEmailResult>('/v1/intake/emails', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-messages'] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    },
  });
}
