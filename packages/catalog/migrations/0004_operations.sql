ALTER TABLE workers ADD COLUMN accepting_jobs boolean NOT NULL DEFAULT true;
CREATE TABLE service_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  admission_paused boolean NOT NULL DEFAULT false
);
INSERT INTO service_controls DEFAULT VALUES;
CREATE INDEX scans_requested_at ON scans(requested_at);
CREATE INDEX scans_requester_recent ON scans(requester_key,requested_at) WHERE requester_key IS NOT NULL;
CREATE INDEX runs_expiring_logs ON runs(logs_expire_at) WHERE logs IS NOT NULL;
DROP TRIGGER audit_identity ON audit_events;
CREATE FUNCTION preserve_retained_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.created_at < clock_timestamp() - interval '180 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Audit events remain immutable during their retention period' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER audit_identity BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION preserve_retained_audit();
