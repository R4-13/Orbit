'use client';

import { useState } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Label } from '@orbit/ui';
import { ReasonForm } from '../../../components/platform/reason-form';
import { formatDateTime } from '../../../lib/format';
import { platformErrorMessage, platformFetch } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { useConnectors, useKillSwitches, usePlatformMutation, type ConnectorImpact, type ConnectorRow, type KillSwitchRow } from '../../../lib/platform/use-platform-data';

const LIFECYCLE_LABELS: Record<string, string> = {
  DRAFT: 'Entwurf',
  TESTING: 'Im Test',
  ACTIVE: 'Aktiv',
  DEPRECATED: 'Veraltet',
  SUSPENDED: 'Gesperrt',
  RETIRED: 'Abgeschaltet',
};
const LIFECYCLE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { ACTIVE: 'success', TESTING: 'info', DRAFT: 'neutral', DEPRECATED: 'warning', SUSPENDED: 'danger', RETIRED: 'danger' };
const TARGETS = ['ACTIVE', 'TESTING', 'DEPRECATED', 'SUSPENDED', 'RETIRED'] as const;

function KillSwitchCard({ item }: { item: KillSwitchRow }) {
  const { hasScope, withStepUp } = usePlatformAuth();
  const [open, setOpen] = useState(false);
  const change = usePlatformMutation(({ reason }: { reason: string }) =>
    withStepUp(() => platformFetch(`/kill-switches/${encodeURIComponent(item.key)}/${item.engaged ? 'release' : 'engage'}`, { method: 'POST', body: JSON.stringify({ reason, expectedVersion: item.version }) })),
  );
  const canWrite = hasScope(PLATFORM_SCOPES.KILLSWITCH_WRITE);

  return (
    <Card data-testid={`kill-switch-${item.key}`}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-slate-900">{item.title}</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{item.effect}</p>
          </div>
          <Badge tone={item.engaged ? 'danger' : 'success'}>{item.engaged ? 'Aktiv – Funktion gestoppt' : 'Nicht ausgelöst'}</Badge>
        </div>
        {item.reason ? (
          <p className="text-xs text-slate-500">
            Letzte Änderung{item.changedAt ? ` ${formatDateTime(item.changedAt)}` : ''}: {item.reason}
          </p>
        ) : null}
        {canWrite && !open ? (
          <Button variant={item.engaged ? 'secondary' : 'danger'} onClick={() => setOpen(true)}>
            {item.engaged ? 'Notschalter lösen' : 'Notschalter auslösen'}
          </Button>
        ) : null}
        {open ? (
          <ReasonForm
            id={`ks-${item.key}`}
            effect={item.engaged ? 'Die Funktion wird für alle Mandanten wieder freigegeben.' : item.effect}
            confirmLabel={item.engaged ? 'Jetzt lösen' : 'Jetzt auslösen'}
            danger={!item.engaged}
            onCancel={() => setOpen(false)}
            onConfirm={async (reason) => {
              await change.mutateAsync({ reason });
              setOpen(false);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConnectorRowItem({ item }: { item: ConnectorRow }) {
  const { hasScope, withStepUp } = usePlatformAuth();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(item.lifecycle === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED');
  const [impact, setImpact] = useState<ConnectorImpact & { effect?: string } | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const change = usePlatformMutation(({ reason }: { reason: string }) =>
    withStepUp(() => platformFetch(`/connectors/${encodeURIComponent(item.connectorKey)}/lifecycle`, { method: 'POST', body: JSON.stringify({ to: target, reason, expectedVersion: item.version }) })),
  );
  const canChange = hasScope(PLATFORM_SCOPES.CONNECTORS_WRITE) || hasScope(PLATFORM_SCOPES.CONNECTORS_SUSPEND);
  const restrictiveOnly = !hasScope(PLATFORM_SCOPES.CONNECTORS_WRITE);
  const targets = TARGETS.filter((t) => t !== item.lifecycle && (!restrictiveOnly || ['SUSPENDED', 'DEPRECATED', 'RETIRED'].includes(t)));

  async function openForm() {
    setImpactError(null);
    setImpact(null);
    setOpen(true);
    try {
      setImpact(await platformFetch<ConnectorImpact & { effect?: string }>(`/connectors/${encodeURIComponent(item.connectorKey)}/impact`));
    } catch (err) {
      setImpactError(platformErrorMessage(err, 'Die Wirkung konnte nicht ermittelt werden.'));
    }
  }

  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-medium text-slate-900">{item.name}</span>
          <span className="ml-2 text-xs text-slate-500">{item.provider} · {item.category}</span>
          <div className="text-xs text-slate-500">
            {item.activeConnections} aktive Verbindungen bei {item.tenantsAffected} Mandanten{item.reason ? ` · ${item.reason}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={LIFECYCLE_TONE[item.lifecycle] ?? 'neutral'}>{LIFECYCLE_LABELS[item.lifecycle] ?? item.lifecycle}</Badge>
          {canChange && !open && targets.length > 0 ? (
            <Button variant="secondary" onClick={openForm} aria-label={`Zustand von ${item.name} ändern`}>
              Zustand ändern
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <ReasonForm
          id={`conn-${item.connectorKey}`}
          effect={impactError ?? impact?.effect ?? 'Wirkung wird ermittelt …'}
          confirmLabel="Änderung bestätigen"
          danger={['SUSPENDED', 'RETIRED'].includes(target)}
          onCancel={() => setOpen(false)}
          onConfirm={async (reason) => {
            await change.mutateAsync({ reason });
            setOpen(false);
          }}
        >
          <div>
            <Label htmlFor={`conn-${item.connectorKey}-target`}>Neuer Zustand</Label>
            <select id={`conn-${item.connectorKey}-target`} value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              {targets.map((t) => (
                <option key={t} value={t}>
                  {LIFECYCLE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {impact ? <p className="text-sm text-slate-700">Betroffen: {impact.activeConnections} Verbindungen bei {impact.tenantsAffected} Mandanten.</p> : null}
        </ReasonForm>
      ) : null}
    </li>
  );
}

export default function PlatformControlPage() {
  const switches = useKillSwitches();
  const connectors = useConnectors();

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Notschalter und Anbindungen</h1>
        <p className="text-sm text-slate-600">Änderungen wirken sofort auf neue Aktionen, löschen keine Historie und werden mit Begründung im Audit festgehalten. Jede Änderung verlangt Ihr Passwort erneut.</p>
      </div>

      <section aria-labelledby="ks-heading" className="space-y-3">
        <h2 id="ks-heading" className="text-base font-semibold text-slate-900">Notschalter</h2>
        {switches.isLoading ? <p className="text-sm text-slate-600">Wird geladen …</p> : null}
        {switches.isError ? <ErrorState message={platformErrorMessage(switches.error, 'Die Notschalter konnten nicht geladen werden.')} onRetry={() => switches.refetch()} /> : null}
        {switches.data?.map((item) => <KillSwitchCard key={item.key} item={item} />)}
      </section>

      <section aria-labelledby="conn-heading">
        <Card>
          <CardHeader>
            <CardTitle id="conn-heading">Anbindungen im Katalog</CardTitle>
          </CardHeader>
          <CardContent>
            {connectors.isLoading ? <p className="text-sm text-slate-600">Wird geladen …</p> : null}
            {connectors.isError ? <ErrorState message={platformErrorMessage(connectors.error, 'Die Anbindungen konnten nicht geladen werden.')} onRetry={() => connectors.refetch()} /> : null}
            <ul className="divide-y divide-slate-100">{connectors.data?.map((item) => <ConnectorRowItem key={item.connectorKey} item={item} />)}</ul>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
