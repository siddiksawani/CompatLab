ALTER TABLE scans ADD COLUMN observation_revision integer NOT NULL DEFAULT 0 CHECK(observation_revision>=0);
ALTER TABLE scans ADD COLUMN previous_scan_id uuid UNIQUE REFERENCES scans(id);
ALTER TABLE scans DROP CONSTRAINT scans_preparation_id_matrix_id_key;
ALTER TABLE scans ADD UNIQUE(preparation_id,matrix_id,observation_revision);
CREATE TABLE monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  repository_link_id uuid NOT NULL REFERENCES repository_links(id) ON DELETE CASCADE,
  package_name text NOT NULL,
  version_range text NOT NULL CHECK(length(version_range)<=256),
  matrix_id uuid NOT NULL REFERENCES matrices(id),
  rule text NOT NULL CHECK(rule IN ('regressions_only','any_evidence_change')),
  enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,package_name,version_range,matrix_id)
);
CREATE INDEX monitors_due ON monitors(next_poll_at) WHERE enabled;
CREATE TRIGGER monitors_identity BEFORE UPDATE ON monitors FOR EACH ROW
EXECUTE FUNCTION preserve_identity('enabled','email_enabled','next_poll_at','lease_token','lease_expires_at','last_checked_at','last_error');
CREATE TABLE monitor_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  version text NOT NULL,
  state text NOT NULL CHECK(state IN ('baseline','pending','selected','blocked')),
  scan_id uuid REFERENCES scans(id),
  report_id uuid REFERENCES reports(id),
  compared_at timestamptz,
  next_compare_at timestamptz NOT NULL DEFAULT now(),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(monitor_id,version),
  CHECK((state='selected')=(scan_id IS NOT NULL))
);
CREATE INDEX monitor_releases_pending ON monitor_releases(monitor_id,state);
CREATE INDEX monitor_releases_compare ON monitor_releases(next_compare_at) WHERE state='selected' AND compared_at IS NULL;
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  before_report_id uuid NOT NULL REFERENCES reports(id),
  after_report_id uuid NOT NULL REFERENCES reports(id),
  rule_revision text NOT NULL,
  comparison jsonb NOT NULL CHECK(octet_length(comparison::text)<=2097152),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(monitor_id,before_report_id,after_report_id,rule_revision)
);
CREATE INDEX notifications_recent ON notifications(monitor_id,created_at);
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  message text NOT NULL CHECK(octet_length(message)<=16384),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','uncertain','cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 16),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_due ON notification_deliveries(next_attempt_at) WHERE state IN ('pending','sending');
CREATE TRIGGER notifications_identity BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION preserve_identity();
CREATE TRIGGER deliveries_identity BEFORE UPDATE ON notification_deliveries FOR EACH ROW
EXECUTE FUNCTION preserve_identity('state','attempt','next_attempt_at','first_attempt_at','lease_token','lease_expires_at','provider_id','last_error');
ALTER TABLE repository_links ADD UNIQUE(id,user_id);
ALTER TABLE monitors ADD FOREIGN KEY(repository_link_id,user_id) REFERENCES repository_links(id,user_id) ON DELETE CASCADE;
CREATE FUNCTION validate_observation_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.previous_scan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM scans parent JOIN preparations old_prep ON old_prep.id=parent.preparation_id
    JOIN preparations new_prep ON new_prep.id=NEW.preparation_id
    WHERE parent.id=NEW.previous_scan_id AND parent.matrix_id=NEW.matrix_id
      AND old_prep.artifact_id=new_prep.artifact_id AND parent.observation_revision<NEW.observation_revision
      AND parent.state IN ('completed','inconclusive','failed_infrastructure','rejected','cancelled')
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.scan_id=parent.id AND (j.state IN ('leased','running') OR j.cleanup_required))
  ) THEN RAISE EXCEPTION 'Rescan parent must be a matching terminal observation with cleanup confirmed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scans_observation_parent BEFORE INSERT ON scans FOR EACH ROW EXECUTE FUNCTION validate_observation_parent();
