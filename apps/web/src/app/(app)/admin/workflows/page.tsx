'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentDefinition } from '@orbit/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, type BadgeTone } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import { formatDateTime } from '../../../../lib/format';
import { useAgentDefinitions } from '../../../../lib/hooks/use-agent-definitions';
import {
  useCreateWorkflowDefinition,
  useTriggerWorkflowDefinition,
  useTriggerWorkflowDefinitionAsync,
  useUpdateWorkflowDefinition,
  useWorkflowDefinitions,
  useWorkflowRuns,
  type WorkflowDefinitionWithSteps,
  type WorkflowStepInput,
} from '../../../../lib/hooks/use-workflow-definitions';

/** Polling-Intervall für den asynchronen Trigger-Modus (Millisekunden). */
const ASYNC_RUN_POLL_INTERVAL_MS = 1500;

const STATUS_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: 'Entwurf', tone: 'neutral' },
  ACTIVE: { label: 'Aktiv', tone: 'success' },
  DISABLED: { label: 'Deaktiviert', tone: 'danger' },
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  EMAIL: 'E-Mail',
  WEBHOOK: 'Webhook',
  SCHEDULE: 'Zeitplan',
  MANUAL: 'Manuell',
};

const RUN_STATUS_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  RUNNING: { label: 'Läuft', tone: 'info' },
  COMPLETED: { label: 'Abgeschlossen', tone: 'success' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'danger' },
};

interface StepDraft {
  order: number;
  agentDefinitionKey: string;
  inputMappingJson: string;
  conditionField: string;
  conditionEquals: string;
}

interface RawWorkflowStep {
  order: number;
  agentDefinitionKey: string;
  inputMapping?: unknown;
  condition?: unknown;
}

function stepsToDraft(steps: RawWorkflowStep[]): StepDraft[] {
  return steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((step) => {
      const condition = step.condition as { field?: string; equals?: string } | null | undefined;
      return {
        order: step.order,
        agentDefinitionKey: step.agentDefinitionKey,
        inputMappingJson: step.inputMapping ? JSON.stringify(step.inputMapping, null, 2) : '',
        conditionField: condition?.field ?? '',
        conditionEquals: condition?.equals ?? '',
      };
    });
}


/** Throws with a human-readable message if a draft can't become valid WorkflowStepInput[]. */
function draftToSteps(drafts: StepDraft[]): WorkflowStepInput[] {
  return drafts.map((draft, index) => {
    let inputMapping: Record<string, string> | undefined;
    if (draft.inputMappingJson.trim()) {
      try {
        inputMapping = JSON.parse(draft.inputMappingJson) as Record<string, string>;
      } catch {
        throw new Error(`Schritt ${index + 1}: Input-Mapping ist kein gültiges JSON.`);
      }
    }
    const condition = draft.conditionField.trim() ? { field: draft.conditionField.trim(), equals: draft.conditionEquals } : undefined;
    if (!draft.agentDefinitionKey) {
      throw new Error(`Schritt ${index + 1}: bitte einen Agenten auswählen.`);
    }
    return { order: index + 1, agentDefinitionKey: draft.agentDefinitionKey, inputMapping, condition };
  });
}

function StepEditor({
  drafts,
  setDrafts,
  agentOptions,
}: {
  drafts: StepDraft[];
  setDrafts: (drafts: StepDraft[]) => void;
  agentOptions: AgentDefinition[];
}) {
  function updateStep(index: number, patch: Partial<StepDraft>) {
    setDrafts(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function addStep() {
    setDrafts([...drafts, { order: drafts.length + 1, agentDefinitionKey: '', inputMappingJson: '', conditionField: '', conditionEquals: '' }]);
  }

  function removeStep(index: number) {
    setDrafts(drafts.filter((_, i) => i !== index).map((d, i) => ({ ...d, order: i + 1 })));
  }

  return (
    <div className="space-y-3">
      {drafts.map((draft, index) => (
        <div key={index} className="rounded-md border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Schritt {index + 1}</p>
            <Button variant="ghost" className="text-xs" onClick={() => removeStep(index)}>
              Entfernen
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`step-${index}-agent`}>Agent</Label>
              <select
                id={`step-${index}-agent`}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={draft.agentDefinitionKey}
                onChange={(event) => updateStep(index, { agentDefinitionKey: event.target.value })}
              >
                <option value="">— auswählen —</option>
                {agentOptions.map((agent) => (
                  <option key={agent.key} value={agent.key}>
                    {agent.name} ({agent.key})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`step-${index}-input`}>Input-Mapping (JSON, optional)</Label>
              <Input
                id={`step-${index}-input`}
                value={draft.inputMappingJson}
                onChange={(event) => updateStep(index, { inputMappingJson: event.target.value })}
                placeholder='{"companyName": "$.trigger.input.subject"}'
              />
            </div>
          </div>
          {index > 0 ? (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor={`step-${index}-cond-field`}>Bedingung: Feld (optional — leer = läuft immer)</Label>
                <Input
                  id={`step-${index}-cond-field`}
                  value={draft.conditionField}
                  onChange={(event) => updateStep(index, { conditionField: event.target.value })}
                  placeholder="$.steps[1].output.classify_message.category"
                />
              </div>
              <div>
                <Label htmlFor={`step-${index}-cond-equals`}>Bedingung: erwarteter Wert</Label>
                <Input
                  id={`step-${index}-cond-equals`}
                  value={draft.conditionEquals}
                  onChange={(event) => updateStep(index, { conditionEquals: event.target.value })}
                  placeholder="SALES"
                  disabled={!draft.conditionField.trim()}
                />
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <Button variant="secondary" onClick={addStep}>
        + Schritt hinzufügen
      </Button>
    </div>
  );
}

function WorkflowDefinitionCard({ definition, agentOptions }: { definition: WorkflowDefinitionWithSteps; agentOptions: AgentDefinition[] }) {
  const queryClient = useQueryClient();
  const update = useUpdateWorkflowDefinition();
  const trigger = useTriggerWorkflowDefinition();
  const triggerAsync = useTriggerWorkflowDefinitionAsync();
  const [editing, setEditing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [showTrigger, setShowTrigger] = useState(false);
  const [drafts, setDrafts] = useState<StepDraft[]>(stepsToDraft(definition.steps));
  const [status, setStatus] = useState(definition.status);
  const [error, setError] = useState<string | null>(null);
  const [triggerInputJson, setTriggerInputJson] = useState('{}');
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [pendingAsyncRunId, setPendingAsyncRunId] = useState<string | null>(null);
  const { data: runs } = useWorkflowRuns(showRuns ? definition.key : undefined, {
    refetchInterval: pendingAsyncRunId ? ASYNC_RUN_POLL_INTERVAL_MS : false,
  });
  const pendingAsyncRun = pendingAsyncRunId ? runs?.find((r) => r.id === pendingAsyncRunId) : undefined;

  // Sobald der beobachtete Lauf einen Endzustand erreicht (COMPLETED/FAILED),
  // Polling stoppen und dieselben Folgedaten invalidieren, die der
  // synchrone Trigger direkt nach Abschluss invalidiert (agent-runs/approvals
  // können erst jetzt tatsächlich etwas Neues enthalten, siehe Hook-Kommentar).
  useEffect(() => {
    if (pendingAsyncRun && pendingAsyncRun.status !== 'RUNNING') {
      setPendingAsyncRunId(null);
      queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    }
  }, [pendingAsyncRun, queryClient]);

  function startEditing() {
    setDrafts(stepsToDraft(definition.steps));
    setStatus(definition.status);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setError(null);
    try {
      const steps = draftToSteps(drafts);
      await update.mutateAsync({ key: definition.key, steps, status });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error && !(err instanceof ApiError) ? err.message : err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    }
  }

  async function handleTrigger() {
    setTriggerError(null);
    try {
      const input = JSON.parse(triggerInputJson) as Record<string, unknown>;
      await trigger.mutateAsync({ key: definition.key, input });
      setShowRuns(true);
    } catch (err) {
      setTriggerError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Ausführung fehlgeschlagen.');
    }
  }

  async function handleTriggerAsync() {
    setTriggerError(null);
    try {
      const input = JSON.parse(triggerInputJson) as Record<string, unknown>;
      const result = await triggerAsync.mutateAsync({ key: definition.key, input });
      setPendingAsyncRunId(result.workflowRunId);
      setShowRuns(true);
    } catch (err) {
      setTriggerError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Ausführung fehlgeschlagen.');
    }
  }

  const statusInfo = STATUS_LABELS[definition.status] ?? { label: definition.status, tone: 'neutral' as const };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{definition.name}</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{definition.key}</span> · {TRIGGER_TYPE_LABELS[definition.triggerType] ?? definition.triggerType} ·{' '}
            {definition.steps.length} Schritt{definition.steps.length === 1 ? '' : 'e'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
          <Button variant="ghost" disabled={definition.status === 'DISABLED'} onClick={() => setShowTrigger((prev) => !prev)}>
            {showTrigger ? 'Ausführen ausblenden' : 'Ausführen'}
          </Button>
          <Button variant="ghost" onClick={() => setShowRuns((prev) => !prev)}>
            {showRuns ? 'Läufe ausblenden' : 'Läufe'}
          </Button>
          <Button variant="secondary" onClick={editing ? () => setEditing(false) : startEditing}>
            {editing ? 'Abbrechen' : 'Bearbeiten'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {definition.description ? <p className="text-sm text-slate-600">{definition.description}</p> : null}

        {!editing ? (
          <ol className="space-y-1.5 text-sm">
            {definition.steps
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((step) => (
                <li key={step.id} className="rounded-md bg-slate-50 px-3 py-2">
                  <span className="font-medium">Schritt {step.order}:</span> <span className="font-mono">{step.agentDefinitionKey}</span>
                  {step.condition ? (
                    <span className="ml-2 text-xs text-slate-500">
                      (nur wenn {(step.condition as { field: string }).field} = &bdquo;{(step.condition as { equals: string }).equals}&ldquo;)
                    </span>
                  ) : null}
                </li>
              ))}
          </ol>
        ) : (
          <div className="space-y-3">
            <StepEditor drafts={drafts} setDrafts={setDrafts} agentOptions={agentOptions} />
            <div>
              <Label htmlFor={`wf-${definition.key}-status`}>Status</Label>
              <select
                id={`wf-${definition.key}-status`}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={status}
                onChange={(event) => setStatus(event.target.value as WorkflowDefinitionWithSteps['status'])}
              >
                {Object.entries(STATUS_LABELS).map(([value, info]) => (
                  <option key={value} value={value}>
                    {info.label}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={handleSave} disabled={update.isPending}>
              Speichern
            </Button>
          </div>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {showTrigger ? (
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Ausführen — löst einen echten Workflow-Lauf aus</p>
            <Label htmlFor={`wf-${definition.key}-trigger-input`}>Eingabe (JSON, unter $.trigger.input verfügbar)</Label>
            <textarea
              id={`wf-${definition.key}-trigger-input`}
              rows={3}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={triggerInputJson}
              onChange={(event) => setTriggerInputJson(event.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button onClick={handleTrigger} disabled={trigger.isPending || Boolean(pendingAsyncRunId)}>
                Workflow ausführen
              </Button>
              <Button
                variant="secondary"
                onClick={handleTriggerAsync}
                disabled={triggerAsync.isPending || Boolean(pendingAsyncRunId)}
                title="Reiht den Lauf über die Redis-Queue ein und antwortet sofort — Fortschritt wird per Polling beobachtet (docs/SCALABILITY_CONCEPT.md)"
              >
                Asynchron ausführen
              </Button>
            </div>
            {triggerError ? <p className="mt-2 text-sm text-red-600">{triggerError}</p> : null}
            {trigger.data ? (
              <div className="mt-3 space-y-1.5">
                <Badge tone={trigger.data.status === 'COMPLETED' ? 'success' : 'danger'}>{trigger.data.status}</Badge>
                <ul className="space-y-1">
                  {trigger.data.steps.map((s) => (
                    <li key={s.order} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs">
                      <span>
                        Schritt {s.order}: <span className="font-mono">{s.agentDefinitionKey}</span>
                      </span>
                      <Badge tone={s.skipped ? 'neutral' : 'success'}>{s.skipped ? 'Übersprungen' : 'Ausgeführt'}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {pendingAsyncRunId ? (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs">
                <Badge tone="info">Läuft …</Badge>
                <span className="text-slate-500">
                  Lauf <span className="font-mono">{pendingAsyncRunId}</span> wird alle {ASYNC_RUN_POLL_INTERVAL_MS / 1000}s per Polling
                  (<span className="font-mono">GET .../runs</span>) abgefragt.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {showRuns ? (
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Bisherige Läufe</p>
            {runs && runs.length > 0 ? (
              <ul className="space-y-1.5">
                {runs.map((run) => {
                  const info = RUN_STATUS_LABELS[run.status] ?? { label: run.status, tone: 'neutral' as const };
                  return (
                    <li key={run.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs">
                      <span>
                        {formatDateTime(run.startedAt)} — {run.stepRuns.length} Schritt{run.stepRuns.length === 1 ? '' : 'e'}
                      </span>
                      <Badge tone={info.tone}>{info.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">Noch keine Läufe.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CreateWorkflowForm({ agentOptions }: { agentOptions: AgentDefinition[] }) {
  const create = useCreateWorkflowDefinition();
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<'EMAIL' | 'WEBHOOK' | 'SCHEDULE' | 'MANUAL'>('MANUAL');
  const [drafts, setDrafts] = useState<StepDraft[]>([{ order: 1, agentDefinitionKey: '', inputMappingJson: '', conditionField: '', conditionEquals: '' }]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKey('');
    setName('');
    setDescription('');
    setDrafts([{ order: 1, agentDefinitionKey: '', inputMappingJson: '', conditionField: '', conditionEquals: '' }]);
    setError(null);
  }

  async function handleCreate() {
    setError(null);
    try {
      const steps = draftToSteps(drafts);
      await create.mutateAsync({ key, name, description: description || undefined, triggerType, steps });
      reset();
      setExpanded(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Neuen Workflow anlegen</CardTitle>
        <Button variant="secondary" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? 'Abbrechen' : 'Neu'}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">
            Wird als Entwurf angelegt. Schritte laufen in der angegebenen Reihenfolge; eine Bedingung (ab Schritt 2) prüft den Output eines
            vorherigen Schritts, z. B. <code>$.steps[1].output.classify_message.category</code>.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-wf-key">Schlüssel</Label>
              <Input id="new-wf-key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sales-intake-workflow" />
            </div>
            <div>
              <Label htmlFor="new-wf-name">Name</Label>
              <Input id="new-wf-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sales-Intake-Workflow" />
            </div>
          </div>
          <div>
            <Label htmlFor="new-wf-description">Beschreibung (optional)</Label>
            <Input id="new-wf-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-wf-trigger">Trigger-Typ (informativ — kein automatischer Auslöser in dieser Phase)</Label>
            <select
              id="new-wf-trigger"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={triggerType}
              onChange={(event) => setTriggerType(event.target.value as typeof triggerType)}
            >
              {Object.entries(TRIGGER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <StepEditor drafts={drafts} setDrafts={setDrafts} agentOptions={agentOptions} />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button onClick={handleCreate} disabled={create.isPending || !key || !name}>
            Anlegen
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function AdminWorkflowsPage() {
  const { data: definitions, isLoading } = useWorkflowDefinitions();
  const { data: agentDefinitions } = useAgentDefinitions();
  const agentOptions = (agentDefinitions ?? []).filter((a) => a.status === 'ACTIVE');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Orchestrierung</h1>
        <p className="mt-1 text-sm text-slate-500">
          Mehrere Agenten zu einem Prozess verketten. Ein Schritt kann vom Output eines vorherigen Schritts abhängig gemacht werden
          (Bedingung) und dessen Werte als Eingabe übernehmen (Input-Mapping). Nur Agenten mit Status &bdquo;Aktiv&ldquo; (siehe{' '}
          <a className="underline" href="/admin/agents">
            Agenten-Konfiguration
          </a>
          ) können als Schritt referenziert werden.
        </p>
      </div>

      <CreateWorkflowForm agentOptions={agentOptions} />

      {isLoading ? (
        <p className="text-sm text-slate-400">Wird geladen …</p>
      ) : definitions && definitions.length > 0 ? (
        <div className="space-y-4">
          {definitions.map((definition) => (
            <WorkflowDefinitionCard key={definition.key} definition={definition} agentOptions={agentOptions} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Noch keine Workflows konfiguriert.</p>
      )}
    </div>
  );
}
