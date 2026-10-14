'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, CardContent, Input, Label } from '@orbit/ui';
import { TENANT_MIN_PASSWORD_LENGTH } from '@orbit/shared';
import { ApiError, apiFetch, errorMessage } from '../../lib/api-client';
import { setStoredAuth, type AuthUser } from '../../lib/token-store';
import { useAuth } from '../../lib/auth-context';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

interface ChangeResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

/** Erste Anmeldung mit Startpasswort: bis zum Wechsel zeigt die Anwendung nur diese Maske (der Server lässt bis dahin nichts anderes zu). */
export function ForcedPasswordChange() {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== repeat) return setError('Die beiden neuen Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      const data = await apiFetch<ChangeResponse>('/v1/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setStoredAuth({ accessToken: data.accessToken, user: data.user });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Das Startpasswort ist nicht korrekt.' : errorMessage(err, 'Das Passwort konnte nicht geändert werden.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <h1 className="mb-1 text-lg font-semibold text-slate-900">{BRAND_NAME}</h1>
          <p className="mb-6 text-sm text-slate-600">Bitte legen Sie jetzt ein eigenes Passwort fest. Das Startpasswort gilt nur für die erste Anmeldung.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="current-password">Startpasswort</Label>
              <Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="new-password">Neues Passwort (mindestens {TENANT_MIN_PASSWORD_LENGTH} Zeichen)</Label>
              <Input id="new-password" type="password" autoComplete="new-password" required minLength={TENANT_MIN_PASSWORD_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="repeat-password">Neues Passwort wiederholen</Label>
              <Input id="repeat-password" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Wird gespeichert …' : 'Passwort ändern'}
            </Button>
            <button type="button" className="w-full text-center text-sm text-slate-600 underline" onClick={() => void logout()}>
              Abmelden
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
