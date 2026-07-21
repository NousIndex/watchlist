"use client";

/**
 * Grouped bar chart on a single zero baseline.
 *
 * Deliberately NOT a dual-axis chart: Revolut overlays a profit-margin line in
 * percent on top of dollar bars, which makes the two scales' alignment
 * arbitrary and invents a correlation. Ratios are shown as a headline stat
 * above the chart instead, on their own terms.
 *
 * Values are never hover-gated — tapping a period selects it and the legend
 * prints that period's numbers, so every value is reachable by touch and by
 * keyboard.
 */

export interface BarSeries {
  key: string;
  label: string;
  /** Categorical slot from the validated palette. */
  color: string;
  values: (number | null)[];
}

interface Props {
  periods: string[];
  series: BarSeries[];
  format: (v: number) => string;
  selected: number;
  onSelect: (i: number) => void;
  height?: number;
}

/**
 * Round out to a clean axis bound. The ladder is deliberately fine-grained —
 * a coarse one (1/2/5/10) sends 595B up to 1T and throws away 40% of the
 * plot height.
 */
const LADDER = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceBound(v: number): number {
  if (v === 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
  const frac = Math.abs(v) / mag;
  const step = LADDER.find((s) => frac <= s + 1e-9) ?? 10;
  return Math.sign(v) * step * mag;
}

export function BarChart({ periods, series, format, selected, onSelect, height = 150 }: Props) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!periods.length || !all.length) return null;

  // Scale to rounded bounds so the gridline labels are readable numbers.
  const maxPos = niceBound(Math.max(0, ...all));
  const maxNeg = niceBound(Math.min(0, ...all));
  const span = maxPos - maxNeg || 1;
  // Split the plot between the positive and negative arms so both share one
  // scale and the zero line lands where the data says it should.
  const posH = (maxPos / span) * height;
  const negH = height - posH;

  return (
    <div className="bc">
      <div className="bc-plot" style={{ height }}>
        {/* Hairline gridlines — solid, one step off the surface, recessive.
            They carry the values for periods the legend isn't showing. */}
        {maxPos > 0 && (
          <div className="bc-grid" style={{ top: 0 }}>
            <span>{format(maxPos)}</span>
          </div>
        )}
        <div className="bc-zero" style={{ top: posH }} />
        {maxNeg < 0 && (
          <div className="bc-grid" style={{ top: height }}>
            <span>{format(maxNeg)}</span>
          </div>
        )}
        <div className="bc-cols">
          {periods.map((p, i) => (
            <button
              key={p + i}
              className={`bc-col${i === selected ? " on" : ""}`}
              onClick={() => onSelect(i)}
              aria-label={`${p}: ${series
                .map((s) => `${s.label} ${s.values[i] != null ? format(s.values[i]!) : "no data"}`)
                .join(", ")}`}
              aria-pressed={i === selected}
            >
              <span className="bc-bars">
                {series.map((s) => {
                  const v = s.values[i];
                  if (v == null) return <span key={s.key} className="bc-bar" />;
                  const style =
                    v >= 0
                      ? { bottom: negH, height: Math.max(2, (v / (maxPos || 1)) * posH) }
                      : { top: posH, height: Math.max(2, (Math.abs(v) / Math.abs(maxNeg || 1)) * negH) };
                  return (
                    <span key={s.key} className="bc-bar">
                      <span
                        className={`bc-fill${v < 0 ? " neg" : ""}`}
                        style={{ ...style, background: s.color }}
                      />
                    </span>
                  );
                })}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="bc-xaxis">
        {periods.map((p, i) => (
          <span key={p + i} className={i === selected ? "on" : ""}>
            {p}
          </span>
        ))}
      </div>
      {/* Legend is always present for >= 2 series, and carries the selected
          period's values so identity never rests on color alone. */}
      <div className="bc-legend">
        {series.map((s) => (
          <div key={s.key} className="bc-key">
            <span className="bc-dot" style={{ background: s.color }} />
            <span className="bc-key-txt">
              <span className="bc-key-lab">{s.label}</span>
              <span className="bc-key-val">
                {s.values[selected] != null ? format(s.values[selected]!) : "—"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
