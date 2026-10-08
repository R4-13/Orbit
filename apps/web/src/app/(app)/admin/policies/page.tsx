'use client';

import { useState } from 'react';
import type { AutomationPresetKey, PolicyMode } from '@orbit/shared';
import { Badge, Button, Card, ErrorState, type BadgeTone } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import { useApplyAutomation, useAutomation, usePolicies, useUpdatePolicyMode } from '../../../../lib/hooks/use-policies';

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

function AutomationLevelCard({ onError }: { onError: (message: string | null) => void }) {
  const { data, isLoading } = useAutomation();
  const apply = useApplyAutomation();
  const [notice, setNotice] = useState<string | null>(null);
  if (isLoading || !data) return null;
  return (
    <Card className="mt-6 p-5" data-testid="automation-level">
      <h2 className="text-base font-semibold text-slate-900">Automatisierungsgrad</h2>
      <p className="mt-1 text-sm text-slate-600">
        Wie viel erledigt ORBIT ohne Ihre Freigabe? Die Stufe setzt die Regeln unten gesammelt; einzelne Regeln können Sie danach weiter anpassen. Gesperrte Aktionen
        (neuer Lieferant, geänderte Bankdaten, Zahlung) bleiben in jeder Stufe unverändert.
      </p>
      <p className="mt-2 text-sm text-slate-800">
        Aktuell: <strong>{data.current === 'CUSTOM' ? 'Individuell (einzelne Regeln weichen ab)' : (data.presets.find((p) => p.key === data.current)?.label ?? data.current)}</strong>
      </p>
      <div role="radiogroup" aria-label="Automatisierungsgrad" className="mt-3 grid gap-3 md:grid-cols-3">
        {data.presets.map((preset) => {
          const active = data.current === preset.key;
          return (
            <div key={preset.key} className={`flex flex-col rounded-lg border p-3 ${active ? 'border-brand bg-brand/5' : 'border-slate-200'}`}>
              <p className="text-sm font-semibold text-slate-900">
                {preset.label} {active ? <Badge tone="success">Aktiv</Badge> : null}
              </p>
              <p className="mt-1 flex-1 text-[13px] text-slate-700">{preset.description}</p>
              {!active && preset.changes.length > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                  {preset.changes.map((change) => (
                    <li key={change.action}>
                      {ACTION_LABELS[change.action] ?? change.action}: {MODE_LABELS[change.from].label} → {MODE_LABELS[change.to].label}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                className="mt-3"
                variant={active ? 'secondary' : 'primary'}
                disabled={active || apply.isPending}
                onClick={() => {
                  onError(null);
                  setNotice(null);
                  apply.mutate(preset.key as AutomationPresetKey, {
                    onSuccess: (result) => setNotice(`Stufe „${preset.label}“ gesetzt (${result.changed} ${result.changed === 1 ? 'Regel' : 'Regeln'} geändert).`),
                    onError: (error) => onError(error instanceof ApiError ? error.message : 'Die Stufe konnte nicht gesetzt werden.'),
                  });
                }}
              >
                {active ? 'Aktuelle Stufe' : `Stufe „${preset.label}“ wählen`}
              </Button>
            </div>
          );
        })}
      </div>
      {notice ? (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}

export default function AdminPoliciesPage() {
  const { data: policies, isLoading, isError, error: loadError, refetch } = usePolicies();
  const updateMode = useUpdatePolicyMode();
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Regeln &amp; Freigaben</h1>
      <p className="mt-1 text-sm text-slate-600">
        Legt fest, wie selbstständig Agenten pro Aktion handeln dürfen — von &bdquo;nur vorschlagen&ldquo; bis
        &bdquo;autonom ausführen&ldquo;. Gesperrte Aktionen können nur eingeschränkt, nie gelockert werden.
      </p>

      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <AutomationLevelCard onError={setActionError} />

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(loadError, 'Die Policy-Konfiguration konnte nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : (
      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Aktion</th>
              <th className="px-4 py-3 font-medium">Modus</th>
              <th className="px-4 py-3 font-medium">Ändern</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={3}>
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
                        <span className="ml-2 text-xs text-slate-600">(gesperrt)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={mode.tone}>{mode.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Regel für „${ACTION_LABELS[policy.action] ?? policy.action}“`}
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
                <td className="px-4 py-6 text-slate-600" colSpan={3}>
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
