ALTER TABLE scans ADD COLUMN diagnostics jsonb CHECK (jsonb_typeof(diagnostics)='object' AND octet_length(diagnostics::text)<=262144);
ALTER TABLE scans ADD COLUMN evidence_completed_at timestamptz;
ALTER TABLE scans ADD COLUMN aggregation_failed_at timestamptz;
DROP TRIGGER scans_identity ON scans;
CREATE TRIGGER scans_identity BEFORE UPDATE OR DELETE ON scans FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'requester_key', 'progress_revision', 'started_at', 'deadline_at', 'finished_at', 'plan', 'diagnostics', 'evidence_completed_at', 'aggregation_failed_at');
UPDATE scans SET evidence_completed_at=finished_at WHERE finished_at IS NOT NULL;
CREATE FUNCTION stamp_evidence_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.evidence_completed_at IS NOT NULL THEN
    IF NEW.evidence_completed_at IS DISTINCT FROM OLD.evidence_completed_at THEN
      RAISE EXCEPTION 'Evidence completion time is immutable';
    END IF;
  ELSIF OLD.state IN ('requested','preparing','running') AND NEW.state IN ('aggregating','completed','inconclusive','failed_infrastructure','rejected','cancelled') THEN
    NEW.evidence_completed_at := clock_timestamp();
  ELSIF NEW.evidence_completed_at IS DISTINCT FROM OLD.evidence_completed_at THEN
    RAISE EXCEPTION 'Evidence completion time requires a lifecycle transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scan_completion BEFORE UPDATE ON scans FOR EACH ROW EXECUTE FUNCTION stamp_evidence_completion();
UPDATE scans s SET diagnostics=j.attempt_summary FROM jobs j
WHERE j.scan_id=s.id AND j.kind='aggregation' AND j.attempt_summary->>'phase'='static_analysis';
CREATE TRIGGER scan_diagnostics BEFORE UPDATE OF diagnostics ON scans FOR EACH ROW
WHEN (OLD.diagnostics IS NOT NULL AND NEW.diagnostics IS DISTINCT FROM OLD.diagnostics)
EXECUTE FUNCTION preserve_identity();
