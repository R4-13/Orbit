'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@orbit/ui';
import { platformErrorMessage } from '../../lib/platform/platform-client';

/**
 * Erneute Prüfung für kritische Plattformaktionen (Amendment 03 §3.2): das Passwort, und – hat der Zugang einen zweiten Faktor (PLT-02) – zusätzlich der aktuelle Code der
 * Authenticator-App (oder ein Wiederherstellungscode). Ohne Faktor genügt das Passwort; die Oberfläche stellt es nicht anders dar, als es ist.
 */
export function StepUpDialog({ open, needsCode = false, onSubmit, onCancel }: { open: boolean; needsCode?: boolean; onSubmit: (password: string, code?: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setCode('');
      setError(null);
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, needsCode ? code.trim() : undefined);
    } catch (err) {
      setError(platformErrorMessage(err, 'Die Bestätigung ist fehlgeschlagen.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <form role="dialog" aria-modal="true" aria-labelledby="stepup-title" onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <div>
          <h2 id="stepup-title" className="text-base font-semibold text-slate-900">Aktion bestätigen</h2>
          <p className="mt-1 text-sm text-slate-600">Für diese Änderung ist eine erneute Eingabe Ihres Passworts {needsCode ? 'und des Codes Ihrer Authenticator-App ' : ''}nötig. Die Bestätigung gilt für kurze Zeit.</p>
        </div>
        <div>
          <Label htmlFor="stepup-password">Passwort</Label>
          <Input id="stepup-password" ref={input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {needsCode ? (
          <div>
            <Label htmlFor="stepup-code">Code der Authenticator-App</Label>
            <Input id="stepup-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">Oder ein Wiederherstellungscode.</p>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Abbrechen</Button>
          <Button type="submit" disabled={busy || password.length === 0 || (needsCode && code.trim().length < 6)}>{busy ? 'Wird geprüft …' : 'Bestätigen'}</Button>
        </div>
      </form>
    </div>
  );
}
