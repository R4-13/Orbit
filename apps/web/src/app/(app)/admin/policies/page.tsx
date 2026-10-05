'use client';

import { useState } from 'react';
import type { PolicyMode } from '@orbit/shared';
import { Badge, Card, ErrorState, type BadgeTone } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { usePolicies, useUpdatePolicyMode } from '../../../../lib/hooks/use-policies';

const MODE_LABELS: Record<PolicyMode, { label: string; tone: BadgeTone }> = {
  DISABLED: { label: 'Deaktiviert', tone: 'danger' },
  SUGGEST_ONLY: { label: 'Nur Vorschlag', tone: 'neutral' },
  REQUIRE_APPROVAL: { label: 'Freigabe erforderlich', tone: 'warning' },
  AUTONOMOUS: { label: 'Autonom', tone: 'success' },
};

const MODE_OPTIONS: PolicyMode[] = ['DISABLED', 'SUGGEST_ONLY', 'REQUIRE_APPROVAL', 'AUTONOMOUS'];

const ACTION_LABELS: Record<string, string> = {
  'email.classify': 'E-Mail klassifizieren',
  'lead.create': 'Lead anlegen',
  'followup.send': 'Follow-up versenden',
  'booking_proposal.create': 'Buchungsvorschlag erstellen',
  'invoice.transfer_to_fibu': 'Rechnung an FiBu übertragen',
  'supplier.bank_details.change': 'Bankverbindung eines Lieferanten ändern',
  'supplier.create': 'Neuen Lieferanten anlegen',
  'payment.execute': 'Zahlung ausführen',
  'crm.activity.log': 'CRM-Aktivität protokollieren',
  'meeting.propose': 'Termin vorschlagen',
  'meeting.create': 'Termin anlegen',
  'invoice.intake': 'Rechnung erfassen (Posteingang)',
  'crm.contact.manage': 'Kontakt/Firma verwalten',
  'task.create': 'Aufgabe anlegen',
  'calendar.read': 'Kalender lesen',
  'email.draft': 'E-Mail-Entwurf erstellen',
  'email.triage': 'Eingänge semantisch einstufen (KI)',
  'context.lookup': 'Kontext zum Vorgang lesen',
  'requirements.resolve': 'Erforderliche Angaben ermitteln',
  'pricing.resolve': 'Preise aus freigegebener Quelle ermitteln',
  'quote.create': 'Angebotsentwurf erstellen (intern)',
  'quote.render': 'Angebotsdokument erzeugen',
  'email.send.clarification': 'Rückfrage an den Absender senden',
  'email.send.quote_delivery': 'Angebot an den Kunden senden',
  'process.plan': 'Prozessplan durch die KI vorschlagen',
};

export default function AdminPoliciesPage() {
  const { data: policies, isLoading, isError, error: loadError, refetch } = usePolicies();
  const updateMode = useUpdatePolicyMode();
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Regeln &amp; Freigaben</h1>
      <p className="mt-1 text-sm text-slate-500">
        Legt fest, wie selbstständig Agenten pro Aktion handeln dürfen — von &bdquo;nur vorschlagen&ldquo; bis
        &bdquo;autonom ausführen&ldquo;. Gesperrte Aktionen können nur eingeschränkt, nie gelockert werden.
      </p>

      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(loadError, 'Die Policy-Konfiguration konnte nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Aktion</th>
              <th className="px-4 py-3 font-medium">Modus</th>
              <th className="px-4 py-3 font-medium">Ändern</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  Wird geladen …
                </td>
              </tr>
            ) : policies && policies.length > 0 ? (
              policies.map((policy) => {
                const mode = MODE_LABELS[policy.mode];
                const isPendingThis = updateMode.isPending && updateMode.variables?.action === policy.action;
                return (
                  <tr key={policy.action} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">
                        {ACTION_LABELS[policy.action] ?? policy.action}
                      </span>
                      {policy.locked ? (
                        <span className="ml-2 text-xs text-slate-500">(gesperrt)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={mode.tone}>{mode.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        value={policy.mode}
                        disabled={isPendingThis}
                        onChange={(event) => {
                          setActionError(null);
                          updateMode.mutate(
                            { action: policy.action, mode: event.target.value as PolicyMode },
                            {
                              onError: (error) => {
                                setActionError(
                                  error instanceof ApiError
                                    ? error.message
                                    : 'Die Änderung konnte nicht gespeichert werden.',
                                );
                              },
                            },
                          );
                        }}
                      >
                        {MODE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {MODE_LABELS[option].label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  Keine Policy-Konfiguration gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}
