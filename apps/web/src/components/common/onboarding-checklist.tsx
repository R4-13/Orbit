'use client';

import Link from 'next/link';
import { Badge, Card } from '@orbit/ui';
import type { TenantProfileState } from '../../lib/hooks/use-organization';

/**
 * Einrichtung des Betriebs: was ORBIT noch wissen muss, um im Sinne des Unternehmens zu arbeiten. Berechnet aus dem aktuellen Stand (Profil, Mitarbeiter,
 * Regeln) – verschwindet von selbst, sobald alles erledigt ist, und meldet Lücken im Mitarbeiterverzeichnis, die im Ernstfall verhindern würden, dass jemand erreicht wird.
 */
export function OnboardingChecklist({ state, compact = false }: { state: TenantProfileState; compact?: boolean }) {
  const { steps, doneCount, complete, gaps } = state.onboarding;
  if (complete && gaps.length === 0) {
    return compact ? null : (
      <Card className="p-4" data-testid="onboarding-complete">
        <p className="text-sm text-emerald-700">Die Einrichtung ist vollständig – ORBIT kennt Ihren Betrieb und weiß, wen es wofür erreicht.</p>
      </Card>
    );
  }
  return (
    <Card className="p-5" data-testid="onboarding-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Einrichtung Ihres Betriebs</h2>
        <Badge tone={complete ? 'success' : 'warning'}>
          {doneCount} von {steps.length} erledigt
        </Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">Je besser ORBIT Ihren Betrieb kennt, desto selbstständiger kann es Anfragen verstehen, beantworten und die richtigen Personen informieren.</p>
      <progress className="mt-3 h-2 w-full" max={steps.length} value={doneCount} aria-label="Fortschritt der Einrichtung" />
      <ul className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2 text-sm" data-testid={`onboarding-step-${step.key}`} data-done={step.done}>
            <span aria-hidden className={step.done ? 'text-emerald-600' : 'text-slate-400'}>
              {step.done ? '✓' : '○'}
            </span>
            <span className="min-w-0 flex-1">
              {step.done ? (
                <span className="text-slate-600">{step.label}</span>
              ) : (
                <>
                  <Link href={step.href} className="font-medium text-brand hover:underline">
                    {step.label}
                  </Link>
                  <span className="block text-[13px] text-slate-600">{step.hint}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {gaps.length > 0 && !compact ? (
        <div className="mt-4 rounded-md bg-amber-50 p-3" data-testid="directory-gaps">
          <p className="text-sm font-medium text-amber-900">Lücken im Mitarbeiterverzeichnis</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-amber-900">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
