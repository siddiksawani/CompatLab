CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text COLLATE "C" NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 214),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id),
  version text COLLATE "C" NOT NULL CHECK (length(version) BETWEEN 1 AND 256),
  integrity text NOT NULL CHECK (length(integrity) BETWEEN 1 AND 1024),
  tarball_url text NOT NULL CHECK (length(tarball_url) <= 2048),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object' AND octet_length(manifest::text) <= 2097152),
  integrity_anomaly boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, version, integrity)
);

CREATE TABLE workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities) = 'object' AND octet_length(capabilities::text) <= 16384),
  state text NOT NULL DEFAULT 'drained' CHECK (state IN ('healthy', 'drained', 'quarantined')),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 3),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES package_versions(id),
  profile_revision text NOT NULL CHECK (length(profile_revision) BETWEEN 1 AND 128),
  platform text NOT NULL CHECK (platform = 'linux_amd64_glibc'),
  resolution_generation uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'preparing', 'ready', 'rejected', 'failed_infrastructure')),
  lock_bytes bytea CHECK (octet_length(lock_bytes) <= 16777216),
  lock_digest text CHECK (lock_digest ~ '^[a-f0-9]{64}$'),
  snapshot_generation uuid,
  tree_digest text CHECK (tree_digest ~ '^[a-f0-9]{64}$'),
  owner_worker_id uuid REFERENCES workers(id),
  snapshot_available boolean NOT NULL DEFAULT false,
  diagnostics jsonb CHECK (octet_length(diagnostics::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, profile_revision, platform, resolution_generation),
  UNIQUE (artifact_id, lock_digest, profile_revision, platform, snapshot_generation),
  CHECK ((lock_bytes IS NULL) = (lock_digest IS NULL)),
  CHECK (lock_digest IS NULL OR lock_digest = encode(sha256(lock_bytes), 'hex')),
  CHECK (state <> 'ready' OR (lock_digest IS NOT NULL AND snapshot_generation IS NOT NULL AND tree_digest IS NOT NULL AND owner_worker_id IS NOT NULL)),
  CHECK (NOT snapshot_available OR state = 'ready')
);
CREATE INDEX preparations_reuse ON preparations(artifact_id, profile_revision, platform, created_at DESC) WHERE state IN ('pending', 'preparing', 'ready');

CREATE TABLE runtime_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_digest text NOT NULL UNIQUE CHECK (image_digest ~ '^sha256:[a-f0-9]{64}$'),
  profile_id text NOT NULL CHECK (profile_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  platform text NOT NULL CHECK (platform = 'linux_amd64_glibc'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 16384),
  state text NOT NULL DEFAULT 'approved' CHECK (state IN ('approved', 'quarantined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, profile_id, platform),
  CHECK (definition->>'imageId' IS NOT DISTINCT FROM image_digest AND definition->>'profileId' IS NOT DISTINCT FROM profile_id AND definition->>'platform' IS NOT DISTINCT FROM platform)
);

CREATE TABLE matrices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision text COLLATE "C" NOT NULL UNIQUE CHECK (revision ~ '^[a-z][a-z0-9_]{0,63}$'),
  platform text NOT NULL CHECK (platform = 'linux_amd64_glibc'),
  preparation_profile text NOT NULL CHECK (length(preparation_profile) BETWEEN 1 AND 128),
  harness_revision text NOT NULL CHECK (length(harness_revision) BETWEEN 1 AND 128),
  plan_revision text NOT NULL CHECK (length(plan_revision) BETWEEN 1 AND 128),
  policy_revision text NOT NULL CHECK (length(policy_revision) BETWEEN 1 AND 128),
  runtime_count integer NOT NULL CHECK (runtime_count BETWEEN 1 AND 16),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, platform)
);
CREATE TABLE matrix_members (
  matrix_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 15),
  image_id uuid NOT NULL,
  profile_id text NOT NULL,
  platform text NOT NULL,
  PRIMARY KEY (matrix_id, position),
  UNIQUE (matrix_id, image_id),
  UNIQUE (matrix_id, profile_id),
  FOREIGN KEY (matrix_id, platform) REFERENCES matrices(id, platform),
  FOREIGN KEY (image_id, profile_id, platform) REFERENCES runtime_images(id, profile_id, platform)
);

CREATE TABLE scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id uuid NOT NULL REFERENCES preparations(id),
  matrix_id uuid NOT NULL REFERENCES matrices(id),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'preparing', 'running', 'aggregating', 'completed', 'inconclusive', 'failed_infrastructure', 'rejected', 'cancelled')),
  requester_key text CHECK (requester_key ~ '^[a-f0-9]{64}$'),
  requester_expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  admission_policy text NOT NULL CHECK (length(admission_policy) BETWEEN 1 AND 128),
  progress_revision integer NOT NULL DEFAULT 0 CHECK (progress_revision >= 0),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  deadline_at timestamptz,
  finished_at timestamptz,
  UNIQUE (preparation_id, matrix_id),
  UNIQUE (id, matrix_id),
  UNIQUE (id, preparation_id),
  CHECK ((started_at IS NULL) = (deadline_at IS NULL)),
  CHECK (deadline_at IS NULL OR deadline_at > started_at),
  CHECK (requester_expires_at > requested_at)
);
CREATE INDEX scans_queue ON scans(requested_at) WHERE state = 'requested';
CREATE INDEX scans_requester_active ON scans(requester_key) WHERE state IN ('requested', 'preparing', 'running', 'aggregating');
CREATE INDEX scans_cooldown ON scans(preparation_id, requested_at DESC);
CREATE INDEX scans_requester_expiry ON scans(requester_expires_at) WHERE requester_key IS NOT NULL;

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL,
  matrix_id uuid NOT NULL,
  image_id uuid NOT NULL,
  probe_group text NOT NULL CHECK (probe_group IN ('root', 'subpaths')),
  mode text NOT NULL CHECK (mode IN ('esm', 'commonjs')),
  raw_evidence jsonb CHECK (octet_length(raw_evidence::text) <= 20971520),
  logs jsonb CHECK (octet_length(logs::text) <= 4194304),
  logs_expire_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, image_id, probe_group, mode),
  UNIQUE (id, scan_id),
  FOREIGN KEY (scan_id, matrix_id) REFERENCES scans(id, matrix_id),
  FOREIGN KEY (matrix_id, image_id) REFERENCES matrix_members(matrix_id, image_id)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('preparation', 'run', 'aggregation')),
  scan_id uuid NOT NULL REFERENCES scans(id),
  preparation_id uuid,
  run_id uuid,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'running', 'finished')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  attempt_token uuid,
  worker_id uuid REFERENCES workers(id),
  lease_expires_at timestamptz,
  deadline_at timestamptz,
  result_digest text CHECK (result_digest ~ '^[a-f0-9]{64}$'),
  attempt_summary jsonb CHECK (octet_length(attempt_summary::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scan_id, preparation_id) REFERENCES scans(id, preparation_id),
  FOREIGN KEY (run_id, scan_id) REFERENCES runs(id, scan_id),
  CHECK ((kind = 'preparation' AND preparation_id IS NOT NULL AND run_id IS NULL) OR (kind = 'run' AND preparation_id IS NULL AND run_id IS NOT NULL) OR (kind = 'aggregation' AND preparation_id IS NULL AND run_id IS NULL)),
  CHECK (state NOT IN ('leased', 'running') OR (attempt > 0 AND attempt_token IS NOT NULL AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL AND deadline_at IS NOT NULL)),
  CHECK (lease_expires_at IS NULL OR deadline_at IS NULL OR lease_expires_at <= deadline_at)
);
CREATE UNIQUE INDEX jobs_preparation ON jobs(preparation_id) WHERE kind = 'preparation';
CREATE UNIQUE INDEX jobs_run ON jobs(run_id) WHERE kind = 'run';
CREATE UNIQUE INDEX jobs_aggregation ON jobs(scan_id) WHERE kind = 'aggregation';
CREATE INDEX jobs_runnable ON jobs(available_at, created_at) WHERE state = 'queued';
CREATE INDEX jobs_worker_lease ON jobs(worker_id, lease_expires_at) WHERE state IN ('leased', 'running');
CREATE INDEX jobs_scan ON jobs(scan_id);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id),
  classifier_revision text NOT NULL CHECK (length(classifier_revision) BETWEEN 1 AND 128),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 20971520),
  invalidated_at timestamptz,
  invalidation_reason text CHECK (length(invalidation_reason) BETWEEN 1 AND 1024),
  replaced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, classifier_revision),
  UNIQUE (id, scan_id),
  FOREIGN KEY (replaced_by, scan_id) REFERENCES reports(id, scan_id),
  CHECK ((invalidated_at IS NULL) = (invalidation_reason IS NULL)),
  CHECK (replaced_by IS NULL OR replaced_by <> id)
);
CREATE INDEX reports_current ON reports(scan_id, classifier_revision, created_at DESC) WHERE invalidated_at IS NULL AND replaced_by IS NULL;

CREATE TABLE blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('package', 'artifact', 'image', 'harness', 'probe')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1024),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX blocks_active ON blocks(scope, subject) WHERE revoked_at IS NULL;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1024),
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created ON audit_events(created_at);

CREATE FUNCTION preserve_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- PostgreSQL exposes TG_ARGV as NULL when a trigger has no arguments.
  IF TG_OP = 'DELETE' OR (to_jsonb(OLD) - coalesce(TG_ARGV, ARRAY[]::text[])) IS DISTINCT FROM (to_jsonb(NEW) - coalesce(TG_ARGV, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'immutable % identity', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER packages_identity BEFORE UPDATE OR DELETE ON packages FOR EACH ROW EXECUTE FUNCTION preserve_identity();
CREATE TRIGGER versions_identity BEFORE UPDATE OR DELETE ON package_versions FOR EACH ROW EXECUTE FUNCTION preserve_identity('integrity_anomaly');
CREATE TRIGGER images_identity BEFORE UPDATE OR DELETE ON runtime_images FOR EACH ROW EXECUTE FUNCTION preserve_identity('state');
CREATE TRIGGER matrices_identity BEFORE UPDATE OR DELETE ON matrices FOR EACH ROW EXECUTE FUNCTION preserve_identity('enabled');
CREATE TRIGGER members_identity BEFORE UPDATE OR DELETE ON matrix_members FOR EACH ROW EXECUTE FUNCTION preserve_identity();
CREATE TRIGGER preparations_identity BEFORE UPDATE OR DELETE ON preparations FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'lock_bytes', 'lock_digest', 'snapshot_generation', 'tree_digest', 'owner_worker_id', 'snapshot_available', 'diagnostics');
CREATE TRIGGER scans_identity BEFORE UPDATE OR DELETE ON scans FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'requester_key', 'progress_revision', 'started_at', 'deadline_at', 'finished_at');
CREATE TRIGGER reports_identity BEFORE UPDATE OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION preserve_identity('invalidated_at', 'invalidation_reason', 'replaced_by');
CREATE TRIGGER blocks_identity BEFORE UPDATE OR DELETE ON blocks FOR EACH ROW EXECUTE FUNCTION preserve_identity('revoked_at');
CREATE TRIGGER audit_identity BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION preserve_identity();

CREATE FUNCTION preserve_preparation_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
  FOREACH field IN ARRAY ARRAY['lock_bytes', 'lock_digest', 'snapshot_generation', 'tree_digest'] LOOP
    IF to_jsonb(OLD)->field <> 'null'::jsonb AND to_jsonb(OLD)->field IS DISTINCT FROM to_jsonb(NEW)->field THEN
      RAISE EXCEPTION 'immutable preparation result' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF OLD.snapshot_generation IS NOT NULL AND NEW.owner_worker_id IS DISTINCT FROM OLD.owner_worker_id THEN
    RAISE EXCEPTION 'immutable sealed snapshot locality' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'ready' AND NEW.state <> 'ready' THEN
    RAISE EXCEPTION 'a ready preparation cannot change state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_result BEFORE UPDATE ON preparations FOR EACH ROW EXECUTE FUNCTION preserve_preparation_result();

CREATE FUNCTION validate_matrix_members() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected uuid; expected integer; actual integer; last_position integer;
BEGIN
  IF TG_TABLE_NAME = 'matrices' THEN selected := NEW.id; ELSE selected := NEW.matrix_id; END IF;
  SELECT runtime_count INTO expected FROM matrices WHERE id = selected;
  SELECT count(*), max(position) INTO actual, last_position FROM matrix_members WHERE matrix_id = selected;
  IF actual <> expected OR last_position <> expected - 1 THEN
    RAISE EXCEPTION 'matrix membership must be complete and ordered' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER matrix_complete AFTER INSERT ON matrices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_matrix_members();
CREATE CONSTRAINT TRIGGER matrix_members_complete AFTER INSERT ON matrix_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_matrix_members();

CREATE FUNCTION validate_scan_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM preparations p JOIN matrices m ON m.id = NEW.matrix_id WHERE p.id = NEW.preparation_id AND p.profile_revision = m.preparation_profile AND p.platform = m.platform) THEN
    RAISE EXCEPTION 'scan preparation must match matrix profile and platform' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scan_profile BEFORE INSERT ON scans FOR EACH ROW EXECUTE FUNCTION validate_scan_profile();

CREATE TRIGGER runs_identity BEFORE UPDATE OR DELETE ON runs FOR EACH ROW EXECUTE FUNCTION preserve_identity('raw_evidence', 'logs', 'logs_expire_at');
CREATE TRIGGER jobs_identity BEFORE UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION preserve_identity('state', 'available_at', 'attempt', 'attempt_token', 'worker_id', 'lease_expires_at', 'deadline_at', 'result_digest', 'attempt_summary');

CREATE TRIGGER run_evidence BEFORE UPDATE OF raw_evidence ON runs FOR EACH ROW
WHEN (OLD.raw_evidence IS NOT NULL AND NEW.raw_evidence IS DISTINCT FROM OLD.raw_evidence)
EXECUTE FUNCTION preserve_identity();
