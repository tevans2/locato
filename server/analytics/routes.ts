import type { AnalyticsIngestContext, AnalyticsService } from "./AnalyticsService";

const MAX_BODY_BYTES = 32 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** POST /api/events: a batch of anonymous product events from the game client (sendBeacon or fetch). */
export async function handleAnalyticsEvents(request: Request, service: AnalyticsService, context: AnalyticsIngestContext): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "Batch too large." }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Batch too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }
  const result = service.ingest(body, context);
  return result.ok ? json({ accepted: result.accepted }, 202) : json({ error: result.error }, result.status);
}
