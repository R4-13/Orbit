'use client';

import { ArrowLeftRight } from 'lucide-react';
import { Modal } from '../common/modal';
import { HOME_OPTIONAL_ZONES, type HomeOptionalZone, type HomePeriod, type HomePreferences, type HomeView } from '../../lib/ui-preferences-model';
import { PERIOD_LABELS } from '../../lib/home-format';

const ZONE_LABELS: Record<HomeOptionalZone, { label: string; hint: string }> = {
  inbox: { label: 'Neu im Posteingang', hint: 'Die neuesten Eingänge neben der Aufmerksamkeit.' },
  finance: { label: 'Finanzen', hint: 'Zu prüfen, Freigabe offen, übertragen.' },
  sales: { label: 'Vertrieb', hint: 'Neue Anfragen, Rückmeldungen, fällige Schritte.' },
  tasks: { label: 'Ihre nächsten Aufgaben', hint: 'Die nächsten fälligen Aufgaben.' },
  completed: { label: 'Zuletzt erledigt', hint: 'Bestätigte Ergebnisse.' },
};

/**
 * UI v2 §20.2: kontrollierte Anpassung statt Dashboard-Baukasten. Wählbar sind nur die optionalen Zonen, die Reihenfolge der
 * beiden Fachbereichskarten und Zeitraum/Ansicht. „Benötigt Ihre Aufmerksamkeit“ und die Kennzahlen bleiben immer sichtbar;
 * keine Einstellung kann die Höhe über das Budget hinaus vergrößern (Ausblenden verkleinert nur).
 */
export function HomeCustomizeDialog({
  value,
  allowed,
  onChange,
  onReset,
  onClose,
}: {
  value: HomePreferences;
  /** Zonen, die der Nutzer überhaupt sehen darf – nicht berechtigte bleiben auch im Editor unsichtbar. */
  allowed: HomeOptionalZone[];
  onChange: (patch: Partial<HomePreferences>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const zones = HOME_OPTIONAL_ZONES.filter((zone) => allowed.includes(zone));
  function toggle(zone: HomeOptionalZone) {
    onChange({ hidden: value.hidden.includes(zone) ? value.hidden.filter((item) => item !== zone) : [...value.hidden, zone] });
  }
  function swapDomains() {
    const [first, second] = value.domainOrder;
    if (first === undefined || second === undefined) return;
    onChange({ domainOrder: [second, first] });
  }

  return (
    <Modal
      title="Ansicht anpassen"
      description="Wählen Sie, was Ihre Startseite zeigt. Die Aufmerksamkeit und die Kennzahlen bleiben immer sichtbar."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onReset} className="rounded-md border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Standard wiederherstellen
          </button>
          <button type="button" onClick={onClose} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90">
            Fertig
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-800">
            Standardzeitraum
            <select value={value.period} onChange={(event) => onChange({ period: event.target.value as HomePeriod })} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-normal">
              {(Object.keys(PERIOD_LABELS) as HomePeriod[]).map((period) => (
                <option key={period} value={period}>
                  {PERIOD_LABELS[period]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Standardansicht
            <select value={value.view} onChange={(event) => onChange({ view: event.target.value as HomeView })} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-normal">
              <option value="MINE">Meine</option>
              <option value="TEAM">Team</option>
            </select>
          </label>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">Anzeigen</legend>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            <li className="flex items-start gap-3 px-3 py-2.5">
              <input type="checkbox" checked disabled aria-label="Benötigt Ihre Aufmerksamkeit (immer sichtbar)" className="mt-1 h-4 w-4" />
              <div>
                <p className="text-sm font-medium text-slate-900">Benötigt Ihre Aufmerksamkeit</p>
                <p className="text-xs text-slate-600">Immer sichtbar, solange etwas Ihre Entscheidung braucht.</p>
              </div>
            </li>
            {zones.map((zone) => (
              <li key={zone} className="flex items-start gap-3 px-3 py-2.5">
                <input id={`zone-${zone}`} type="checkbox" checked={!value.hidden.includes(zone)} onChange={() => toggle(zone)} className="mt-1 h-4 w-4" />
                <label htmlFor={`zone-${zone}`} className="cursor-pointer">
                  <span className="block text-sm font-medium text-slate-900">{ZONE_LABELS[zone].label}</span>
                  <span className="block text-xs text-slate-600">{ZONE_LABELS[zone].hint}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {allowed.includes('finance') && allowed.includes('sales') ? (
          <div>
            <p className="text-sm font-semibold text-slate-900">Reihenfolge der Fachbereiche</p>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <p className="text-sm text-slate-800">{value.domainOrder[0] === 'finance' ? 'Finanzen links, Vertrieb rechts' : 'Vertrieb links, Finanzen rechts'}</p>
              <button type="button" onClick={swapDomains} className="flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <ArrowLeftRight size={15} aria-hidden="true" /> Vertauschen
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
