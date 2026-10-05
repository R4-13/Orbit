'use client';

import { useState } from 'react';
import { BLUEPRINT_TRANSITIONS, type BlueprintStatus, type PlanIssue } from '@orbit/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, type BadgeTone } from '@orbit/ui';
import { errorMessage } from '../../../../lib/api-client';
import { formatDateTime } from '../../../../lib/format';
import { useBlueprintLifecycle, useBlueprints, useCapabilities, useImportBlueprint, useValidateBlueprint } from '../../../../lib/hooks/use-process-blueprints';

const STATUS_LABELS: Record<BlueprintStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: 'Entwurf', tone: 'neutral' },
  VALIDATING: { label: 'In Prüfung', tone: 'info' },
  TESTING: { label: 'Im Test', tone: 'info' },
  STAGED: { label: 'Bereit zur Veröffentlichung', tone: 'warning' },
  PUBLISHED: { label: 'Veröffentlicht', tone: 'success' },
  SUSPENDED: { label: 'Ausgesetzt', tone: 'danger' },
  DEPRECATED: { label: 'Veraltet', tone: 'neutral' },
  ARCHIVED: { label: 'Archiviert', tone: 'neutral' },
};

const TRANSITION_LABELS: Partial<Record<BlueprintStatus, string>> = {
  VALIDATING: 'Prüfung starten',
  TESTING: 'In den Test',
  STAGED: 'Bereitstellen',
  PUBLISHED: 'Veröffentlichen',
  SUSPENDED: 'Aussetzen',
  DEPRECATED: 'Als veraltet markieren',
  ARCHIVED: 'Archivieren',
  DRAFT: 'Zurück zum Entwurf',
};

function Issues({ issues }: { issues: PlanIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm" aria-label="Prüfbefunde">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={`rounded px-2 py-1 ${issue.severity === 'ERROR' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
          <span className="font-medium">{issue.severity === 'ERROR' ? 'Fehler' : 'Hinweis'}</span> · {issue.message} <span className="text-xs opacity-70">({issue.code})</span>
        </li>
      ))}
    </ul>
  );
}

/** Process Studio (Amendment 02 §17.4): import a schema-validated blueprint, walk it through its lifecycle, activate it per tenant. */
export default function ProcessesPage() {
  const blueprints = useBlueprints();
  const capabilities = useCapabilities();
  const validate = useValidateBlueprint();
  const importBlueprint = useImportBlueprint();
  const lifecycle = useBlueprintLifecycle();
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const parse = (): unknown | null => {
    try {
      setParseError(null);
      return JSON.parse(text) as unknown;
    } catch {
      setParseError('Das ist kein gültiges JSON.');
      return null;
    }
  };
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      setActionError(errorMessage(error, 'Die Aktion ist fehlgeschlagen.'));
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Prozesse</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ein Prozess ist ein versioniertes, geprüftes Datenpaket – kein Programmcode. Veröffentlichte Versionen sind unveränderlich; für Änderungen entsteht eine neue Version. Erst aktivierte Versionen starten neue Vorgänge.
        </p>
      </div>
      {actionError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Vorhandene Prozesse</CardTitle>
        </CardHeader>
        <CardContent>
          {blueprints.isError ? (
            <ErrorState message={errorMessage(blueprints.error, 'Die Prozesse konnten nicht geladen werden.')} onRetry={() => void blueprints.refetch()} />
          ) : blueprints.isLoading ? (
            <p className="text-sm text-slate-600">Wird geladen …</p>
          ) : blueprints.data && blueprints.data.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {blueprints.data.map((b) => (
                <li key={b.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{b.definition.title ?? b.key}</span>
                    <span className="text-xs text-slate-600">
                      {b.key} · Version {b.version}
                    </span>
                    <Badge tone={STATUS_LABELS[b.status].tone}>{STATUS_LABELS[b.status].label}</Badge>
                    {b.active ? <Badge tone="success">Aktiv für diesen Mandanten</Badge> : null}
                  </div>
                  {b.definition.description ? <p className="text-sm text-slate-600">{b.definition.description}</p> : null}
                  <p className="text-xs text-slate-600">
                    Prüfsumme {b.definitionHash.slice(0, 12)} · angelegt {formatDateTime(b.createdAt)}
                    {b.publishedAt ? ` · veröffentlicht ${formatDateTime(b.publishedAt)}` : ''} · Planungsmodus {b.definition.planMode ?? '–'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BLUEPRINT_TRANSITIONS[b.status].map((to) => (
                      <Button key={to} variant="secondary" disabled={lifecycle.transition.isPending} onClick={() => void run(() => lifecycle.transition.mutateAsync({ key: b.key, version: b.version, to }))}>
                        {TRANSITION_LABELS[to] ?? to}
                      </Button>
                    ))}
                    {b.status === 'PUBLISHED' && !b.active ? (
                      <Button disabled={lifecycle.activate.isPending} onClick={() => void run(() => lifecycle.activate.mutateAsync({ key: b.key, version: b.version }))}>
                        Für diesen Mandanten aktivieren
                      </Button>
                    ) : null}
                    {b.active ? (
                      <Button variant="danger" disabled={lifecycle.deactivate.isPending} onClick={() => void run(() => lifecycle.deactivate.mutateAsync({ key: b.key }))}>
                        Deaktivieren
                      </Button>
                    ) : null}
                  </div>
                  {b.validation && !b.validation.valid ? <Issues issues={b.validation.issues.filter((i) => i.severity === 'ERROR')} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Noch keine Prozessdefinition importiert.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prozessdefinition importieren</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Blueprint (JSON, Schema 1.0)</span>
            <textarea
              className="mt-1 h-56 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-describedby="blueprint-help"
            />
          </label>
          <p id="blueprint-help" className="text-xs text-slate-600">
            Unbekannte Schlüssel, nicht vorhandene Fähigkeiten, erfundene Empfänger oder Preise und unerreichbare Schritte werden abgelehnt. Der Import legt immer einen Entwurf an.
          </p>
          {parseError ? <p role="alert" className="text-sm text-red-700">{parseError}</p> : null}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!text.trim() || validate.isPending}
              onClick={() => {
                const definition = parse();
                if (definition !== null) void run(() => validate.mutateAsync(definition));
              }}
            >
              Prüfen
            </Button>
            <Button
              disabled={!text.trim() || importBlueprint.isPending}
              onClick={() => {
                const definition = parse();
                if (definition !== null) void run(() => importBlueprint.mutateAsync(definition));
              }}
            >
              Als Entwurf importieren
            </Button>
          </div>
          {validate.data ? (
            <div>
              <Badge tone={validate.data.valid ? 'success' : 'danger'}>{validate.data.valid ? 'Gültig' : 'Nicht gültig'}</Badge>
              <Issues issues={validate.data.issues} />
            </div>
          ) : null}
          {importBlueprint.data ? <p className="text-sm text-emerald-700">Importiert: {importBlueprint.data.key} {importBlueprint.data.version} (Entwurf).</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fähigkeiten dieses Mandanten</CardTitle>
          <p className="mt-1 text-xs text-slate-600">Was ORBIT hier tatsächlich ausführen kann – mit Gründen, falls etwas nicht verfügbar ist.</p>
        </CardHeader>
        <CardContent>
          {capabilities.isError ? (
            <ErrorState message={errorMessage(capabilities.error, 'Die Fähigkeiten konnten nicht geladen werden.')} onRetry={() => void capabilities.refetch()} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(capabilities.data ?? []).map((c) => (
                <li key={c.key} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{c.key}</span>
                    <Badge tone={c.executability?.executable ? 'success' : 'warning'}>{c.executability?.executable ? 'Ausführbar' : 'Nicht ausführbar'}</Badge>
                    <span className="text-xs text-slate-600">{c.sideEffect === 'EXTERNAL_WRITE' ? 'wirkt nach außen' : c.sideEffect === 'INTERNAL_WRITE' ? 'schreibt intern' : 'nur lesend'} · Risiko {c.riskClass}</span>
                  </div>
                  <p className="text-slate-600">{c.description}</p>
                  {c.executability && !c.executability.executable ? <p className="text-xs text-amber-800">{c.executability.reasons.join(' ')}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
