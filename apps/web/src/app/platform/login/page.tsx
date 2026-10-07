'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Input, Label } from '@orbit/ui';
import { PlatformApiError } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

export default function PlatformLoginPage() {
  const router = useRouter();
  const { login } = usePlatformAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.replace('/platform');
    } catch (err) {
      if (err instanceof PlatformApiError && err.status === 401) setError('E-Mail-Adresse oder Passwort ist nicht korrekt.');
      else if (err instanceof PlatformApiError && err.status === 429) setError('Zu viele Versuche. Bitte warten Sie einige Minuten.');
      else if (err instanceof PlatformApiError && err.code === 'PLATFORM_NOT_CONFIGURED') setError('Der Plattformbetrieb ist in dieser Umgebung nicht eingerichtet.');
      else setError('Anmeldung ist gerade nicht möglich. Bitte später erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <h1 className="mb-1 text-lg font-semibold text-slate-900">{BRAND_NAME} · Plattformbetrieb</h1>
          <p className="mb-6 text-sm text-slate-600">Anmeldung für Betreiberzugänge. Mandantenkonten melden sich über die normale Anmeldung an.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="platform-email">E-Mail-Adresse</Label>
              <Input id="platform-email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="platform-password">Passwort</Label>
              <Input id="platform-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Anmeldung läuft …' : 'Anmelden'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
