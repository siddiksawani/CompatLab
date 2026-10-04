ALTER TABLE service_controls ADD COLUMN worker_guard_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE worker_availability (
  matrix_id uuid PRIMARY KEY REFERENCES matrices(id) ON DELETE CASCADE,
  paused boolean NOT NULL DEFAULT true,
  last_healthy_at timestamptz,
  healthy_since timestamptz,
  checked_at timestamptz NOT NULL
);
