'use client';

import { useState, type FormEvent } from 'react';
import { PLATFORM_MIN_PASSWORD_LENGTH } from '@orbit/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { PlatformApiError, platformFetch, reloadPlatformSession } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { platformRoleLabel } from '../../../lib/platform/role-labels';

/** Eigenes Konto: Angaben ansehen und das Passwort wechseln. Der Wechsel beendet alle anderen Sitzungen dieser Person sofort. */
export default function PlatformAccountPage() {
  const { principal } = usePlatformAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < PLATFORM_MIN_PASSWORD_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const result = await platformFetch<{ revokedOtherSessions: number }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setCurrent('');
      setNext('');
      setRepeat('');
      await reloadPlatformSession(); // der Zwang zum Wechsel entfällt; Navigation und Rechte stehen wieder zur Verfügung
      setDone(result.revokedOtherSessions > 0 ? `Ihr Passwort wurde geändert. ${result.revokedOtherSessions} andere Sitzung${result.revokedOtherSessions === 1 ? '' : 'en'} wurde${result.revokedOtherSessions === 1 ? '' : 'n'} beendet.` : 'Ihr Passwort wurde geändert.');
    } catch (err) {
      if (err instanceof PlatformApiError && err.status === 401) setError('Das aktuelle Passwort ist nicht korrekt.');
      else if (err instanceof PlatformApiError && err.status === 400) setError(err.message);
      else if (err instanceof PlatformApiError && err.status === 429) setError('Zu viele Versuche. Bitte warten Sie einige Minuten.');
      else setError('Das Passwort konnte nicht geändert werden. Bitte später erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Mein Zugang</h1>
        <p className="text-sm text-slate-600">
          {principal?.displayName} · {principal?.email} · {principal?.platformRoles.map(platformRoleLabel).join(', ')}
        </p>
      </div>
      {principal?.passwordChangeRequired ? (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Bitte ändern Sie zuerst Ihr Passwort. Bis dahin ist nur diese Seite erreichbar – Ihr Startpasswort wurde von einer anderen Person festgelegt und gilt nur für diesen Schritt.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Passwort ändern</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="max-w-md space-y-4" aria-label="Passwort ändern">
            <div>
              <Label htmlFor="pw-current">Aktuelles Passwort</Label>
              <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pw-new">Neues Passwort (mindestens {PLATFORM_MIN_PASSWORD_LENGTH} Zeichen)</Label>
              <Input id="pw-new" type="password" autoComplete="new-password" required minLength={PLATFORM_MIN_PASSWORD_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
              {tooShort ? <p className="mt-1 text-xs text-amber-800">Noch {PLATFORM_MIN_PASSWORD_LENGTH - next.length} Zeichen bis zur Mindestlänge.</p> : null}
            </div>
            <div>
              <Label htmlFor="pw-repeat">Neues Passwort wiederholen</Label>
              <Input id="pw-repeat" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
              {mismatch ? <p className="mt-1 text-xs text-red-700">Die beiden neuen Passwörter stimmen nicht überein.</p> : null}
            </div>
            <p className="text-xs text-slate-500">Alle anderen Sitzungen mit Ihrem Zugang enden sofort; diese bleibt bestehen.</p>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            {done ? <p role="status" className="text-sm text-emerald-700">{done}</p> : null}
            <Button type="submit" disabled={busy || !current || next.length < PLATFORM_MIN_PASSWORD_LENGTH || next !== repeat}>{busy ? 'Wird geändert …' : 'Passwort ändern'}</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
