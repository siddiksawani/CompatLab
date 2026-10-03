ALTER TABLE workers ADD COLUMN session_id uuid;
ALTER TABLE workers ADD COLUMN recovery_required boolean NOT NULL DEFAULT true;
ALTER TABLE workers ADD COLUMN revoked_at timestamptz;
ALTER TABLE preparations ADD COLUMN snapshot_id uuid;
ALTER TABLE preparations ADD COLUMN installer_image text CHECK (length(installer_image) <= 256);
ALTER TABLE preparations ADD COLUMN installed_manifest json CHECK (json_typeof(installed_manifest) = 'object' AND octet_length(installed_manifest::text) <= 2097152);
ALTER TABLE preparations ADD COLUMN metadata json CHECK (json_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4194304);
ALTER TABLE scans ADD COLUMN plan jsonb CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 8388608);
ALTER TABLE jobs ADD COLUMN session_id uuid;
ALTER TABLE jobs ADD COLUMN cleanup_required boolean NOT NULL DEFAULT false;
CREATE INDEX jobs_unreconciled ON jobs(worker_id) WHERE cleanup_required;
CREATE UNIQUE INDEX preparation_snapshot ON preparations(owner_worker_id, snapshot_id) WHERE snapshot_id IS NOT NULL;

DROP TRIGGER preparations_identity ON preparations;
CREATE FUNCTION preserve_preparation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(OLD.id, OLD.artifact_id, OLD.profile_revision, OLD.platform, OLD.resolution_generation, OLD.created_at)
    IS DISTINCT FROM ROW(NEW.id, NEW.artifact_id, NEW.profile_revision, NEW.platform, NEW.resolution_generation, NEW.created_at) THEN
    RAISE EXCEPTION 'immutable preparation identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparations_identity BEFORE UPDATE OR DELETE ON preparations FOR EACH ROW EXECUTE FUNCTION preserve_preparation_identity();

CREATE OR REPLACE FUNCTION preserve_preparation_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.lock_bytes IS NOT NULL AND OLD.lock_bytes IS DISTINCT FROM NEW.lock_bytes)
    OR (OLD.lock_digest IS NOT NULL AND OLD.lock_digest IS DISTINCT FROM NEW.lock_digest)
    OR (OLD.snapshot_generation IS NOT NULL AND OLD.snapshot_generation IS DISTINCT FROM NEW.snapshot_generation)
    OR (OLD.tree_digest IS NOT NULL AND OLD.tree_digest IS DISTINCT FROM NEW.tree_digest)
    OR (OLD.snapshot_generation IS NOT NULL AND OLD.owner_worker_id IS DISTINCT FROM NEW.owner_worker_id)
    OR (OLD.state='ready' AND NEW.state<>'ready') THEN
    RAISE EXCEPTION 'immutable preparation result' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER scans_identity ON scans;
CREATE TRIGGER scans_identity BEFORE UPDATE OR DELETE ON scans FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'requester_key', 'progress_revision', 'started_at', 'deadline_at', 'finished_at', 'plan');
DROP TRIGGER jobs_identity ON jobs;
CREATE TRIGGER jobs_identity BEFORE UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'available_at', 'attempt', 'attempt_token', 'worker_id', 'lease_expires_at', 'deadline_at', 'result_digest', 'attempt_summary', 'session_id', 'cleanup_required');

CREATE FUNCTION preserve_execution_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'scans' THEN
    IF OLD.plan IS NOT NULL AND OLD.plan IS DISTINCT FROM NEW.plan THEN
      RAISE EXCEPTION 'immutable scan plan' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD.snapshot_id IS NOT NULL AND
      ROW(OLD.snapshot_id, OLD.installer_image, OLD.installed_manifest::text, OLD.metadata::text)
      IS DISTINCT FROM ROW(NEW.snapshot_id, NEW.installer_image, NEW.installed_manifest::text, NEW.metadata::text) THEN
      RAISE EXCEPTION 'immutable preparation inputs' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_inputs BEFORE UPDATE ON preparations FOR EACH ROW EXECUTE FUNCTION preserve_execution_inputs();
CREATE TRIGGER scan_plan BEFORE UPDATE OF plan ON scans FOR EACH ROW EXECUTE FUNCTION preserve_execution_inputs();

UPDATE jobs SET session_id=gen_random_uuid(),cleanup_required=true
WHERE state IN ('leased','running') AND session_id IS NULL;
ALTER TABLE jobs ADD CONSTRAINT active_job_session CHECK (state NOT IN ('leased','running') OR session_id IS NOT NULL);
