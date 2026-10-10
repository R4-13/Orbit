'use client';

import { useState, type FormEvent } from 'react';
import { AUTOMATION_PRESETS, AUTOMATION_PRESET_KEYS, type AutomationPresetKey } from '@orbit/shared';
import { Button, Input, Label } from '@orbit/ui';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { platformErrorMessage, platformFetch } from '../../lib/platform/platform-client';
import { usePlatformMutation, type PlatformTenantRow } from '../../lib/platform/use-platform-data';

interface Provisioned {
  tenant: PlatformTenantRow;
  adminEmail: string;
  temporaryPassword: string;
}

/**
 * Neukunde anlegen (Amendment 03 §6): Betrieb mit Branche, Automatisierungsstufe und erstem Administrator. Verlangt eine Begründung und die erneute
 * Passwortprüfung; das erzeugte Startpasswort erscheint genau einmal in dieser Ansicht und wird nirgends gespeichert.
 */
export function ProvisionTenantPanel({ onClose }: { onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [form, setForm] = useState({ name: '', industry: '', automationPreset: 'CAUTIOUS' as AutomationPresetKey, adminFirstName: '', adminLastName: '', adminEmail: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Provisioned | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const create = usePlatformMutation(() =>
    withStepUp(() => platformFetch<Provisioned>('/tenants', { method: 'POST', body: JSON.stringify({ ...form, industry: form.industry.trim() || undefined }) })),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setResult((await create.mutateAsync(undefined)) as Provisioned);
    } catch (err) {
      setError(platformErrorMessage(err, 'Der Betrieb konnte nicht angelegt werden.'));
    }
  }

  if (result) {
    return (
      <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4" role="status" data-testid="provision-result">
        <p className="text-sm font-medium text-emerald-900">„{result.tenant.displayName}“ wurde angelegt.</p>
        <dl className="grid gap-1 text-sm text-slate-800 sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium">Administrator</dt>
          <dd>{result.adminEmail}</dd>
          <dt className="font-medium">Startpasswort</dt>
          <dd>
            <code className="select-all rounded bg-white px-2 py-0.5 text-xs" data-testid="provision-password">
              {result.temporaryPassword}
            </code>
          </dd>
        </dl>
        <p className="text-sm text-amber-900">Das Startpasswort wird nur jetzt angezeigt und nirgends gespeichert. Übergeben Sie es über einen sicheren Weg; die Person sollte es nach der ersten Anmeldung ändern.</p>
        <Button variant="secondary" onClick={onClose}>
          Schließen
        </Button>
      </div>
    );
  }

  const valid = form.name.trim().length >= 2 && form.adminFirstName.trim() && form.adminLastName.trim() && form.adminEmail.includes('@') && form.reason.trim().length >= 5;
  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4" aria-label="Neukunde anlegen">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="pt-name">Name des Betriebs</Label>
          <Input id="pt-name" required value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pt-industry">Branche / Gewerk</Label>
          <Input id="pt-industry" value={form.industry} maxLength={120} placeholder="z. B. Dachdecker, Heizung und Sanitär" onChange={(e) => set('industry', e.target.value)} />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Wie selbstständig soll ORBIT arbeiten?</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {AUTOMATION_PRESET_KEYS.map((key) => (
            <label key={key} className={`cursor-pointer rounded-lg border p-3 text-sm ${form.automationPreset === key ? 'border-brand bg-brand/5' : 'border-slate-200 bg-white'}`}>
              <input type="radio" name="pt-preset" className="mr-2" checked={form.automationPreset === key} onChange={() => set('automationPreset', key)} />
              <span className="font-semibold text-slate-900">{AUTOMATION_PRESETS[key].label}</span>
              <span className="mt-1 block text-[13px] text-slate-700">{AUTOMATION_PRESETS[key].description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="pt-first">Administrator: Vorname</Label>
          <Input id="pt-first" required value={form.adminFirstName} onChange={(e) => set('adminFirstName', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pt-last">Administrator: Nachname</Label>
          <Input id="pt-last" required value={form.adminLastName} onChange={(e) => set('adminLastName', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pt-email">Administrator: E-Mail-Adresse</Label>
          <Input id="pt-email" type="email" required value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-slate-600">Mitarbeiter, Leistungen, Öffnungszeiten und Notdienst erfasst der Administrator anschließend selbst – eine Checkliste führt ihn durch die Einrichtung.</p>
      <div>
        <Label htmlFor="pt-reason">Begründung (wird im Audit festgehalten)</Label>
        <Input id="pt-reason" required minLength={5} maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || !valid}>
          {create.isPending ? 'Wird angelegt …' : 'Betrieb anlegen'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
