import type { AdminClient, AdminSystem } from "../api";
import { formatBytes, formatDateTime, formatUptime } from "../format";
import { Badge, ErrorNote, Loading, Panel, useResource } from "../ui";

function On({ value }: { value: boolean }) {
  return value ? <Badge tone="good">configured</Badge> : <Badge>not set</Badge>;
}

const LABELS: Record<string, string> = {
  maxRooms: "Max rooms",
  maxPlayersPerRoom: "Max players per room",
  roomTtlSeconds: "Room lifetime",
  sessionTtlDays: "Session lifetime",
  eventRetentionDays: "Event log retention",
  generatedEntries: "Generated locations",
  fallbackEntries: "Fallback locations",
  maxEntries: "Pool cap",
  dailyGenerateCount: "Generated per day",
  lastGeneratedAt: "Last generated",
  metadataConfigured: "Metadata API key",
  refreshInProgress: "Refreshing now",
};

const UNITS: Record<string, (value: number) => string> = {
  roomTtlSeconds: (v) => formatUptime(v),
  sessionTtlDays: (v) => `${v} days`,
  eventRetentionDays: (v) => `${v} days`,
};

function label(key: string): string {
  return LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function YesNo({ value }: { value: boolean }) {
  return value ? <Badge tone="good">yes</Badge> : <Badge>no</Badge>;
}

export function SystemView({ client }: { client: AdminClient }) {
  const system = useResource(() => client.get<AdminSystem>("/system"), [client], 15_000);
  if (!system.data) return system.error ? <ErrorNote message={system.error} onRetry={system.refresh} /> : <Loading />;
  const s = system.data;

  return (
    <div className="adm-stack">
      <div className="adm-grid-2">
        <Panel title="Server" flush>
          <dl className="adm-kv">
            <div><dt>Uptime</dt><dd>{formatUptime(s.uptimeSeconds)} <small>since {formatDateTime(s.startedAt)}</small></dd></div>
            <div><dt>Environment</dt><dd>{s.runtime.nodeEnv}</dd></div>
            <div><dt>Bun</dt><dd>{s.runtime.bun ?? "—"}</dd></div>
            <div><dt>Fly app / region</dt><dd>{s.host.app ?? "local"}{s.host.region ? ` · ${s.host.region}` : ""}</dd></div>
            <div><dt>Machine</dt><dd><code>{s.host.machineId ?? "—"}</code></dd></div>
            <div><dt>Image</dt><dd className="adm-break"><code>{s.host.image ?? "—"}</code></dd></div>
          </dl>
          <p className="adm-footnote">The Fly machine auto-stops when idle, so uptime resets often. Live rooms and presence live in memory and reset with it.</p>
        </Panel>
        <Panel title="Resources" flush>
          <dl className="adm-kv">
            <div><dt>Memory (RSS)</dt><dd>{formatBytes(s.memory.rssBytes)}</dd></div>
            <div><dt>Heap used</dt><dd>{formatBytes(s.memory.heapUsedBytes)} <small>of {formatBytes(s.memory.heapTotalBytes)}</small></dd></div>
            <div><dt>Database</dt><dd>{formatBytes(s.database.sizeBytes)} <small>+ {formatBytes(s.database.walBytes)} WAL</small></dd></div>
            <div><dt>Database path</dt><dd><code>{s.database.path}</code></dd></div>
            <div><dt>Rooms / connections</dt><dd>{s.rooms.rooms} / {s.rooms.connections}</dd></div>
          </dl>
        </Panel>
      </div>
      <div className="adm-grid-2">
        <Panel title="Configuration" flush>
          <dl className="adm-kv">
            <div><dt>GitHub sign-in</dt><dd><On value={s.features.githubOAuth} /></dd></div>
            <div><dt>Google sign-in</dt><dd><On value={s.features.googleOAuth} /></dd></div>
            <div><dt>Allowed origins</dt><dd>{s.features.allowedOrigins?.join(", ") ?? "any"}</dd></div>
            {Object.entries(s.limits).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{UNITS[key]?.(value) ?? value}</dd></div>)}
          </dl>
        </Panel>
        <Panel title="Street View pool" flush>
          <dl className="adm-kv">
            {Object.entries(s.streetview).map(([key, value]) => (
              <div key={key}>
                <dt>{label(key)}</dt>
                <dd>
                  {typeof value === "boolean"
                    ? key.endsWith("Configured") ? <On value={value} /> : <YesNo value={value} />
                    : key.endsWith("At") && (typeof value === "number" || typeof value === "string") ? formatDateTime(new Date(value).getTime() || null) : String(value ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
