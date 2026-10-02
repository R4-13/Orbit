import type { DonutSegmentInput } from '../lib/donut-segments';
import { buildSegmentedBarParts } from '../lib/segmented-bar-parts';

export interface SegmentedBarProps {
  segments: DonutSegmentInput[];
  /** Bar height in px. */
  height?: number;
}

/**
 * Horizontal, proportionally-filled status bar — the same `DonutSegmentInput`
 * shape as `DonutChart` (reuses it directly, no separate segment type), just
 * a different, more compact rendering for the same kind of "distribution
 * across a few known categories" data. Dependency-free for the same reason
 * as `DonutChart`/`TrendBarChart` (no charting library, no React-19
 * peer-dependency risk). `colorVar` is a CSS custom property name, so the
 * bar automatically follows the same design tokens (and tenant branding
 * overrides) as everything else.
 */
export function SegmentedBar({ segments, height = 10 }: SegmentedBarProps) {
  const parts = buildSegmentedBarParts(segments);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-full bg-[var(--surface-muted)]" style={{ height }}>
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <div
              key={part.label}
              style={{ width: `${part.percent}%`, backgroundColor: `var(${part.colorVar})` }}
              title={`${part.label}: ${part.value} (${part.percent}%)`}
            />
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(${part.colorVar})` }} />
            <span className="text-slate-500">{part.label}</span>
            <span className="font-medium text-slate-900">{part.percent}%</span>
          </li>
        ))}
        {total === 0 ? <li className="text-slate-400">Keine Daten</li> : null}
      </ul>
    </div>
  );
}
