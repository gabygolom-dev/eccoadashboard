CREATE TABLE IF NOT EXISTS conversation_cache (
 conversation_id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL,
 full_scan_at TEXT NOT NULL
);
