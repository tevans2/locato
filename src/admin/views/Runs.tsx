import type { AdminClient, AdminRun } from "../api";
import { formatDateTime, formatDuration, modeName } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource } from "../ui";
import { RUN_FLAG_LABELS } from "../../core/runAudit";

const CURVE_W = 168;
const CURVE_H = 40;
const COUNTRIES = 196;
/** The fastest honest pace on record so far: all 196 in 3:47. Steeper than this needs a look. */
const REFERENCE_MS = 227_000;

/**
 * Countries found over time. An honest run climbs in lumps (a region at a time) and flattens on
 * the hard ones at the end; a script is a straight line, often far steeper than the dashed
 * reference (the fastest honest run).
 */
export function RunCurve({ times }: { times: readonly number[] }) {
  if (times.length === 0) return <span className="adm-muted">—</span>;
  const spanMs = Math.max(times.at(-1)!, REFERENCE_MS);
  const x = (t: number) => (t / spanMs) * CURVE_W;
  const y = (count: number) => CURVE_H - (count / COUNTRIES) * CURVE_H;
  const points = times.map((t, index) => `${x(t).toFixed(1)},${y(index + 1).toFixed(1)}`).join(" ");
  return (
    <svg className="adm-run-curve" width={CURVE_W} height={CURVE_H} viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} role="img" aria-label={`${times.length} countries over ${formatDuration(times.at(-1)!)}`}>
      <title>{`${times.length} countries in ${formatDuration(times.at(-1)!)}. Dashed: the fastest honest run (196 in 3:47).`}</title>
      <line className="adm-run-curve-ref" x1={0} y1={CURVE_H} x2={x(REFERENCE_MS)} y2={0} />
      <polyline className="adm-run-curve-line" points={`0,${CURVE_H} ${points}`} />
    </svg>
  );
}

const VERDICT_TONE = { ok: "good", review: "warn", reject: "bad" } as const;

function outcomeLabel(run: AdminRun): string {
  if (run.finishedAt === null) return "never finished";
  const kind = run.timed ? "timed" : "practice";
  if (run.posted) return `${kind}, posted${run.refused ? " (refused)" : ""}`;
  return `${kind}, ${run.outcome === "complete" ? "finished" : run.outcome ?? "ended"}`;
}

/** One run per row: when, how it ended, its time and curve, and every check it raised. */
export function RunsTable({ runs, showPlayer = false, onOpenUser }: { runs: readonly AdminRun[]; showPlayer?: boolean; onOpenUser?: (id: string) => void }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-runs">
        <thead>
          <tr>
            <th>Started</th>
            {showPlayer && <th>Player</th>}
            <th>Run</th>
            <th className="num">Countries</th>
            <th className="num">Time</th>
            <th>Curve</th>
            <th>Checks</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const lasted = run.finishedAt !== null ? run.finishedAt - run.startedAt : null;
            return (
              <tr key={run.id} className={run.verdict === "reject" ? "is-flagged" : undefined}>
                <td>{formatDateTime(run.startedAt)}<div className="adm-muted adm-small" title={run.userAgent ?? undefined}>{run.ip ?? "—"}</div></td>
                {showPlayer && (
                  <td>{onOpenUser ? <button type="button" className="adm-link-btn" onClick={() => onOpenUser(run.userId)}>{run.displayName ?? run.userId}</button> : run.displayName}</td>
                )}
                <td>{modeName(run.gameMode)}<div className="adm-muted adm-small">{outcomeLabel(run)}</div></td>
                <td className="num">{run.countries}</td>
                <td className="num">
                  {run.claimedMs !== null ? formatDuration(run.claimedMs) : run.times.length ? formatDuration(run.times.at(-1)!) : "—"}
                  {lasted !== null && run.claimedMs !== null && !run.flags.some((item) => item.code === "no-ticket") && <div className="adm-muted adm-small" title="How long the run lasted by the server's clock">server {formatDuration(lasted)}</div>}
                </td>
                <td><RunCurve times={run.times} /></td>
                <td className="adm-run-checks">
                  {run.verdict && <Badge tone={VERDICT_TONE[run.verdict]}>{run.verdict}</Badge>}
                  {run.flags.map((item) => (
                    <Badge key={item.code} tone={item.severity === "reject" ? "bad" : "warn"} title={item.detail}>{RUN_FLAG_LABELS[item.code] ?? item.code}</Badge>
                  ))}
                  <div className="adm-muted adm-small">
                    {run.typedInputs} typed{run.scriptedInputs ? ` · ${run.scriptedInputs} scripted` : ""}{run.pastes ? ` · ${run.pastes} pasted` : ""}{run.hiddenMs ? ` · hidden ${formatDuration(run.hiddenMs)}` : ""}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every flagged run across all players, newest first. */
export function FlaggedRuns({ client, onOpenUser }: { client: AdminClient; onOpenUser: (id: string) => void }) {
  const runs = useResource(() => client.get<{ runs: AdminRun[] }>("/runs?limit=100"), [client]);
  const refused = runs.data?.runs.filter((run) => run.verdict === "reject").length ?? 0;
  return (
    <Panel
      title="Flagged runs"
      subtitle={runs.data ? `${runs.data.runs.length} flagged${refused ? ` · ${refused} failed a hard check` : ""} · hover a check for details` : " "}
      flush
    >
      {runs.error && <ErrorNote message={runs.error} onRetry={runs.refresh} />}
      {!runs.data ? <Loading /> : runs.data.runs.length === 0 ? <Empty>No flagged runs. Runs are audited from the moment this version went live.</Empty> : (
        <RunsTable runs={runs.data.runs} showPlayer onOpenUser={onOpenUser} />
      )}
    </Panel>
  );
}
