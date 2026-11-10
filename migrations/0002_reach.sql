CREATE TABLE IF NOT EXISTS reach_reports (
 id TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL,
 campaign_id TEXT, ad_id TEXT, requested_at TEXT NOT NULL,
 confirmed_at TEXT, value INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS reach_requested ON reach_reports(requested_at,confirmed_at);
