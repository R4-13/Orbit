'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Label } from '@orbit/ui';
import { platformErrorMessage } from '../../lib/platform/platform-client';

/**
 * Inline-Formular für eine kritische Plattformänderung: beschriebene Wirkung, Pflichtbegründung (mindestens 5 Zeichen, wie die API), Bestätigung.
 * Die Wirkung wird vor der Bestätigung angezeigt, nie danach.
 */
export function ReasonForm({ id, effect, confirmLabel, danger, onConfirm, onCancel, children }: { id: string; effect: string; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<unknown>; onCancel: () => void; children?: ReactNode }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(platformErrorMessage(err, 'Die Änderung konnte nicht gespeichert werden.'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4" aria-label="Änderung bestätigen">
      <p className="text-sm text-slate-700">
        <span className="font-medium">Wirkung: </span>
        {effect}
      </p>
      {children}
      <div>
        <Label htmlFor={`${id}-reason`}>Begründung (wird im Audit festgehalten)</Label>
        <Input id={`${id}-reason`} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy || reason.trim().length < 5}>
          {busy ? 'Wird gespeichert …' : confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Abbrechen</Button>
      </div>
    </form>
  );
}
