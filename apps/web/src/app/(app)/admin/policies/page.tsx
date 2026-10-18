'use client';

import { useState } from 'react';
import type { PolicyConfig } from '@orbit/domain';
import {
  POLICY_GROUPS,
  POLICY_GROUP_KEYS,
  UNGROUPED_DEFAULT_MODE,
  actionClassOf,
  groupModeOf,
  placementOf,
  type ActionClass,
  type AutomationPresetKey,
  type PolicyActionKey,
  type PolicyActionPlacement,
  type PolicyGroupKey,
  type PolicyMode,
} from '@orbit/shared';
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
  'process.plan.activate': 'Frei geplanten Ablauf ohne Bestätigung starten',
  'email.send.acknowledgement': 'Bestätigung/Statusauskunft an die Kundschaft senden',
  'email.send.information': 'Auskunft aus dem Betriebswissen senden',
  'staff.notify': 'Mitarbeiter benachrichtigen',
  'knowledge.answer': 'Antwort aus dem Betriebswissen ermitteln',
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

const CLASS_LABELS: Record<ActionClass, { label: string; hint: string }> = {
  BLOCKED: { label: 'Gesperrt', hint: 'wird nicht ausgeführt – auch nicht nach Freigabe' },
  AFTER_APPROVAL: { label: 'Nach Freigabe', hint: 'wird erst nach Ihrer Freigabe ausgeführt' },
  AUTONOMOUS: { label: 'Autonom', hint: 'ORBIT führt es innerhalb der Vollmacht selbst aus' },
};

function PolicyRows({ policies, onError }: { policies: PolicyConfig[]; onError: (message: string | null) => void }) {
  const updateMode = useUpdatePolicyMode();
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
        <tr>
          <th className="px-4 py-2 font-medium">Aktion</th>
          <th className="px-4 py-2 font-medium">Wirkung</th>
          <th className="px-4 py-2 font-medium">Ändern</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {policies.map((policy) => {
          const mode = MODE_LABELS[policy.mode];
          const actionClass = CLASS_LABELS[actionClassOf(policy.action as PolicyActionKey, policy.mode)];
          const isPendingThis = updateMode.isPending && updateMode.variables?.action === policy.action;
          return (
            <tr key={policy.action} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <span className="font-medium text-slate-900">{ACTION_LABELS[policy.action] ?? policy.action}</span>
                {policy.locked ? <span className="ml-2 text-xs text-slate-600">(gesperrt)</span> : null}
              </td>
              <td className="px-4 py-3">
                <Badge tone={mode.tone}>{mode.label}</Badge>
                <p className="mt-1 text-xs text-slate-600">
                  {actionClass.label}: {actionClass.hint}
                </p>
              </td>
              <td className="px-4 py-3">
                <select
                  aria-label={`Regel für „${ACTION_LABELS[policy.action] ?? policy.action}“`}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  value={policy.mode}
                  disabled={isPendingThis}
                  onChange={(event) => {
                    onError(null);
                    updateMode.mutate(
                      { action: policy.action, mode: event.target.value as PolicyMode },
                      { onError: (error) => onError(error instanceof ApiError ? error.message : 'Die Änderung konnte nicht gespeichert werden.') },
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
        })}
      </tbody>
    </table>
  );
}

/** Eine der sechs Gruppen: Darstellung über den Einzelregeln (keine zweite Regel). Der Gruppenwert ist der strengste Wert der Einzelregeln; abweichende Einzelregeln bleiben sichtbar. */
function GroupCard({ group, policies, onError }: { group: PolicyGroupKey; policies: PolicyConfig[]; onError: (message: string | null) => void }) {
  const updateMode = useUpdatePolicyMode();
  const [busy, setBusy] = useState(false);
  const definition = POLICY_GROUPS[group];
  const modes = Object.fromEntries(policies.map((p) => [p.action, p.mode])) as Record<string, PolicyMode>;
  const summary = groupModeOf(group, modes);
  const label = MODE_LABELS[summary.mode];

  async function applyToAll(mode: PolicyMode) {
    onError(null);
    setBusy(true);
    const failed: string[] = [];
    for (const policy of policies) {
      if (policy.mode === mode) continue;
      try {
        await updateMode.mutateAsync({ action: policy.action, mode });
      } catch {
        failed.push(ACTION_LABELS[policy.action] ?? policy.action);
      }
    }
    setBusy(false);
    if (failed.length > 0) onError(`Nicht geändert (fest gesperrt oder abgelehnt): ${failed.join(', ')}.`);
  }

  return (
    <Card className="mt-4 overflow-hidden" data-testid={`policy-group-${group}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="max-w-xl">
          <h2 className="text-base font-semibold text-slate-900">{definition.label}</h2>
          <p className="text-xs text-slate-600">{definition.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Badge tone={label.tone}>{summary.uniform ? label.label : `Strengste Regel: ${label.label}`}</Badge>
            <select
              aria-label={`Alle Regeln der Gruppe „${definition.label}“ setzen`}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value=""
              disabled={busy}
              onChange={(event) => {
                if (event.target.value) void applyToAll(event.target.value as PolicyMode);
              }}
            >
              <option value="">Gruppe setzen …</option>
              {MODE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {MODE_LABELS[option].label}
                </option>
              ))}
            </select>
          </div>
          {!summary.uniform ? <p className="text-xs text-amber-700">Einzelregeln weichen ab ({summary.deviations.length}); sie bleiben unten einzeln einstellbar.</p> : null}
        </div>
      </div>
      <PolicyRows policies={policies} onError={onError} />
    </Card>
  );
}

export default function AdminPoliciesPage() {
  const { data: policies, isLoading, isError, error: loadError, refetch } = usePolicies();
  const [actionError, setActionError] = useState<string | null>(null);

  const byPlacement = (predicate: (placement: PolicyActionPlacement) => boolean) => (policies ?? []).filter((p) => predicate(placementOf(p.action)));
  const inGroup = (group: PolicyGroupKey) => byPlacement((p) => p.kind === 'GROUP' && p.group === group);
  const technical = byPlacement((p) => p.kind === 'TECHNICAL');
  const levelRules = byPlacement((p) => p.kind === 'AUTONOMY_LEVEL');
  const platformBlocked = byPlacement((p) => p.kind === 'PLATFORM_BLOCKED');
  const ungrouped = byPlacement((p) => p.kind === 'UNGROUPED');

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Regeln &amp; Freigaben</h1>
      <p className="mt-1 text-sm text-slate-600">
        Legt fest, wie selbstständig ORBIT handeln darf. Jede Aktion gehört zu einer von drei Klassen: <strong>gesperrt</strong> (auch mit Freigabe nicht ausführbar),{' '}
        <strong>nach Freigabe</strong> (erst nach Ihrer Freigabe) oder <strong>autonom</strong> (innerhalb der Vollmacht ohne Einzelfreigabe). Gesperrte Aktionen können nur eingeschränkt, nie
        gelockert werden.
      </p>

      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <AutomationLevelCard onError={setActionError} />

      {isError ? (
        <ErrorState className="mt-6" message={errorMessage(loadError, 'Die Policy-Konfiguration konnte nicht geladen werden.')} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="mt-6 text-sm text-slate-600">Wird geladen …</p>
      ) : !policies || policies.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">Keine Policy-Konfiguration gefunden.</p>
      ) : (
        <>
          {POLICY_GROUP_KEYS.map((group) => (
            <GroupCard key={group} group={group} policies={inGroup(group)} onError={setActionError} />
          ))}

          {levelRules.length > 0 ? (
            <Card className="mt-4 overflow-hidden" data-testid="policy-level-rules">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-base font-semibold text-slate-900">Freie Planung</h2>
                <p className="text-xs text-slate-600">
                  Darf ORBIT einen selbst geplanten Ablauf ohne vorherige Bestätigung des ganzen Plans starten? Jede Wirkung nach außen bleibt trotzdem durch ihre eigene Regel
                  geschützt. Wird auch durch den Automatisierungsgrad gesetzt.
                </p>
              </div>
              <PolicyRows policies={levelRules} onError={setActionError} />
            </Card>
          ) : null}

          {ungrouped.length > 0 ? (
            <Card className="mt-4 overflow-hidden" data-testid="policy-ungrouped">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-base font-semibold text-slate-900">Sonstiges / neue Fähigkeiten</h2>
                <p className="text-xs text-slate-600">
                  Neue Aktionen, die noch keiner Gruppe zugeordnet sind. Standard: {MODE_LABELS[UNGROUPED_DEFAULT_MODE].label} – nichts Neues läuft ohne Ihre Entscheidung.
                </p>
              </div>
              <PolicyRows policies={ungrouped} onError={setActionError} />
            </Card>
          ) : null}

          {platformBlocked.length > 0 ? (
            <Card className="mt-4 overflow-hidden" data-testid="policy-platform-blocked">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-base font-semibold text-slate-900">Von der Plattform gesperrt</h2>
                <p className="text-xs text-slate-600">In dieser Ausbaustufe nicht ausführbar, auch nicht nach Freigabe.</p>
              </div>
              <PolicyRows policies={platformBlocked} onError={setActionError} />
            </Card>
          ) : null}

          <details className="mt-4" data-testid="policy-technical">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Technik und Analyse ({technical.length} Regeln – Lesen, Einstufen, Entwerfen; keine Wirkung nach außen)
            </summary>
            <Card className="mt-2 overflow-hidden">
              <PolicyRows policies={technical} onError={setActionError} />
            </Card>
          </details>
        </>
      )}
    </div>
  );
}
