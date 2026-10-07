'use client';

import { useState, type FormEvent } from 'react';
import { PLATFORM_ENVIRONMENTS } from '@orbit/shared';
import { Button, Input, Label } from '@orbit/ui';
import { platformErrorMessage, platformFetch } from '../../lib/platform/platform-client';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { usePlatformMutation, type AiOverview } from '../../lib/platform/use-platform-data';
import { ReasonForm } from './reason-form';

type Route = AiOverview['routes'][number];

export const FALLBACK_LABELS: Record<string, string> = {
  NO_FALLBACK: 'Kein Ausweichen',
  SAME_PROVIDER_FALLBACK: 'Ausweichen beim selben Anbieter',
  APPROVED_CROSS_PROVIDER_FALLBACK: 'Ausweichen zu freigegebenem anderen Anbieter',
};

interface ActivationPreview {
  routeId: string;
  activatable: boolean;
  issues: Array<{ code: string; message: string }>;
  affectedTenants: number;
  replaces?: { routeId: string; primaryModelId: string };
}

/**
 * Route aktivieren: zuerst die Vorbedingungen und die Wirkung (betroffene Mandanten, ersetzte Route) ansehen. Eine nicht aktivierbare Route lässt sich
 * nicht bestätigen – der Grund steht da, statt dass die Änderung erst am Server scheitert.
 */
export function RouteActivation({ route, modelName, onClose }: { route: Route & { version: number }; modelName: (id: string) => string; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const [preview, setPreview] = useState<ActivationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activate = usePlatformMutation(({ reason }: { reason: string }) =>
    withStepUp(() => platformFetch(`/ai/routes/${encodeURIComponent(route.id)}/activate`, { method: 'POST', body: JSON.stringify({ expectedVersion: route.version, reason }) })),
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPreview(await platformFetch<ActivationPreview>(`/ai/routes/${encodeURIComponent(route.id)}/activation-preview`));
    } catch (err) {
      setError(platformErrorMessage(err, 'Die Vorschau konnte nicht ermittelt werden.'));
    } finally {
      setLoading(false);
    }
  }

  if (!preview) {
    return (
      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={load} disabled={loading}>{loading ? 'Wird geprüft …' : 'Vorbedingungen und Wirkung prüfen'}</Button>
          <Button variant="secondary" onClick={onClose}>Schließen</Button>
        </div>
      </div>
    );
  }

  if (!preview.activatable) {
    return (
      <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-4" role="alert">
        <p className="text-sm font-medium text-red-800">Diese Route kann noch nicht aktiviert werden:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-red-800">
          {preview.issues.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
        <Button variant="secondary" onClick={onClose}>Schließen</Button>
      </div>
    );
  }

  return (
    <ReasonForm
      id={`route-${route.id}`}
      effect={`Neue Aufrufe für ${route.modelProfileKey} in ${route.environment}${route.tenantScope ? ` (nur Mandant ${route.tenantScope})` : ''} laufen über ${modelName(route.primaryModelId)}. Betroffen: ${preview.affectedTenants} ${preview.affectedTenants === 1 ? 'Mandant' : 'Mandanten'}.${preview.replaces ? ` Die bisherige aktive Route (${modelName(preview.replaces.primaryModelId)}) wird abgelöst.` : ''} Laufende Aufrufe sind nicht betroffen.`}
      confirmLabel="Route aktivieren"
      onCancel={onClose}
      onConfirm={async (reason) => {
        await activate.mutateAsync({ reason });
        onClose();
      }}
    />
  );
}

export function RouteDeactivation({ route, onClose }: { route: Route & { version: number }; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const deactivate = usePlatformMutation(({ reason }: { reason: string }) =>
    withStepUp(() => platformFetch(`/ai/routes/${encodeURIComponent(route.id)}/deactivate`, { method: 'POST', body: JSON.stringify({ expectedVersion: route.version, reason }) })),
  );
  return (
    <ReasonForm
      id={`route-off-${route.id}`}
      effect={`Für ${route.modelProfileKey} gibt es danach keine aktive Route mehr in ${route.environment}. Neue Aufrufe laufen über die Umgebungskonfiguration (Bootstrap), sofern vorhanden, sonst melden sie ehrlich „nicht verfügbar“.`}
      confirmLabel="Route deaktivieren"
      danger
      onCancel={onClose}
      onConfirm={async (reason) => {
        await deactivate.mutateAsync({ reason });
        onClose();
      }}
    />
  );
}

export function CreateRouteForm({ overview, onDone }: { overview: AiOverview; onDone: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const publishedProfiles = [...new Set(overview.profiles.filter((p) => p.lifecycle === 'PUBLISHED').map((p) => p.profileKey))];
  const [profileKey, setProfileKey] = useState('');
  const [environment, setEnvironment] = useState<string>('development');
  const [primaryModelId, setPrimaryModelId] = useState('');
  const [fallbackIds, setFallbackIds] = useState<string[]>([]);
  const [fallbackMode, setFallbackMode] = useState('NO_FALLBACK');
  const [traffic, setTraffic] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const create = usePlatformMutation(() =>
    withStepUp(() => platformFetch('/ai/routes', { method: 'POST', body: JSON.stringify({ modelProfileKey: profileKey, environment, primaryModelId, fallbackModelIds: fallbackMode === 'NO_FALLBACK' ? [] : fallbackIds, fallbackMode, trafficPercent: traffic }) })),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync(undefined);
      onDone();
    } catch (err) {
      setError(platformErrorMessage(err, 'Die Route konnte nicht angelegt werden.'));
    }
  }

  const others = overview.models.filter((m) => m.id !== primaryModelId);

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-slate-200 bg-white p-4" aria-label="Route anlegen">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="route-profile">Profil</Label>
          <select id="route-profile" required value={profileKey} onChange={(e) => setProfileKey(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Bitte wählen</option>
            {publishedProfiles.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="route-env">Umgebung</Label>
          <select id="route-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            {PLATFORM_ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="route-model">Hauptmodell</Label>
          <select id="route-model" required value={primaryModelId} onChange={(e) => { setPrimaryModelId(e.target.value); setFallbackIds([]); }} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Bitte wählen</option>
            {overview.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.providerKey})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="route-fallback">Ausweichen bei Ausfall</Label>
          <select id="route-fallback" value={fallbackMode} onChange={(e) => setFallbackMode(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            {Object.entries(FALLBACK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Ein anderer Anbieter wird nur genutzt, wenn Profil und Datenrichtlinie es ausdrücklich erlauben.</p>
        </div>
        <div>
          <Label htmlFor="route-traffic">Anteil in Prozent</Label>
          <Input id="route-traffic" type="number" min={1} max={100} value={traffic} onChange={(e) => setTraffic(Number(e.target.value))} />
        </div>
      </div>
      {fallbackMode !== 'NO_FALLBACK' ? (
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Ausweichmodelle (in dieser Reihenfolge)</legend>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            {others.length === 0 ? <p className="text-sm text-slate-600">Es gibt kein weiteres Modell.</p> : null}
            {others.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={fallbackIds.includes(m.id)} onChange={(e) => setFallbackIds((cur) => (e.target.checked ? [...cur, m.id] : cur.filter((id) => id !== m.id)))} />
                {m.displayName} ({m.providerKey})
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <p className="text-xs text-slate-500">Eine neue Route ist zunächst inaktiv. Aktiviert wird sie danach nach einer Vorprüfung.</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || !profileKey || !primaryModelId}>{create.isPending ? 'Wird angelegt …' : 'Route anlegen'}</Button>
        <Button variant="secondary" onClick={onDone} disabled={create.isPending}>Abbrechen</Button>
      </div>
    </form>
  );
}

export function ProfilePublish({ profileKey, version, onClose }: { profileKey: string; version: number; onClose: () => void }) {
  const { withStepUp } = usePlatformAuth();
  const publish = usePlatformMutation(({ reason }: { reason: string }) =>
    withStepUp(() => platformFetch(`/ai/model-profiles/${encodeURIComponent(profileKey)}/versions/${version}/publish`, { method: 'POST', body: JSON.stringify({ reason }) })),
  );
  return (
    <ReasonForm
      id={`profile-${profileKey}-${version}`}
      effect="Die Version wird veröffentlicht und ist danach unveränderlich; Routen können sie verwenden. Änderungen erfordern eine neue Version."
      confirmLabel="Veröffentlichen"
      onCancel={onClose}
      onConfirm={async (reason) => {
        await publish.mutateAsync({ reason });
        onClose();
      }}
    />
  );
}
