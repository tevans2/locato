import type { AdminEventInput, AdminEventLevel } from "../auth/types";

type EventSink = (event: AdminEventInput) => void;

let sink: EventSink | null = null;

// The server wires this to the database at startup so structured log lines also land in the
// durable admin event log (Fly only keeps a short tail of stdout). Tests may point it at a store.
export function setEventSink(next: EventSink | null): void {
  sink = next;
}

// Writes one structured JSON log line and records it for the admin panel. `ip` and `userId`
// are lifted into their own columns so the event log can be filtered by them.
export function logEvent(level: AdminEventLevel, action: string, details: Record<string, unknown> = {}): void {
  const time = Date.now();
  const { ip, userId, ...rest } = details;
  // eslint-disable-next-line no-console
  console[level](JSON.stringify({ time: new Date(time).toISOString(), level, action, ...details }));
  if (!sink) return;
  try {
    sink({
      time,
      level,
      action,
      ip: typeof ip === "string" ? ip : null,
      userId: typeof userId === "string" ? userId : null,
      details: rest,
    });
  } catch (error) {
    // Never let audit logging break the request it describes.
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ time: new Date().toISOString(), level: "warn", action: "admin.events.write_failed", error: String(error) }));
  }
}
