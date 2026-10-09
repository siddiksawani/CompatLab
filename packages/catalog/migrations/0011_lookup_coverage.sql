CREATE TABLE lookup_demand (
  day date NOT NULL,
  package_name text NOT NULL CHECK (length(package_name) BETWEEN 1 AND 214),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 256),
  availability text NOT NULL CHECK (availability IN ('current','earlier','missing')),
  windows integer NOT NULL DEFAULT 1 CHECK (windows BETWEEN 1 AND 144),
  last_bucket bigint NOT NULL,
  PRIMARY KEY(day,package_name,version,availability)
);

ALTER TABLE service_controls ADD COLUMN coverage_paused boolean NOT NULL DEFAULT true;
ALTER TABLE scans ADD COLUMN source text NOT NULL DEFAULT 'public' CHECK (source IN ('public','coverage'));
CREATE TABLE coverage_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name text NOT NULL CHECK (length(package_name) BETWEEN 1 AND 214),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 256),
  matrix_id uuid NOT NULL REFERENCES matrices(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','submitted','completed','failed','blocked')),
  scan_id uuid REFERENCES scans(id),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  last_reason text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_name,version,matrix_id)
);
CREATE INDEX coverage_pending ON coverage_targets(next_attempt_at,created_at,id) WHERE state='pending';
CREATE INDEX scans_source_active ON scans(source) WHERE state IN ('requested','preparing','running','aggregating');
