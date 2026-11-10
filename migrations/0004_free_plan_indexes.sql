CREATE INDEX IF NOT EXISTS runs_finished ON runs(finished_at) WHERE state<>'running';
CREATE INDEX IF NOT EXISTS contacts_paid_undated ON contacts(undated,id) WHERE undated=1;
CREATE INDEX IF NOT EXISTS events_by_contact ON events(contact_id,at DESC,id);
