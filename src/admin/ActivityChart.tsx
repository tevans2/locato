import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminOverview } from "./api";
import { formatNumber } from "./format";

type Day = AdminOverview["series"][number];

/** One column: `lower` stacks under `upper`; `extras` show in the tooltip and table. */
export interface StackedDay {
  readonly date: string;
  readonly lower: number;
  readonly upper: number;
  readonly extras: readonly (readonly [label: string, value: number])[];
}

export interface StackedDayChartProps {
  readonly series: readonly StackedDay[];
  /** Legend/table names for the lower and upper stacks, e.g. ["Games recorded", "Daily challenges"]. */
  readonly labels: readonly [string, string];
  /** Tooltip nouns, e.g. ["games", "dailies"]. */
  readonly units: readonly [string, string];
  readonly emptyText: string;
  readonly ariaLabel: (total: number) => string;
}

const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 36 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

// Rect with only its top corners rounded: data-end rounded, square at the baseline.
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(day)} ${months[Number(month) - 1] ?? ""}`;
}

// Stacked daily columns: recorded games (bottom) and daily-challenge plays (top), last 30 days.
export function ActivityChart({ series }: { series: readonly Day[] }) {
  return (
    <StackedDayChart
      series={series.map((d) => ({ date: d.date, lower: d.games, upper: d.dailies, extras: [["Active users", d.activeUsers], ["Signups", d.signups]] }))}
      labels={["Games recorded", "Daily challenges"]}
      units={["games", "dailies"]}
      emptyText="No recorded activity in the last 30 days"
      ariaLabel={(total) => `Daily activity, last 30 days: ${total} plays in total`}
    />
  );
}

export function StackedDayChart({ series, labels, units, emptyText, ariaLabel }: StackedDayChartProps) {
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [asTable]);

  const geometry = useMemo(() => {
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const band = plotW / Math.max(series.length, 1);
    const barW = Math.min(MAX_BAR, Math.max(3, band * 0.62));
    const max = niceMax(Math.max(0, ...series.map((d) => d.lower + d.upper)));
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
    const ticks = [0, max / 4, max / 2, (3 * max) / 4, max].filter((t) => Number.isInteger(t));
    return { plotW, plotH, band, barW, max, y, ticks };
  }, [series, width]);

  const total = series.reduce((sum, d) => sum + d.lower + d.upper, 0);
  const hovered = hover !== null ? series[hover] : null;

  return (
    <div className="adm-chart">
      <div className="adm-chart-toolbar">
        <div className="adm-legend" aria-hidden={asTable}>
          <span><i className="adm-swatch is-1" /> {labels[0]}</span>
          <span><i className="adm-swatch is-2" /> {labels[1]}</span>
        </div>
        <button type="button" className="adm-link-btn" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div className="adm-table-wrap is-short">
          <table className="adm-table">
            <thead>
              <tr><th>Day (UTC)</th><th className="num">{labels[0]}</th><th className="num">{labels[1]}</th>{series[0]?.extras.map(([label]) => <th key={label} className="num">{label}</th>)}</tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td><td className="num">{d.lower}</td><td className="num">{d.upper}</td>{d.extras.map(([label, value]) => <td key={label} className="num">{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="adm-chart-plot" ref={plotRef} onMouseLeave={() => setHover(null)}>
          {total === 0 && <div className="adm-chart-empty">{emptyText}</div>}
          <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel(total)}>
            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line className="adm-grid" x1={PAD.left} x2={width - PAD.right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
                <text className="adm-axis" x={PAD.left - 8} y={geometry.y(tick)} dy="0.32em" textAnchor="end">{formatNumber(tick)}</text>
              </g>
            ))}
            {series.map((d, i) => {
              const cx = PAD.left + geometry.band * (i + 0.5);
              const x = cx - geometry.barW / 2;
              const base = geometry.y(0);
              const gamesTop = geometry.y(d.lower);
              const dailyTop = geometry.y(d.lower + d.upper);
              const hasGames = d.lower > 0;
              const hasDailies = d.upper > 0;
              // Weekly ticks anchored on today; the first day gets a label only if it isn't crowded.
              const last = series.length - 1;
              const showLabel = (last - i) % 7 === 0 || (i === 0 && (last - i) % 7 >= 3);
              return (
                <g key={d.date} className={hover === i ? "is-hovered" : undefined}>
                  {hasGames && (
                    hasDailies
                      ? <rect className="adm-bar is-1" x={x} y={gamesTop} width={geometry.barW} height={base - gamesTop} />
                      : <path className="adm-bar is-1" d={topRoundedRect(x, gamesTop, geometry.barW, base - gamesTop, RADIUS)} />
                  )}
                  {hasDailies && (
                    <path
                      className="adm-bar is-2"
                      d={topRoundedRect(x, dailyTop, geometry.barW, Math.max(0, gamesTop - dailyTop - (hasGames ? GAP : 0)), RADIUS)}
                    />
                  )}
                  {showLabel && <text className="adm-axis" x={cx} y={HEIGHT - 8} textAnchor="middle">{shortDate(d.date)}</text>}
                  <rect
                    className="adm-hit"
                    x={PAD.left + geometry.band * i}
                    y={PAD.top}
                    width={geometry.band}
                    height={geometry.plotH}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${d.date}: ${d.lower} ${units[0]}, ${d.upper} ${units[1]}${d.extras.map(([label, value]) => `, ${value} ${label.toLowerCase()}`).join("")}`}
                  />
                </g>
              );
            })}
            <line className="adm-baseline" x1={PAD.left} x2={width - PAD.right} y1={geometry.y(0)} y2={geometry.y(0)} />
          </svg>
          {hovered && hover !== null && (
            <div
              className="adm-tooltip"
              style={{
                left: Math.min(Math.max(PAD.left + geometry.band * (hover + 0.5), 90), width - 90),
                top: Math.max(8, geometry.y(hovered.lower + hovered.upper) - 12),
              }}
            >
              <strong>{shortDate(hovered.date)}</strong>
              <span><i className="adm-swatch is-1" /> {hovered.lower} {units[0]}</span>
              <span><i className="adm-swatch is-2" /> {hovered.upper} {units[1]}</span>
              {hovered.extras.length > 0 && <span className="adm-tooltip-muted">{hovered.extras.map(([label, value]) => `${value} ${label.toLowerCase()}`).join(" · ")}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
