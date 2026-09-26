import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminOverview } from "./api";
import { formatNumber } from "./format";

type Day = AdminOverview["series"][number];

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
    const max = niceMax(Math.max(0, ...series.map((d) => d.games + d.dailies)));
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
    const ticks = [0, max / 4, max / 2, (3 * max) / 4, max].filter((t) => Number.isInteger(t));
    return { plotW, plotH, band, barW, max, y, ticks };
  }, [series, width]);

  const total = series.reduce((sum, d) => sum + d.games + d.dailies, 0);
  const hovered = hover !== null ? series[hover] : null;

  return (
    <div className="adm-chart">
      <div className="adm-chart-toolbar">
        <div className="adm-legend" aria-hidden={asTable}>
          <span><i className="adm-swatch is-1" /> Games recorded</span>
          <span><i className="adm-swatch is-2" /> Daily challenges</span>
        </div>
        <button type="button" className="adm-link-btn" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div className="adm-table-wrap is-short">
          <table className="adm-table">
            <thead>
              <tr><th>Day (UTC)</th><th className="num">Games</th><th className="num">Dailies</th><th className="num">Active users</th><th className="num">Signups</th></tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td><td className="num">{d.games}</td><td className="num">{d.dailies}</td><td className="num">{d.activeUsers}</td><td className="num">{d.signups}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="adm-chart-plot" ref={plotRef} onMouseLeave={() => setHover(null)}>
          {total === 0 && <div className="adm-chart-empty">No recorded activity in the last 30 days</div>}
          <svg width={width} height={HEIGHT} role="img" aria-label={`Daily activity, last 30 days: ${total} plays in total`}>
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
              const gamesTop = geometry.y(d.games);
              const dailyTop = geometry.y(d.games + d.dailies);
              const hasGames = d.games > 0;
              const hasDailies = d.dailies > 0;
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
                    aria-label={`${d.date}: ${d.games} games, ${d.dailies} dailies, ${d.activeUsers} active users`}
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
                top: Math.max(8, geometry.y(hovered.games + hovered.dailies) - 12),
              }}
            >
              <strong>{shortDate(hovered.date)}</strong>
              <span><i className="adm-swatch is-1" /> {hovered.games} games</span>
              <span><i className="adm-swatch is-2" /> {hovered.dailies} dailies</span>
              <span className="adm-tooltip-muted">{hovered.activeUsers} active · {hovered.signups} signups</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
