export interface BarChartSeries {
  key: string;
  label: string;
  colorVar: string;
}

export interface BarChartDatum {
  label: string;
  values: Record<string, number>;
}

export interface TrendBarChartProps {
  data: BarChartDatum[];
  series: BarChartSeries[];
  height?: number;
}

/**
 * Dependency-free stacked bar chart (flex/div-based, no SVG scaling math
 * needed) — same "no charting library" reasoning as `DonutChart`. Each
 * bar's segments are stacked bottom-up in `series` order; bar heights are
 * relative to the largest single-bar total across `data`, so an empty
 * dataset (`maxTotal === 0`) renders every bar at zero height rather than
 * dividing by zero.
 */
export function TrendBarChart({ data, series, height = 120 }: TrendBarChartProps) {
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0));
  const maxTotal = Math.max(...totals, 0);

  return (
    <div>
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((datum, index) => {
          const total = totals[index] ?? 0;
          return (
            <div key={datum.label} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height }}>
              <div className="flex w-full flex-1 flex-col-reverse items-stretch justify-start overflow-hidden rounded-sm bg-surface-muted">
                {series.map((s) => {
                  const value = datum.values[s.key] ?? 0;
                  const barHeightPercent = maxTotal > 0 ? (value / maxTotal) * 100 : 0;
                  if (value <= 0) return null;
                  return (
                    <div
                      key={s.key}
                      title={`${s.label}: ${value}`}
                      style={{ height: `${barHeightPercent}%`, backgroundColor: `var(${s.colorVar})` }}
                    />
                  );
                })}
              </div>
              <span className="text-[10px] text-slate-400">{total > 0 ? total : ''}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-3">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `var(${s.colorVar})` }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-2">
        {data.map((datum) => (
          <span key={datum.label} className="flex-1 text-center text-[10px] text-slate-400">
            {datum.label}
          </span>
        ))}
      </div>
    </div>
  );
}
