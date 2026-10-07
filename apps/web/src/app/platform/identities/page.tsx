'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { PLATFORM_ROLES, PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, ErrorState, Input, Label } from '@orbit/ui';
import { ReasonForm } from '../../../components/platform/reason-form';
import { formatDateTime } from '../../../lib/format';
import { platformErrorMessage, platformFetch } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { PLATFORM_ROLE_LABELS, platformRoleLabel } from '../../../lib/platform/role-labels';
import { useIdentities, usePlatformMutation, type IdentityRow } from '../../../lib/platform/use-platform-data';

const ROLE_KEYS = Object.values(PLATFORM_ROLES) as string[];

function RoleCheckboxes({ selected, onChange, idPrefix }: { selected: string[]; onChange: (roles: string[]) => void; idPrefix: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">Rollen</legend>
      <div className="mt-1 grid gap-2 md:grid-cols-2">
        {ROLE_KEYS.map((role) => (
          <label key={role} htmlFor={`${idPrefix}-${role}`} className="flex items-start gap-2 text-sm text-slate-700">
            <input id={`${idPrefix}-${role}`} type="checkbox" className="mt-1" checked={selected.includes(role)} onChange={(e) => onChange(e.target.checked ? [...selected, role] : selected.filter((r) => r !== role))} />
            <span>
              <span className="font-medium">{platformRoleLabel(role)}</span>
              <span className="block text-xs text-slate-500">{PLATFORM_ROLE_LABELS[role]?.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CreateIdentityForm({ onDone }: { onDone: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = usePlatformMutation(() => withStepUp(() => platformFetch('/identities', { method: 'POST', body: JSON.stringify({ email: email.trim(), displayName: displayName.trim(), password, roles }) })));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync(undefined);
      onDone();
    } catch (err) {
      setError(platformErrorMessage(err, 'Der Zugang konnte nicht angelegt werden.'));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-slate-200 bg-white p-4" aria-label="Betreiberzugang anlegen">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="id-email">E-Mail-Adresse</Label>
          <Input id="id-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="id-name">Name</Label>
          <Input id="id-name" required minLength={2} maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="id-password">Startpasswort (mindestens 14 Zeichen)</Label>
          <Input id="id-password" type="password" required minLength={14} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      <RoleCheckboxes selected={roles} onChange={setRoles} idPrefix="id-new-role" />
      <p className="text-xs text-slate-500">Ein Passwortwechsel durch die Person selbst ist noch nicht möglich. Das Startpasswort bleibt bis zu einer Neuanlage gültig – geben Sie es nur über einen sicheren Weg weiter.</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || roles.length === 0}>{create.isPending ? 'Wird angelegt …' : 'Zugang anlegen'}</Button>
        <Button variant="secondary" onClick={onDone} disabled={create.isPending}>Abbrechen</Button>
      </div>
    </form>
  );
}

function RoleEditor({ identity, onClose }: { identity: IdentityRow; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [roles, setRoles] = useState<string[]>(identity.roles);
  const [confirm, setConfirm] = useState(false);
  const unchanged = roles.slice().sort().join() === identity.roles.slice().sort().join();
  const save = usePlatformMutation(({ reason }: { reason: string }) => withStepUp(() => platformFetch(`/identities/${encodeURIComponent(identity.id)}/roles`, { method: 'PUT', body: JSON.stringify({ roles, reason }) })));
  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4" aria-label={`Rollen von ${identity.displayName} ändern`}>
      <RoleCheckboxes selected={roles} onChange={(next) => { setRoles(next); setConfirm(false); }} idPrefix={`role-${identity.id}`} />
      {!confirm ? (
        <div className="flex gap-2">
          <Button onClick={() => setConfirm(true)} disabled={unchanged || roles.length === 0}>Änderung prüfen</Button>
          <Button variant="secondary" onClick={onClose}>Schließen</Button>
        </div>
      ) : (
        <ReasonForm
          id={`roles-${identity.id}`}
          effect={`Die Rollen wechseln von „${identity.roles.map(platformRoleLabel).join(', ')}“ zu „${roles.map(platformRoleLabel).join(', ')}“. Alle laufenden Sitzungen dieser Person enden sofort.`}
          confirmLabel="Rollen ändern"
          onCancel={onClose}
          onConfirm={async (reason) => {
            await save.mutateAsync({ reason });
            onClose();
          }}
        />
      )}
    </div>
  );
}

function DisablePanel({ identity, onClose }: { identity: IdentityRow; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const disable = usePlatformMutation(({ reason }: { reason: string }) => withStepUp(() => platformFetch(`/identities/${encodeURIComponent(identity.id)}/disable`, { method: 'POST', body: JSON.stringify({ reason }) })));
  return (
    <ReasonForm
      id={`disable-${identity.id}`}
      effect={`${identity.displayName} kann sich nicht mehr anmelden; alle laufenden Sitzungen enden sofort. Der Zugang bleibt für das Audit erhalten. Der letzte aktive Owner lässt sich nicht deaktivieren.`}
      confirmLabel="Zugang deaktivieren"
      danger
      onCancel={onClose}
      onConfirm={async (reason) => {
        await disable.mutateAsync({ reason });
        onClose();
      }}
    />
  );
}

export default function PlatformIdentitiesPage() {
  const { principal, hasScope } = usePlatformAuth();
  const canManage = hasScope(PLATFORM_SCOPES.IDENTITY_MANAGE);
  const identities = useIdentities(canManage);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; action: 'roles' | 'disable' } | null>(null);

  if (!canManage) return <p className="text-sm text-slate-600">Die Verwaltung der Betreiberzugänge ist dem Owner vorbehalten.</p>;
  if (identities.isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (identities.isError || !identities.data) return <ErrorState message={platformErrorMessage(identities.error, 'Die Betreiberzugänge konnten nicht geladen werden.')} onRetry={() => identities.refetch()} />;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Betreiberzugänge</h1>
          <p className="max-w-3xl text-sm text-slate-600">Wer die Plattform bedienen darf und mit welcher Rolle. Rollen stehen nie im Anmelde-Token; Änderungen und Deaktivierungen wirken sofort und beenden laufende Sitzungen.</p>
        </div>
        {!creating ? <Button onClick={() => setCreating(true)}>Zugang anlegen</Button> : null}
      </div>
      {creating ? <CreateIdentityForm onDone={() => setCreating(false)} /> : null}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Betreiberzugänge</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Person</th>
                <th scope="col" className="px-4 py-2 font-medium">Rollen</th>
                <th scope="col" className="px-4 py-2 font-medium">Zustand</th>
                <th scope="col" className="px-4 py-2 font-medium">Letzte Anmeldung</th>
                <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {identities.data.map((identity) => {
                const own = identity.id === principal?.userId;
                const isOpen = open?.id === identity.id;
                return (
                  <Fragment key={identity.id}>
                    <tr className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{identity.displayName}{own ? ' (Sie)' : ''}</div>
                        <div className="text-xs text-slate-500">{identity.email}</div>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{identity.roles.map(platformRoleLabel).join(', ') || '–'}</td>
                      <td className="px-4 py-2"><Badge tone={identity.status === 'ACTIVE' ? 'success' : 'neutral'}>{identity.status === 'ACTIVE' ? 'Aktiv' : 'Deaktiviert'}</Badge></td>
                      <td className="px-4 py-2 text-slate-700">{identity.lastLoginAt ? formatDateTime(identity.lastLoginAt) : 'noch nie'}</td>
                      <td className="px-4 py-2">
                        {identity.status === 'ACTIVE' ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="secondary" onClick={() => setOpen({ id: identity.id, action: 'roles' })} aria-label={`Rollen von ${identity.displayName} ändern`}>Rollen</Button>
                            <Button variant="danger" onClick={() => setOpen({ id: identity.id, action: 'disable' })} aria-label={`Zugang von ${identity.displayName} deaktivieren`}>Deaktivieren</Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-slate-100">
                        <td colSpan={5} className="px-4 pb-4">
                          {open?.action === 'roles' ? <RoleEditor identity={identity} onClose={() => setOpen(null)} /> : <DisablePanel identity={identity} onClose={() => setOpen(null)} />}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
