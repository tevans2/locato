// This module imports bun:sqlite — never import from Node/vitest test graph.
import type { Database } from "bun:sqlite";
import type { AnalyticsBatch, AnalyticsEventRow, AnalyticsStore, AnalyticsVisitor, AnalyticsVisitorDay } from "./types";
import { utcDay } from "./AnalyticsService";

// A linked account created up to this long before the visitor's first event still counts as
// its signup (the sign-up request can land before the first analytics batch does).
const SIGNUP_SLACK_MS = 10 * 60_000;

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_visitors (
      visitor_id TEXT PRIMARY KEY,
      first_seen_at INTEGER NOT NULL,
      first_day TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      referrer TEXT,
      landing TEXT,
      device TEXT,
      country TEXT,
      user_id TEXT,
      signed_up_at INTEGER,
      excluded INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS analytics_visitors_last_seen ON analytics_visitors(last_seen_at);
    CREATE INDEX IF NOT EXISTS analytics_visitors_user ON analytics_visitors(user_id);

    CREATE TABLE IF NOT EXISTS analytics_visitor_days (
      visitor_id TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (visitor_id, day)
    );
    CREATE INDEX IF NOT EXISTS analytics_visitor_days_day ON analytics_visitor_days(day);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER NOT NULL,
      day TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      session_id TEXT,
      user_id TEXT,
      name TEXT NOT NULL,
      screen TEXT,
      game TEXT,
      mode TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS analytics_events_time ON analytics_events(time);
  `);
}

export class SqliteAnalyticsStore implements AnalyticsStore {
  constructor(private readonly db: Database) {
    migrate(db);
  }

  record(batch: AnalyticsBatch): void {
    const earliest = Math.min(...batch.events.map((event) => event.time));
    const latest = Math.max(...batch.events.map((event) => event.time));
    const touch = batch.touch;
    const write = this.db.transaction(() => {
      this.db
        .query(`INSERT OR IGNORE INTO analytics_visitors (visitor_id, first_seen_at, first_day, last_seen_at, source, medium, campaign, referrer, landing, device, country)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(batch.visitorId, earliest, utcDay(earliest), latest, touch?.source ?? null, touch?.medium ?? null, touch?.campaign ?? null, touch?.referrer ?? null, touch?.landing ?? null, touch?.device ?? null, touch?.country ?? null);
      // A visitor first seen without a touch keeps the first one it reports.
      if (touch) {
        this.db
          .query("UPDATE analytics_visitors SET source = ?, medium = ?, campaign = ?, referrer = ?, landing = ?, device = ?, country = ? WHERE visitor_id = ? AND landing IS NULL")
          .run(touch.source, touch.medium, touch.campaign, touch.referrer, touch.landing, touch.device, touch.country, batch.visitorId);
      }
      this.db.query("UPDATE analytics_visitors SET last_seen_at = MAX(last_seen_at, ?) WHERE visitor_id = ?").run(latest, batch.visitorId);
      if (batch.user) {
        this.db
          .query(`UPDATE analytics_visitors SET user_id = ?, signed_up_at = CASE WHEN ? >= first_seen_at - ? THEN ? ELSE NULL END
                  WHERE visitor_id = ? AND user_id IS NULL`)
          .run(batch.user.id, batch.user.createdAt, SIGNUP_SLACK_MS, batch.user.createdAt, batch.visitorId);
      }
      const markDay = this.db.query("INSERT OR IGNORE INTO analytics_visitor_days (visitor_id, day) VALUES (?, ?)");
      const insert = this.db.query("INSERT INTO analytics_events (time, day, visitor_id, session_id, user_id, name, screen, game, mode, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const event of batch.events) {
        markDay.run(event.visitorId, event.day);
        insert.run(event.time, event.day, event.visitorId, event.sessionId, event.userId, event.name, event.screen, event.game, event.mode, event.detail);
      }
    });
    write();
  }

  isExcluded(visitorId: string): boolean {
    return this.db.query<{ excluded: number }>("SELECT excluded FROM analytics_visitors WHERE visitor_id = ?").get(visitorId)?.excluded === 1;
  }

  exclude(visitorId: string, now: number): void {
    this.db.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO analytics_visitors (visitor_id, first_seen_at, first_day, last_seen_at) VALUES (?, ?, ?, ?)").run(visitorId, now, utcDay(now), now);
      this.db.query("UPDATE analytics_visitors SET excluded = 1 WHERE visitor_id = ?").run(visitorId);
      this.db.query("DELETE FROM analytics_visitor_days WHERE visitor_id = ?").run(visitorId);
      this.db.query("DELETE FROM analytics_events WHERE visitor_id = ?").run(visitorId);
    })();
  }

  visitorsSeenSince(since: number): readonly AnalyticsVisitor[] {
    return this.db
      .query<AnalyticsVisitor>(
        `SELECT visitor_id AS visitorId, first_seen_at AS firstSeenAt, first_day AS firstDay, last_seen_at AS lastSeenAt, source, medium, campaign,
                referrer, landing, device, country, user_id AS userId, signed_up_at AS signedUpAt
         FROM analytics_visitors WHERE last_seen_at >= ? AND excluded = 0`,
      )
      .all(since);
  }

  visitorsOfUsers(userIds: readonly string[]): readonly AnalyticsVisitor[] {
    return this.db
      .query<AnalyticsVisitor>(
        `SELECT visitor_id AS visitorId, first_seen_at AS firstSeenAt, first_day AS firstDay, last_seen_at AS lastSeenAt, source, medium, campaign,
                referrer, landing, device, country, user_id AS userId, signed_up_at AS signedUpAt
         FROM analytics_visitors WHERE user_id IN (SELECT value FROM json_each(?)) AND excluded = 0`,
      )
      .all(JSON.stringify(userIds));
  }

  activeDaysSince(day: string): readonly AnalyticsVisitorDay[] {
    return this.db.query<AnalyticsVisitorDay>("SELECT visitor_id AS visitorId, day FROM analytics_visitor_days WHERE day >= ?").all(day);
  }

  eventsSince(since: number): readonly AnalyticsEventRow[] {
    return this.db
      .query<AnalyticsEventRow>(
        `SELECT time, day, visitor_id AS visitorId, session_id AS sessionId, user_id AS userId, name, screen, game, mode, detail
         FROM analytics_events WHERE time >= ? ORDER BY time`,
      )
      .all(since);
  }

  pruneEvents(before: number): number {
    return this.db.query("DELETE FROM analytics_events WHERE time < ?").run(before).changes;
  }
}
