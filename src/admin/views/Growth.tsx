import { useState } from "react";
import type { AdminClient, GrowthBreakdownRow, GrowthReport, RetentionRate } from "../api";
import { StackedDayChart } from "../ActivityChart";
import { formatCompact, formatNumber, modeName } from "../format";
import { Empty, ErrorNote, Loading, Panel, StatTile, useResource } from "../ui";

const RANGES = [7, 30, 90] as const;
// Below this many eligible visitors a rate is mostly noise; it's shown greyed with its count.
const SMALL_SAMPLE = 20;
const LINK_SOURCES = ["reddit", "tiktok", "instagram", "youtube", "discord", "whatsapp", "x", "directory", "friends"] as const;

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function Rate({ value }: { value: RetentionRate }) {
  if (value.rate === null) return <span className="adm-muted" title="No visitors old enough yet">—</span>;
  return (
    <span className={value.eligible < SMALL_SAMPLE ? "adm-muted" : undefined} title={`${value.eligible} visitor${value.eligible === 1 ? "" : "s"} counted`}>
      {percent(value.rate)} <small className="adm-muted">n={value.eligible}</small>
    </span>
  );
}

function gameName(game: string): string {
  if (game === "daily") return "Daily challenge";
  if (game === "multiplayer") return "Multiplayer";
  if (game === "academy") return "Academy";
  return modeName(game);
}

function Breakdown({ title, subtitle, rows, total, format = (key) => key }: { title: string; subtitle?: string; rows: readonly GrowthBreakdownRow[]; total: number; format?: (key: string) => string }) {
  return (
    <Panel title={title} subtitle={subtitle} flush>
      {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ul className="adm-bars">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="adm-bars-label">{format(row.key)}</span>
              <span className="adm-bars-track"><span style={{ width: `${(row.visitors / (rows[0]?.visitors || 1)) * 100}%` }} /></span>
              <span className="adm-bars-value">{row.visitors} <small>· {share(row.visitors, total)}</small></span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// Builds a tagged link for a post or video, so its visitors show up under their own source.
function LinkBuilder() {
  const [source, setSource] = useState<string>("reddit");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState(false);
  const params = new URLSearchParams({ view: "daily-challenge", utm_source: source });
  const slug = campaign.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug) params.set("utm_campaign", slug);
  const link = `${window.location.origin}/?${params.toString()}`;
  return (
    <Panel title="Tagged link" subtitle="Use one per post, video or directory listing so the Sources table can tell them apart">
      <div className="adm-growth-link">
        <label className="adm-field">
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {LINK_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Campaign (optional)</span>
          <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="r-geography-outlines" spellCheck={false} />
        </label>
        <code className="adm-growth-link-url">{link}</code>
        <button type="button" className="adm-btn is-primary" onClick={() => void navigator.clipboard?.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </Panel>
  );
}

export function GrowthView({ client }: { client: AdminClient }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const report = useResource(() => client.get<GrowthReport>(`/growth?days=${days}`), [client, days], 60_000);

  const rangePicker = (
    <div className="adm-chips" role="group" aria-label="Time range">
      {RANGES.map((range) => (
        <button key={range} type="button" className="adm-chip-btn" aria-pressed={range === days} onClick={() => setDays(range)}>{range} days</button>
      ))}
    </div>
  );

  if (!report.data) return <div className="adm-stack">{rangePicker}{report.error ? <ErrorNote message={report.error} onRetry={report.refresh} /> : <Loading />}</div>;
  const { summary, retention, cohorts, series, funnel, sources, games, landings, devices, countries, campaigns } = report.data;
  const funnelSteps: readonly [string, number][] = [
    ["Arrived", funnel.visited],
    ["Opened a game", funnel.openedGame],
    ["Finished a game", funnel.finishedGame],
    ["Shared a result", funnel.shared],
    ["Created an account", funnel.signedUp],
    ["Came back another day", funnel.cameBack],
  ];

  return (
    <div className="adm-stack">
      {rangePicker}

      <div className="adm-stats">
        <StatTile label="Active today" value={formatCompact(summary.activeToday)} hint={`${summary.active7d} in the last 7 days`} />
        <StatTile label={`Active · ${days}d`} value={formatCompact(summary.activeInWindow)} hint={`${summary.playersInWindow} finished a game`} />
        <StatTile label={`New visitors · ${days}d`} value={formatCompact(summary.newInWindow)} hint={`${summary.signupsInWindow} created an account`} />
        <StatTile label="D1 retention" value={percent(retention.d1.rate)} hint={`of ${retention.d1.eligible} new visitors · target 25–35%`} />
        <StatTile label="D7 retention" value={percent(retention.d7.rate)} hint={`${percent(retention.week1.rate)} back within a week · target 10–15%`} />
        <StatTile label="Stickiness" value={percent(summary.stickiness)} hint="Avg DAU (7d) ÷ 30-day actives" />
        <StatTile label="Games per player-day" value={summary.gamesPerPlayerDay === null ? "—" : summary.gamesPerPlayerDay.toFixed(1)} hint="Finished games on days they played" />
        <StatTile label={`Shares · ${days}d`} value={formatCompact(summary.sharesInWindow)} hint={`${summary.shareArrivals} new visitors arrived from shares`} />
      </div>

      <Panel title="Daily visitors" subtitle={`Anonymous visitors, signed in or not · ${report.data.from} to ${report.data.to}, UTC`}>
        <StackedDayChart
          series={series.map((d) => ({ date: d.date, lower: d.returning, upper: d.newVisitors, extras: [["Players", d.players], ["Games", d.games], ["Shares", d.shares]] }))}
          labels={["Returning", "New"]}
          units={["returning", "new"]}
          emptyText="No visitors recorded yet. Analytics starts counting from this deploy."
          ariaLabel={(total) => `Daily visitors over ${days} days: ${total} visitor-days`}
        />
      </Panel>

      <div className="adm-grid-2">
        <Panel title="New-visitor funnel" subtitle={`Everyone who first arrived in the last ${days} days`} flush>
          <ul className="adm-bars">
            {funnelSteps.map(([label, value]) => (
              <li key={label}>
                <span className="adm-bars-label">{label}</span>
                <span className="adm-bars-track"><span style={{ width: `${funnel.visited > 0 ? (value / funnel.visited) * 100 : 0}%` }} /></span>
                <span className="adm-bars-value">{formatNumber(value)} <small>· {share(value, funnel.visited)}</small></span>
              </li>
            ))}
          </ul>
          <p className="adm-footnote">Week-one return rate: {percent(retention.week1.rate)} of all new visitors, {percent(retention.week1Players.rate)} of those who finished a game on their first day.</p>
        </Panel>

        <Panel title="Weekly cohorts" subtitle="New visitors by the week they arrived · back exactly 1, 7 and 30 days later" flush>
          {cohorts.length === 0 ? <Empty>No new visitors in this range.</Empty> : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Week of</th><th className="num">New</th><th className="num">Played</th><th className="num">D1</th><th className="num">D7</th><th className="num">D30</th></tr></thead>
                <tbody>
                  {cohorts.map((cohort) => (
                    <tr key={cohort.week}>
                      <td>{cohort.week}</td>
                      <td className="num">{cohort.visitors}</td>
                      <td className="num">{share(cohort.played, cohort.visitors)}</td>
                      <td className="num"><Rate value={cohort.d1} /></td>
                      <td className="num"><Rate value={cohort.d7} /></td>
                      <td className="num"><Rate value={cohort.d30} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Sources" subtitle="Where new visitors came from (UTM tag or ?ref=, else the referring site) and what they did next" flush>
        {sources.length === 0 ? <Empty>No new visitors in this range.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Source</th><th className="num">New visitors</th><th className="num">Finished a game</th><th className="num">Back within a week</th><th className="num">Accounts</th></tr></thead>
              <tbody>
                {sources.map((row) => (
                  <tr key={row.source}>
                    <td>{row.source}</td>
                    <td className="num">{row.visitors}</td>
                    <td className="num">{share(row.played, row.visitors)}</td>
                    <td className="num"><Rate value={row.week1} /></td>
                    <td className="num">{row.signups}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="adm-footnote">WhatsApp and most apps send no referrer, so their visits show as "direct" unless the link is tagged. Shared results are tagged "share" automatically.</p>
      </Panel>

      <Panel title="Games" subtitle="Which games people open, finish, come back to and share. Use it to pick the game to promote." flush>
        {games.length === 0 ? <Empty>No games played in this range.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th className="num">Opened by</th>
                  <th className="num">Finished by</th>
                  <th className="num" title="Finished by ÷ opened by">Finish rate</th>
                  <th className="num" title="Players who finished it on two or more days">Repeat players</th>
                  <th className="num">Shares</th>
                  <th className="num" title="New visitors whose first finished game was this one: back within a week">First-game retention</th>
                </tr>
              </thead>
              <tbody>
                {games.map((row) => (
                  <tr key={row.game}>
                    <td>{gameName(row.game)}</td>
                    <td className="num">{row.openers}</td>
                    <td className="num">{row.players} <small className="adm-muted">· {row.completions} games</small></td>
                    <td className="num">{percent(row.completionRate)}</td>
                    <td className="num">{percent(row.repeatRate)}</td>
                    <td className="num">{row.shares}</td>
                    <td className="num"><Rate value={row.firstGameWeek1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <LinkBuilder />

      <div className="adm-grid-2">
        <Breakdown title="Landing screen" subtitle="The screen new visitors arrived on" rows={landings} total={funnel.visited} />
        <Breakdown title="Campaigns" subtitle="New visitors from links with utm_campaign" rows={campaigns} total={funnel.visited} />
        <Breakdown title="Devices" rows={devices} total={funnel.visited} />
        <Breakdown title="Countries" subtitle="Cloudflare's country, else the browser language's region" rows={countries} total={funnel.visited} />
      </div>
    </div>
  );
}
