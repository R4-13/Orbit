'use client';

import { useState, type ReactNode } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState } from '@orbit/ui';
import { platformErrorMessage, platformFetch } from '../../../lib/platform/platform-client';
import { usePlatformAuth } from '../../../lib/platform/platform-auth';
import { useAiOverview, useAiUsage, usePlatformMutation } from '../../../lib/platform/use-platform-data';

const LIFECYCLE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ACTIVE: 'success',
  APPROVED: 'success',
  PUBLISHED: 'success',
  HEALTHY: 'success',
  DRAFT: 'neutral',
  UNKNOWN: 'neutral',
  TESTING: 'info',
  DEGRADED: 'warning',
  DEPRECATED: 'warning',
  DISABLED: 'danger',
  UNHEALTHY: 'danger',
  RETIRED: 'danger',
};
const tone = (value: string) => LIFECYCLE_TONE[value] ?? 'neutral';

function Section({ title, empty, children, count }: { title: string; empty: string; children: ReactNode; count: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} <span className="text-sm font-normal text-slate-500">({count})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{count === 0 ? <p className="text-sm text-slate-600">{empty}</p> : <ul className="divide-y divide-slate-100 text-sm">{children}</ul>}</CardContent>
    </Card>
  );
}

const money = (value: number | null, currency = 'USD') => (value === null ? 'ohne Kostenprofil' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 4 })} ${currency}`);

export default function PlatformAiPage() {
  const { hasScope, withStepUp } = usePlatformAuth();
  const { data, isLoading, isError, error, refetch } = useAiOverview();
  const canSeeCost = hasScope(PLATFORM_SCOPES.AI_COST_READ);
  const usage = useAiUsage(canSeeCost);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const bootstrap = usePlatformMutation(() => withStepUp(() => platformFetch('/ai/bootstrap-from-environment', { method: 'POST' })));

  if (isLoading) return <p className="text-sm text-slate-600">Wird geladen …</p>;
  if (isError || !data) return <ErrorState message={platformErrorMessage(error, 'Die KI-Steuerung konnte nicht geladen werden.')} onRetry={() => refetch()} />;

  const registryEmpty = data.providers.length === 0 && data.models.length === 0 && data.routes.length === 0;

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">KI-Steuerung</h1>
        <p className="text-sm text-slate-600">Register der Anbieter, Modelle, Profile und Routen. Geschäftsprozesse nutzen nur logische Profile; Anbieter und Modell wählt allein die Plattform.</p>
        <p className="mt-1 text-xs text-slate-500">Registrierte Adapter: {data.adapters.join(', ') || '–'}</p>
      </div>

      {registryEmpty ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-slate-700">
              Das Register ist leer. Solange das so bleibt, nutzt ORBIT die Konfiguration der Umgebung (Bootstrap) – ohne Routen, Gesundheitswerte oder Nutzungsmessung nach Profil.
            </p>
            {hasScope(PLATFORM_SCOPES.AI_WRITE) ? (
              <div className="space-y-2">
                <Button
                  disabled={bootstrap.isPending}
                  onClick={async () => {
                    setBootstrapError(null);
                    try {
                      await bootstrap.mutateAsync(undefined);
                    } catch (err) {
                      setBootstrapError(platformErrorMessage(err, 'Das Register konnte nicht angelegt werden.'));
                    }
                  }}
                >
                  {bootstrap.isPending ? 'Wird angelegt …' : 'Register aus der Umgebung anlegen'}
                </Button>
                {bootstrapError ? <p role="alert" className="text-sm text-red-700">{bootstrapError}</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Section title="Anbieter" count={data.providers.length} empty="Keine Anbieter registriert.">
        {data.providers.map((p) => (
          <li key={p.providerKey} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-slate-900">{p.displayName}</span> <span className="text-xs text-slate-500">{p.providerKey} · Adapter {p.adapterKey} · Regionen {p.supportedRegions.join(', ') || '–'}</span>
            </span>
            <Badge tone={tone(p.lifecycle)}>{p.lifecycle}</Badge>
          </li>
        ))}
      </Section>

      <Section title="Modelle" count={data.models.length} empty="Keine Modelle registriert.">
        {data.models.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-slate-900">{m.displayName}</span> <span className="text-xs text-slate-500">{m.providerKey} · {m.providerModelId} · Bewertung {m.evaluationStatus}</span>
              <span className="block text-xs text-slate-500">Kosten je Million Token: Eingabe {money(m.costInputPerMtok, m.costCurrency)} · Ausgabe {money(m.costOutputPerMtok, m.costCurrency)}</span>
            </span>
            <Badge tone={tone(m.lifecycle)}>{m.lifecycle}</Badge>
          </li>
        ))}
      </Section>

      <Section title="Profile" count={data.profiles.length} empty="Keine Profile vorhanden.">
        {data.profiles.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-slate-900">{p.profileKey}</span> <span className="text-xs text-slate-500">Version {p.version} · {p.purpose} · Ausweichen: {p.fallbackMode}</span>
            </span>
            <Badge tone={tone(p.lifecycle)}>{p.lifecycle}</Badge>
          </li>
        ))}
      </Section>

      <Section title="Routen" count={data.routes.length} empty="Keine Routen – Aufrufe laufen über die Umgebungskonfiguration.">
        {data.routes.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-slate-900">{r.modelProfileKey}</span> <span className="text-xs text-slate-500">{r.environment}{r.tenantScope ? ` · Mandant ${r.tenantScope}` : ''} · {r.trafficPercent} % · Ausweichen: {r.fallbackMode}</span>
            </span>
            <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Aktiv' : 'Inaktiv'}</Badge>
          </li>
        ))}
      </Section>

      <Section title="Plattformverbindungen" count={data.connections.length} empty="Keine Plattformverbindungen. Zugangsdaten werden nie angezeigt, nur ihr Zustand.">
        {data.connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-slate-900">{c.providerKey}</span> <span className="text-xs text-slate-500">{c.environment} · {c.credentialType} · Profile: {c.allowedProfileKeys.join(', ') || 'alle'}</span>
            </span>
            <Badge tone={tone(c.lastHealthStatus ?? c.lifecycle)}>{c.lastHealthStatus ?? c.lifecycle}</Badge>
          </li>
        ))}
      </Section>

      <Section title="Gesundheit" count={data.health.length} empty="Noch keine Messwerte – sie entstehen aus echten Aufrufen.">
        {data.health.map((h) => (
          <li key={`${h.providerKey}-${h.modelRef}-${h.environment}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium text-slate-900">{h.providerKey}</span> <span className="text-xs text-slate-500">{h.modelRef === '*' ? 'alle Modelle' : h.modelRef} · {h.environment} · {h.consecutiveFailures} Fehler in Folge</span>
            </span>
            <Badge tone={tone(h.status)}>{h.status}</Badge>
          </li>
        ))}
      </Section>

      {canSeeCost ? (
        <Section title="Nutzung der letzten 30 Tage (je Profil)" count={usage.data?.length ?? 0} empty={usage.isError ? platformErrorMessage(usage.error, 'Die Nutzung konnte nicht geladen werden.') : 'Keine gemessene Nutzung.'}>
          {usage.data?.map((u) => (
            <li key={u.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium text-slate-900">{u.key}</span>
              <span className="text-xs text-slate-600">
                {u.requests} Aufrufe · {u.inputTokens + u.outputTokens} Token · {u.avgLatencyMs === null ? '–' : `${u.avgLatencyMs} ms`} · Kosten {u.estimatedCost === null ? 'nicht berechenbar' : u.estimatedCost.toLocaleString('de-DE', { maximumFractionDigits: 4 })}
              </span>
            </li>
          ))}
        </Section>
      ) : null}
    </>
  );
}
