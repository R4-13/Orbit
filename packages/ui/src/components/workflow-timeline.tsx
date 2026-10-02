export interface WorkflowTimelineStep {
  label: string;
  /** Real, aggregated count for this step — never a fabricated/simulated number. */
  count: number;
  /**
   * Pre-formatted, e.g. via the app's own date formatter — this component
   * does no locale/timezone formatting itself (same division of
   * responsibility as `TrendBarChart`'s pre-aggregated `data`).
   */
  timestamp?: string;
}

export interface WorkflowTimelineProps {
  steps: WorkflowTimelineStep[];
}

/**
 * Vertical step/funnel visualization — e.g. "how many invoices have reached
 * at least this pipeline stage". Purely presentational (no non-trivial
 * geometry like `DonutChart`/`SegmentedBar`), so unlike those it has no
 * extracted pure-logic unit test — nothing here is more than a conditional
 * className. A step with `count === 0` renders as a hollow/inactive marker
 * instead of a filled one, so a stalled or not-yet-reached stage is visually
 * distinct from one that's actively processing data.
 */
export function WorkflowTimeline({ steps }: WorkflowTimelineProps) {
  return (
    <ol>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const active = step.count > 0;
        return (
          <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? <span className="absolute left-[5px] top-[14px] h-full w-px bg-slate-200" aria-hidden="true" /> : null}
            <span
              className={`relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${
                active ? 'border-[var(--status-success)] bg-[var(--status-success)]' : 'border-slate-300 bg-white'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{step.label}</span>
                <span className="text-sm font-semibold text-slate-700">{step.count}</span>
              </div>
              {step.timestamp ? <p className="text-xs text-slate-400">{step.timestamp}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
