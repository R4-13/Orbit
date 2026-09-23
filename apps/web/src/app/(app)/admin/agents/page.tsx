'use client';

import { useState } from 'react';
import type { AgentDefinition } from '@orbit/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, type BadgeTone } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import { formatDateTime } from '../../../../lib/format';
import {
  useAgentDefinitions,
  useAgentDefinitionVersions,
  useCreateAgentDefinition,
  useRollbackAgentDefinition,
  useTestRunAgentDefinition,
  useToolCatalog,
  useUpdateAgentDefinition,
  type TestRunResult,
  type ToolCatalogEntry,
} from '../../../../lib/hooks/use-agent-definitions';

const DECISION_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  ALLOW: { label: 'Ausgeführt', tone: 'success' },
  SUGGEST_ONLY: { label: 'Nur Vorschlag', tone: 'neutral' },
  REQUIRE_APPROVAL: { label: 'Wartet auf Freigabe', tone: 'warning' },
  DENY: { label: 'Verweigert', tone: 'danger' },
};

const STATUS_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: 'Entwurf', tone: 'neutral' },
  ACTIVE: { label: 'Aktiv', tone: 'success' },
  DISABLED: { label: 'Deaktiviert', tone: 'danger' },
};

const BASE_TYPE_LABELS: Record<string, string> = {
  ORCHESTRATOR: 'Orchestrator',
  COMMUNICATION: 'Communication',
  FINANCE: 'Finance',
  SALES: 'Sales',
};

function ToolCheckboxList({
  tools,
  selected,
  onToggle,
}: {
  tools: ToolCatalogEntry[];
  selected: string[];
  onToggle: (toolName: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-2">
      {tools.map((tool) => (
        <label key={tool.name} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={selected.includes(tool.name)}
            onChange={() => onToggle(tool.name)}
          />
          <span>
            <span className="font-mono text-xs font-medium text-slate-900">{tool.name}</span>
            <span className="block text-xs text-slate-500">{tool.description}</span>
            <span className="block text-xs text-slate-400">Policy-Action: {tool.policyAction}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function AgentDefinitionCard({ definition, tools }: { definition: AgentDefinition; tools: ToolCatalogEntry[] }) {
  const update = useUpdateAgentDefinition();
  const rollback = useRollbackAgentDefinition();
  const testRun = useTestRunAgentDefinition();
  const [editing, setEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showTestRun, setShowTestRun] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(definition.systemPrompt);
  const [allowedTools, setAllowedTools] = useState<string[]>(definition.allowedTools);
  const [status, setStatus] = useState(definition.status);
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const { data: versions } = useAgentDefinitionVersions(showVersions ? definition.key : undefined);

  function startEditing() {
    setSystemPrompt(definition.systemPrompt);
    setAllowedTools(definition.allowedTools);
    setStatus(definition.status);
    setChangeNote('');
    setError(null);
    setEditing(true);
  }

  function toggleTool(toolName: string) {
    setAllowedTools((prev) => (prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]));
  }

  async function handleSave() {
    setError(null);
    try {
      await update.mutateAsync({
        key: definition.key,
        systemPrompt,
        allowedTools,
        status,
        changeNote: changeNote || undefined,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Änderung konnte nicht gespeichert werden.');
    }
  }

  async function handleRollback(version: number) {
    setError(null);
    try {
      await rollback.mutateAsync({ key: definition.key, version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Der Rollback ist fehlgeschlagen.');
    }
  }

  async function handleTestRun() {
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testRun.mutateAsync({ key: definition.key, userMessage: testMessage });
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : 'Der Testlauf ist fehlgeschlagen.');
    }
  }

  const statusInfo = STATUS_LABELS[definition.status] ?? { label: definition.status, tone: 'neutral' as const };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{definition.name}</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{definition.key}</span> · {BASE_TYPE_LABELS[definition.baseType] ?? definition.baseType} ·
            Version {definition.version}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
          <Button
            variant="ghost"
            disabled={definition.status === 'DISABLED'}
            onClick={() => setShowTestRun((prev) => !prev)}
          >
            {showTestRun ? 'Testlauf ausblenden' : 'Testlauf'}
          </Button>
          <Button variant="ghost" onClick={() => setShowVersions((prev) => !prev)}>
            {showVersions ? 'Historie ausblenden' : 'Historie'}
          </Button>
          <Button variant="secondary" onClick={editing ? () => setEditing(false) : startEditing}>
            {editing ? 'Abbrechen' : 'Bearbeiten'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {definition.description ? <p className="text-sm text-slate-600">{definition.description}</p> : null}

        {!editing ? (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">System-Prompt</p>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                {definition.systemPrompt}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Erlaubte Tools</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {definition.allowedTools.map((toolName) => (
                  <Badge key={toolName} tone="info">
                    {toolName}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`prompt-${definition.key}`}>System-Prompt</Label>
              <textarea
                id={`prompt-${definition.key}`}
                rows={4}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Erlaubte Tools</p>
              <ToolCheckboxList tools={tools} selected={allowedTools} onToggle={toggleTool} />
            </div>
            <div className="flex items-end gap-3">
              <div>
                <Label htmlFor={`status-${definition.key}`}>Status</Label>
                <select
                  id={`status-${definition.key}`}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as AgentDefinition['status'])}
                >
                  {Object.entries(STATUS_LABELS).map(([value, info]) => (
                    <option key={value} value={value}>
                      {info.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <Label htmlFor={`note-${definition.key}`}>Änderungsnotiz (optional)</Label>
                <Input
                  id={`note-${definition.key}`}
                  value={changeNote}
                  onChange={(event) => setChangeNote(event.target.value)}
                  placeholder="z. B. „Prompt für höflicheren Ton angepasst“"
                />
              </div>
            </div>
            <Button onClick={handleSave} disabled={update.isPending || allowedTools.length === 0}>
              Speichern (neue Version)
            </Button>
          </div>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {showVersions ? (
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Versionshistorie</p>
            {versions && versions.length > 0 ? (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs">
                    <span>
                      <span className="font-medium">Version {v.version}</span> — {formatDateTime(v.createdAt)}
                      {v.changeNote ? <span className="text-slate-500"> · {v.changeNote}</span> : null}
                    </span>
                    {v.version !== definition.version ? (
                      <Button
                        variant="ghost"
                        className="text-xs"
                        disabled={rollback.isPending}
                        onClick={() => handleRollback(v.version)}
                      >
                        Wiederherstellen
                      </Button>
                    ) : (
                      <span className="text-slate-400">Aktuell</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">Wird geladen …</p>
            )}
          </div>
        ) : null}

        {showTestRun ? (
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Testlauf — führt den Agenten echt aus (inkl. Policy-Engine-Prüfung), erzeugt einen normalen Agent-Lauf
            </p>
            <div className="space-y-2">
              <textarea
                rows={3}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                placeholder="Nachricht, die als user-Eingabe an den Agenten geschickt wird …"
              />
              <Button onClick={handleTestRun} disabled={testRun.isPending || !testMessage}>
                Testlauf starten
              </Button>
            </div>
            {testError ? <p className="mt-2 text-sm text-red-600">{testError}</p> : null}
            {testResult ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs text-slate-500">
                  Agent-Lauf <span className="font-mono">{testResult.agentRunId}</span> —{' '}
                  <a className="underline" href={`/activity`}>
                    in Activity ansehen
                  </a>
                </p>
                {testResult.toolCallOutcomes.length === 0 ? (
                  <p className="text-xs text-slate-400">Keine Tool-Aufrufe.</p>
                ) : (
                  <ul className="space-y-1">
                    {testResult.toolCallOutcomes.map((outcome) => {
                      const decision = DECISION_LABELS[outcome.decision] ?? {
                        label: outcome.decision,
                        tone: 'neutral' as const,
                      };
                      return (
                        <li
                          key={outcome.toolCallId}
                          className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs"
                        >
                          <span className="font-mono">{outcome.toolName}</span>
                          <Badge tone={decision.tone}>{decision.label}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CreateAgentForm({ tools }: { tools: ToolCatalogEntry[] }) {
  const create = useCreateAgentDefinition();
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseType, setBaseType] = useState<'ORCHESTRATOR' | 'COMMUNICATION' | 'FINANCE' | 'SALES'>('SALES');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function toggleTool(toolName: string) {
    setAllowedTools((prev) => (prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]));
  }

  function reset() {
    setKey('');
    setName('');
    setDescription('');
    setSystemPrompt('');
    setAllowedTools([]);
    setError(null);
  }

  async function handleCreate() {
    setError(null);
    try {
      await create.mutateAsync({ key, name, description: description || undefined, baseType, systemPrompt, allowedTools });
      reset();
      setExpanded(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Der Agent konnte nicht angelegt werden.');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Neuen Agenten anlegen</CardTitle>
        <Button variant="secondary" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? 'Abbrechen' : 'Neu'}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">
            Wird als Entwurf (Status &bdquo;Entwurf&ldquo;) angelegt — erst nach Aktivierung von einem echten Workflow nutzbar.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-agent-key">Schlüssel (URL-fähig, z. B. &bdquo;support-agent&ldquo;)</Label>
              <Input id="new-agent-key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="support-agent" />
            </div>
            <div>
              <Label htmlFor="new-agent-name">Name</Label>
              <Input id="new-agent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Support-Agent" />
            </div>
          </div>
          <div>
            <Label htmlFor="new-agent-description">Beschreibung (optional)</Label>
            <Input id="new-agent-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-agent-base-type">Kategorie</Label>
            <select
              id="new-agent-base-type"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={baseType}
              onChange={(event) => setBaseType(event.target.value as typeof baseType)}
            >
              {Object.entries(BASE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="new-agent-prompt">System-Prompt</Label>
            <textarea
              id="new-agent-prompt"
              rows={4}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="Du bist ein ..."
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Erlaubte Tools</p>
            <ToolCheckboxList tools={tools} selected={allowedTools} onToggle={toggleTool} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button
            onClick={handleCreate}
            disabled={create.isPending || !key || !name || !systemPrompt || allowedTools.length === 0}
          >
            Anlegen
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function AdminAgentsPage() {
  const { data: definitions, isLoading } = useAgentDefinitions();
  const { data: tools } = useToolCatalog();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Agenten-Konfiguration</h1>
        <p className="mt-1 text-sm text-slate-500">
          Prompt und Tool-Zugriff der Agenten anpassen sowie neue Agenten anlegen. Jede Änderung erzeugt eine neue,
          wiederherstellbare Version. Die Policy-Engine (<a className="underline" href="/admin/policies">Agent-Autonomie</a>)
          entscheidet unabhängig davon weiterhin, ob ein erlaubtes Tool auch tatsächlich autonom ausgeführt werden
          darf.
        </p>
      </div>

      <CreateAgentForm tools={tools ?? []} />

      {isLoading ? (
        <p className="text-sm text-slate-400">Wird geladen …</p>
      ) : definitions && definitions.length > 0 ? (
        <div className="space-y-4">
          {definitions.map((definition) => (
            <AgentDefinitionCard key={definition.key} definition={definition} tools={tools ?? []} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Noch keine Agenten konfiguriert.</p>
      )}
    </div>
  );
}
