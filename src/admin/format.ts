const numberFormat = new Intl.NumberFormat("en");
const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatCompact(value: number): string {
  return value < 10_000 ? numberFormat.format(value) : compactFormat.format(value);
}

export function formatDate(ms: number | null): string {
  return ms ? dateFormat.format(ms) : "—";
}

export function formatDateTime(ms: number | null): string {
  return ms ? dateTimeFormat.format(ms) : "—";
}

export function formatClock(ms: number): string {
  return timeFormat.format(ms);
}

export function formatRelative(ms: number | null, now = Date.now()): string {
  if (!ms) return "Never";
  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d ago`;
  return formatDate(ms);
}

// Game timings: "67 ms", "9.0 s", "4:05".
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function modeName(mode: string): string {
  const labels: Record<string, string> = {
    flags: "Flags",
    shapes: "Shapes",
    codes: "Codes",
    capitals: "Capitals",
    "capital-recall": "Capital recall",
    "name-all": "Name all",
    "click-country": "Click country",
    "spot-country": "Spot country",
    puzzle: "Puzzle",
  };
  return labels[mode] ?? mode;
}
