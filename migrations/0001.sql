CREATE TABLE IF NOT EXISTS sources (
 provider TEXT PRIMARY KEY, confirmed_at TEXT, error TEXT, started_at TEXT,
 active_run TEXT, completed_runs INTEGER NOT NULL DEFAULT 0, identity_json TEXT
);
INSERT OR IGNORE INTO sources(provider) VALUES ('crm'),('meta');
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, state TEXT NOT NULL, cursor_json TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, error TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, retries INTEGER NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(provider) WHERE state='running';
CREATE TABLE IF NOT EXISTS stage (
 run_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(run_id,kind,key)
);
CREATE TABLE IF NOT EXISTS contacts (
 id TEXT PRIMARY KEY, stage_id TEXT, stage_name TEXT NOT NULL, undated INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, at TEXT NOT NULL, day TEXT NOT NULL,
 campaign_id TEXT, adset_id TEXT, ad_id TEXT, evidence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_day ON events(day,contact_id,at);
CREATE TABLE IF NOT EXISTS ads (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metrics (
 day TEXT NOT NULL, ad_id TEXT NOT NULL, campaign_id TEXT NOT NULL, adset_id TEXT NOT NULL,
 data TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(day,ad_id)
);
CREATE TABLE IF NOT EXISTS metric_revisions (
 run_id TEXT NOT NULL, day TEXT NOT NULL, ad_id TEXT NOT NULL, data TEXT NOT NULL,
 confirmed_at TEXT NOT NULL, PRIMARY KEY(run_id,day,ad_id)
);
CREATE TABLE IF NOT EXISTS meta_coverage (day TEXT PRIMARY KEY, confirmed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
