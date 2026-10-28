import type { AnalyticsBatch, AnalyticsEventRow, AnalyticsStore, AnalyticsVisitor, AnalyticsVisitorDay } from "./types";
import { utcDay } from "./AnalyticsService";

// In-memory AnalyticsStore for tests; mirrors SqliteAnalyticsStore's rules.
export function createMemoryAnalyticsStore(): AnalyticsStore {
  const visitors = new Map<string, AnalyticsVisitor>();
  const days = new Set<string>();
  const excluded = new Set<string>();
  let events: AnalyticsEventRow[] = [];

  return {
    record(batch: AnalyticsBatch): void {
      const latest = Math.max(...batch.events.map((event) => event.time));
      const earliest = Math.min(...batch.events.map((event) => event.time));
      const existing = visitors.get(batch.visitorId);
      const touch = batch.touch ?? { source: null, medium: null, campaign: null, referrer: null, landing: null, device: null, country: null };
      let visitor: AnalyticsVisitor = existing
        ?? { visitorId: batch.visitorId, firstSeenAt: earliest, firstDay: utcDay(earliest), lastSeenAt: latest, userId: null, signedUpAt: null, ...touch };
      // A visitor first seen without a touch keeps the first one it reports.
      if (existing && existing.landing === null && batch.touch) visitor = { ...visitor, ...batch.touch };
      visitor = { ...visitor, lastSeenAt: Math.max(visitor.lastSeenAt, latest) };
      if (batch.user && visitor.userId === null) {
        visitor = { ...visitor, userId: batch.user.id, signedUpAt: batch.user.createdAt >= visitor.firstSeenAt - 600_000 ? batch.user.createdAt : null };
      }
      visitors.set(batch.visitorId, visitor);
      for (const event of batch.events) days.add(`${event.visitorId}|${event.day}`);
      events.push(...batch.events);
    },
    isExcluded(visitorId: string): boolean {
      return excluded.has(visitorId);
    },
    exclude(visitorId: string): void {
      excluded.add(visitorId);
      visitors.delete(visitorId);
      for (const key of [...days]) if (key.startsWith(`${visitorId}|`)) days.delete(key);
      events = events.filter((event) => event.visitorId !== visitorId);
    },
    visitorsSeenSince(since: number): readonly AnalyticsVisitor[] {
      return [...visitors.values()].filter((visitor) => visitor.lastSeenAt >= since);
    },
    visitorsOfUsers(userIds: readonly string[]): readonly AnalyticsVisitor[] {
      return [...visitors.values()].filter((visitor) => visitor.userId !== null && userIds.includes(visitor.userId));
    },
    activeDaysSince(day: string): readonly AnalyticsVisitorDay[] {
      return [...days].map((key) => {
        const [visitorId, d] = key.split("|") as [string, string];
        return { visitorId, day: d };
      }).filter((row) => row.day >= day);
    },
    eventsSince(since: number): readonly AnalyticsEventRow[] {
      return events.filter((event) => event.time >= since);
    },
    pruneEvents(before: number): number {
      const kept = events.filter((event) => event.time >= before);
      const removed = events.length - kept.length;
      events = kept;
      return removed;
    },
  };
}
