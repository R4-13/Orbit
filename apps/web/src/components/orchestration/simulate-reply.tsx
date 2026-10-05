'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@orbit/ui';
import { apiFetch, errorMessage } from '../../lib/api-client';
import { useCase } from '../../lib/hooks/use-cases';
import { useIntakeVisibility } from '../../lib/hooks/use-intake-decisions';

/**
 * Test operation only: lets a tester answer the clarification as the customer would, with the real threading headers, so
 * the reply is correlated and the case resumes through exactly the production path (no shortcut into the engine).
 * Offered only while the case waits for an answer and the system runs in test operation.
 */
export function SimulateReply({ caseId }: { caseId: string }) {
  const visibility = useIntakeVisibility();
  const { data: c } = useCase(caseId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch('/v1/intake/emails', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setOpen(false);
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['orchestration', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['cases', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['case-events', caseId] });
    },
  });

  if (!visibility.data?.testOperation || !c) return null;
  const inbound = c.emailMessages.find((m) => m.direction === 'INBOUND');
  const outbound = [...c.emailMessages].reverse().find((m) => m.direction === 'OUTBOUND');
  if (!inbound || !outbound) return null;

  return (
    <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="font-medium text-slate-700 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        {open ? '▾' : '▸'} Antwort des Kunden simulieren (Testbetrieb)
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-600">Die Antwort geht als echte Folge-E-Mail mit Thread- und In-Reply-To-Kennung durch die normale Zuordnung; der Vorgang setzt danach selbstständig fort.</p>
          <label className="block">
            <span className="font-medium text-slate-700">Text der Antwort</span>
            <textarea className="mt-1 h-28 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {send.isError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">
              {errorMessage(send.error, 'Die Antwort konnte nicht eingespielt werden.')}
            </p>
          ) : null}
          <Button
            disabled={!text.trim() || send.isPending}
            onClick={() =>
              send.mutate({
                fromAddress: inbound.fromAddress,
                toAddresses: [outbound.fromAddress.includes('@') ? outbound.fromAddress : 'info@orbit.invalid'],
                subject: /^re:/i.test(outbound.subject ?? '') ? outbound.subject : `Re: ${outbound.subject ?? inbound.subject ?? 'Anfrage'}`,
                bodyText: text.trim(),
                threadId: outbound.threadId ?? undefined,
                inReplyTo: outbound.rfcMessageId ?? undefined,
                references: [inbound.rfcMessageId, outbound.rfcMessageId].filter((v): v is string => Boolean(v)),
              })
            }
          >
            {send.isPending ? 'Wird eingespielt …' : 'Antwort einspielen'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
