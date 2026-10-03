ALTER TABLE scans ADD COLUMN diagnostics jsonb CHECK (jsonb_typeof(diagnostics)='object' AND octet_length(diagnostics::text)<=262144);
DROP TRIGGER scans_identity ON scans;
CREATE TRIGGER scans_identity BEFORE UPDATE OR DELETE ON scans FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'requester_key', 'progress_revision', 'started_at', 'deadline_at', 'finished_at', 'plan', 'diagnostics');
UPDATE scans s SET diagnostics=j.attempt_summary FROM jobs j
WHERE j.scan_id=s.id AND j.kind='aggregation' AND j.attempt_summary->>'phase'='static_analysis';
CREATE TRIGGER scan_diagnostics BEFORE UPDATE OF diagnostics ON scans FOR EACH ROW
WHEN (OLD.diagnostics IS NOT NULL AND NEW.diagnostics IS DISTINCT FROM OLD.diagnostics)
EXECUTE FUNCTION preserve_identity();
