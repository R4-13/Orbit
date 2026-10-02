import { buildDonutArcs, type DonutSegmentInput } from '../lib/donut-segments';

export interface DonutChartProps {
  segments: DonutSegmentInput[];
  size?: number;
  strokeWidth?: number;
  /** Shown in the donut's empty center — typically the total count. */
  centerLabel?: string;
  centerSublabel?: string;
}

/**
 * Dependency-free SVG donut — deliberately not a charting library (no
 * React-19-peer-dependency risk, no bundle-size cost for two small chart
 * types in this app). `colorVar` on each segment is a CSS custom property
 * name (e.g. `--status-warning`), not a hex value, so the chart
 * automatically follows the same design tokens — and any tenant branding
 * override — everything else in the app already uses.
 */
export function DonutChart({ segments, size = 96, strokeWidth = 14, centerLabel, centerSublabel }: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const arcs = buildDonutArcs(segments, radius);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="inline-flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--surface-muted)" strokeWidth={strokeWidth} />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={`var(${arc.colorVar})`}
              strokeWidth={strokeWidth}
              strokeDasharray={arc.dasharray}
              strokeDashoffset={arc.dashoffset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        {centerLabel ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold text-slate-900">{centerLabel}</span>
            {centerSublabel ? <span className="text-[10px] text-slate-400">{centerSublabel}</span> : null}
          </div>
        ) : null}
      </div>
      <ul className="space-y-1 text-xs">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(${segment.colorVar})` }} />
            <span className="text-slate-500">{segment.label}</span>
            <span className="font-medium text-slate-900">{segment.value}</span>
          </li>
        ))}
        {total === 0 ? <li className="text-slate-400">Keine Daten</li> : null}
      </ul>
    </div>
  );
}
