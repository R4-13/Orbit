'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, ErrorState } from '@orbit/ui';
import type { SetupStep, SetupStepKey, SetupTask } from '@orbit/shared';
import { errorMessage } from '../../../../lib/api-client';
import { useTenantSetup } from '../../../../lib/hooks/use-organization';
import { markSetupActive } from '../../../../components/setup/setup-return-link';

const STATUS: Record<SetupStep['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  DONE: { label: 'Erledigt', tone: 'success' },
  PARTIAL: { label: 'Teilweise', tone: 'warning' },
  OPEN: { label: 'Offen', tone: 'neutral' },
};

const TASK_STATE: Record<SetupTask['state'], { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  AUTOMATIC: { label: 'Selbstständig', tone: 'success' },
  WITH_APPROVAL: { label: 'Mit Ihrer Freigabe', tone: 'info' },
  BY_HAND: { label: 'Von Hand', tone: 'warning' },
  UNAVAILABLE: { label: 'Noch nicht möglich', tone: 'neutral' },
};

function StepCard({ step, index }: { step: SetupStep; index: number }) {
  const status = STATUS[step.status];
  const open = step.status !== 'DONE';
  return (
    <Card id={`step-${step.key}`} className="scroll-mt-4 p-5" data-testid={`setup-step-${step.key}`} data-status={step.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${step.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
            {step.status === 'DONE' ? '✓' : index + 1}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              {step.title}
              {!step.required ? <span className="ml-2 text-xs font-normal text-slate-600">optional</span> : null}
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-600">{step.why}</p>
          </div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <ul className="mt-3 space-y-1 pl-10" aria-label={`Einzelpunkte: ${step.title}`}>
        {step.items.map((item) => (
          <li key={item.label} className="flex items-start gap-2 text-sm" data-done={item.done}>
            <span aria-hidden className={item.done ? 'text-emerald-600' : 'text-slate-400'}>
              {item.done ? '✓' : '○'}
            </span>
            <span className={item.done ? 'text-slate-600' : 'text-slate-900'}>{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 pl-10">
        <Link href={step.action.href} onClick={() => markSetupActive(true)} className={open ? 'inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90' : 'inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50'}>
          {open ? step.action.label : 'Ändern'}
        </Link>
      </div>
    </Card>
  );
}

function TaskRow({ task, steps }: { task: SetupTask; steps: SetupStep[] }) {
  const state = TASK_STATE[task.state];
  const target = task.unlock ? steps.find((s) => s.key === task.unlock?.stepKey) : undefined;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 py-3 first:border-t-0" data-testid={`setup-task-${task.key}`} data-state={task.state}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{task.title}</p>
        <p className="mt-0.5 max-w-2xl text-[13px] text-slate-600">{task.detail}</p>
        {task.unlock && target ? (
          <a href={`#step-${task.unlock.stepKey as SetupStepKey}`} className="mt-1 inline-block text-[13px] font-medium text-brand hover:underline">
            {task.unlock.label}
          </a>
        ) : null}
      </div>
      <Badge tone={state.tone}>{state.label}</Badge>
    </li>
  );
}

/**
 * Einrichtungsassistent: führt durch alles, was ORBIT über den Betrieb und seine Systeme wissen muss, und zeigt am Ende, was ORBIT damit übernimmt – und was nicht.
 * Der Stand kommt aus dem tatsächlichen Zustand (nicht aus einer Merkliste): wer von einer Seite zurückkommt, sieht sofort, was erledigt ist.
 */
export default function SetupAssistantPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useTenantSetup();
  useEffect(() => {
    // Der Rückweg-Hinweis gilt nur, solange jemand unterwegs zu einer Seite ist; auf dem Assistenten selbst wird er zurückgesetzt.
    markSetupActive(false);
  }, []);

  if (isLoading) return <p className="text-sm text-slate-600" role="status">Der Stand der Einrichtung wird geladen …</p>;
  if (isError || !data) return <ErrorState message={errorMessage(error, 'Der Stand der Einrichtung konnte nicht geladen werden.')} onRetry={() => void refetch()} />;

  const next = data.steps.find((s) => s.required && s.status !== 'DONE');
  return (
    <div className="max-w-4xl space-y-4" data-testid="setup-assistant">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Einrichtungsassistent</h1>
            <p className="mt-0.5 max-w-3xl text-sm text-slate-600">
              ORBIT arbeitet so selbstständig, wie es Ihren Betrieb und Ihre Systeme kennt. Gehen Sie die Schritte der Reihe nach durch – jeder Schritt führt zur passenden Seite und Sie kommen mit einem Klick zurück.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? 'Prüfe …' : 'Stand aktualisieren'}
          </Button>
        </div>
        <div>
          <progress className="h-2 w-full" max={data.requiredTotal} value={data.requiredDone} aria-label="Fortschritt der Pflichtschritte" />
          <p className="mt-1 text-sm text-slate-700" data-testid="setup-progress">
            {data.requiredDone} von {data.requiredTotal} Pflichtschritten erledigt
          </p>
        </div>
      </header>

      {data.ready ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4" data-testid="setup-ready">
          <p className="text-sm font-medium text-emerald-900">ORBIT ist startklar.</p>
          <p className="mt-0.5 text-[13px] text-emerald-900">Alle Pflichtschritte sind erledigt. Die optionalen Schritte unten erweitern, was ORBIT für Sie übernimmt.</p>
        </Card>
      ) : next ? (
        <Card className="border-amber-200 bg-amber-50 p-4" data-testid="setup-next">
          <p className="text-sm font-medium text-amber-900">Als Nächstes: {next.title}</p>
          <p className="mt-0.5 text-[13px] text-amber-900">{next.why}</p>
        </Card>
      ) : null}

      <div className="space-y-3">
        {data.steps.map((step, index) => (
          <StepCard key={step.key} step={step} index={index} />
        ))}
      </div>

      <Card className="p-5" data-testid="setup-tasks">
        <h2 className="text-base font-semibold text-slate-900">Das übernimmt ORBIT für Sie</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-600">
          Das hängt davon ab, was Sie eingerichtet haben und welche Regeln gelten. ORBIT erfindet nichts: was hier „von Hand“ oder „noch nicht möglich“ heißt, macht ORBIT nicht – oder gibt es an Ihr Team weiter.
        </p>
        <ul className="mt-2">
          {data.tasks.map((task) => (
            <TaskRow key={task.key} task={task} steps={data.steps} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
