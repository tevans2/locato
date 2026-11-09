-- Studio drafts and render jobs. The Studio (promo.locato.quest/studio) saves a recipe + seed as a draft or queues it
-- for rendering; `npm run render-runner` on the Mac claims queued jobs, renders them and stages the video (on hold).
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                    -- the video name it becomes
  recipe      TEXT NOT NULL,                    -- recipe JSON
  seed        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',    -- draft | queued | rendering | done | failed | cancelled
  hold        INTEGER NOT NULL DEFAULT 1,       -- stage the finished video on hold (approve it in Promo → Queue)
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  claimed_by  TEXT,
  claimed_at  TEXT,
  finished_at TEXT,
  log         TEXT,
  error       TEXT,
  result      TEXT                              -- JSON: {video, dueAt, …}
);
CREATE INDEX jobs_status ON jobs (status, created_at);
