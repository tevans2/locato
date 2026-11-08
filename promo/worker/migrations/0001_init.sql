-- The promo service's records. Files live in R2; this is everything we keep track of.

-- One row per video in the posting pipeline. `entry` is the full queue entry (per-channel posts, Buffer ids,
-- links, errors, log) used by the posting step; the other columns are for listing and filtering.
CREATE TABLE videos (
  name       TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'queued',   -- queued | scheduled | posted | problem | removed
  due_at     TEXT NOT NULL,
  hold       INTEGER NOT NULL DEFAULT 0,
  video_url  TEXT NOT NULL,
  ref        TEXT,                              -- the ?ref= of its link: joins with the game's visit sources
  meta       TEXT,                              -- creative variables (format, mode, hook…) as JSON
  entry      TEXT NOT NULL,
  staged_at  TEXT NOT NULL,
  posted_at  TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX videos_status_due ON videos (status, due_at);

-- Online content: additions to / overrides of the defaults in promo/content/*.json.
CREATE TABLE content (
  kind       TEXT NOT NULL,                     -- phrases | lists | presets | plans
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (kind, id)
);

CREATE TABLE voices (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,                     -- VoiceInfo JSON
  disabled   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE voice_clips (
  voice      TEXT NOT NULL,
  key        TEXT NOT NULL,                     -- from the line's text
  text       TEXT NOT NULL,
  file       TEXT NOT NULL,                     -- R2 key in the public bucket
  duration   REAL NOT NULL,
  bytes      INTEGER NOT NULL,
  source     TEXT NOT NULL,                     -- generated | recorded | uploaded
  check_json TEXT,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (voice, key)
);

-- Licensed music, kept in the PRIVATE bucket.
CREATE TABLE music (
  name     TEXT PRIMARY KEY,
  file     TEXT NOT NULL,
  bytes    INTEGER NOT NULL,
  licence  TEXT,
  added_at TEXT NOT NULL
);

-- Every posting run (timer or manual) and every change made through the API.
CREATE TABLE runs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  trigger   TEXT NOT NULL,
  scheduled INTEGER NOT NULL DEFAULT 0,
  posted    INTEGER NOT NULL DEFAULT 0,
  log       TEXT NOT NULL,
  error     TEXT
);
CREATE TABLE audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  who     TEXT NOT NULL,
  action  TEXT NOT NULL,
  details TEXT
);
