'use client';

import { useState, type FormEvent } from 'react';
import { PLATFORM_MIN_PASSWORD_LENGTH } from '@orbit/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { PlatformApiError, platformFetch, platformMfaDisable, platformMfaEnable, platformMfaSetup, reloadPlatformSession } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { platformRoleLabel } from '../../../lib/platform/role-labels';

type MfaStep = { kind: 'idle' } | { kind: 'password' } | { kind: 'confirm'; secret: string; uri: string } | { kind: 'codes'; codes: string[] } | { kind: 'disable' };

/** Zweiter Faktor (PLT-02): einrichten (Passwort → Geheimnis in der App erfassen → ersten Code bestätigen → Wiederherstellungscodes notieren) und wieder abschalten. */
function MfaCard() {
  const { principal } = usePlatformAuth();
  const enabled = principal?.mfaEnabled === true;
  const [step, setStep] = useState<MfaStep>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageFor = (err: unknown, fallback: string) => (err instanceof PlatformApiError && (err.status === 400 || err.status === 401) ? (err.status === 401 ? 'Passwort oder Code ist nicht korrekt.' : err.message) : err instanceof PlatformApiError && err.status === 429 ? 'Zu viele Versuche. Bitte warten Sie einige Minuten.' : fallback);

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(messageFor(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setStep({ kind: 'idle' });
    setPassword('');
    setCode('');
    setError(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zweiter Faktor (Authenticator-App)</CardTitle>
      </CardHeader>
      <CardContent className="max-w-md space-y-4">
        <p className="text-sm text-slate-600">
          {enabled ? 'Eingerichtet: Anmeldung und kritische Aktionen verlangen zusätzlich den Code Ihrer App.' : 'Nicht eingerichtet: Anmeldung und kritische Aktionen verlangen nur Ihr Passwort. Mit einer Authenticator-App wird das Konto deutlich besser geschützt.'}
        </p>
        {step.kind === 'idle' && !enabled ? <Button onClick={() => setStep({ kind: 'password' })}>Einrichten</Button> : null}
        {step.kind === 'idle' && enabled ? <Button variant="secondary" onClick={() => setStep({ kind: 'disable' })}>Abschalten</Button> : null}

        {step.kind === 'password' ? (
          <form aria-label="Zweiten Faktor einrichten" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const result = await platformMfaSetup(password); setPassword(''); setStep({ kind: 'confirm', secret: result.secret, uri: result.otpauthUri }); }, 'Die Einrichtung konnte nicht gestartet werden.'); }}>
            <div>
              <Label htmlFor="mfa-password">Passwort</Label>
              <Input id="mfa-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !password}>Weiter</Button>
              <Button variant="secondary" onClick={reset} disabled={busy}>Abbrechen</Button>
            </div>
          </form>
        ) : null}

        {step.kind === 'confirm' ? (
          <form aria-label="Zweiten Faktor bestätigen" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const result = await platformMfaEnable(code); setCode(''); setStep({ kind: 'codes', codes: result.recoveryCodes }); await reloadPlatformSession(); }, 'Die Einrichtung konnte nicht abgeschlossen werden.'); }}>
            <p className="text-sm text-slate-700">Tragen Sie dieses Geheimnis in Ihre Authenticator-App ein (Konto „manuell hinzufügen“, zeitbasiert) und geben Sie danach den angezeigten Code ein. Es wird nur jetzt angezeigt.</p>
            <p className="select-all break-all rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-sm" data-testid="mfa-secret">{step.secret}</p>
            <p className="break-all text-xs text-slate-500">Adresse für Apps, die sie lesen: {step.uri}</p>
            <div>
              <Label htmlFor="mfa-code">Code aus der App</Label>
              <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.trim().length < 6}>Bestätigen</Button>
              <Button variant="secondary" onClick={reset} disabled={busy}>Abbrechen</Button>
            </div>
          </form>
        ) : null}

        {step.kind === 'codes' ? (
          <div className="space-y-3" role="status">
            <p className="text-sm font-medium text-emerald-800">Der zweite Faktor ist eingerichtet.</p>
            <p className="text-sm text-slate-700">Notieren Sie diese Wiederherstellungscodes an einem sicheren Ort. Jeder gilt genau einmal und wird nur jetzt angezeigt – mit ihnen kommen Sie hinein, wenn Sie Ihr Gerät verlieren.</p>
            <ul className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm" data-testid="mfa-recovery-codes">
              {step.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button onClick={reset}>Ich habe sie notiert</Button>
          </div>
        ) : null}

        {step.kind === 'disable' ? (
          <form aria-label="Zweiten Faktor abschalten" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await platformMfaDisable(password, code); reset(); await reloadPlatformSession(); }, 'Der zweite Faktor konnte nicht abgeschaltet werden.'); }}>
            <div>
              <Label htmlFor="mfa-off-password">Passwort</Label>
              <Input id="mfa-off-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mfa-off-code">Aktueller Code (oder Wiederherstellungscode)</Label>
              <Input id="mfa-off-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy || !password || code.trim().length < 6}>Abschalten</Button>
              <Button variant="secondary" onClick={reset} disabled={busy}>Abbrechen</Button>
            </div>
          </form>
        ) : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

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
      <MfaCard />
    </>
  );
}
