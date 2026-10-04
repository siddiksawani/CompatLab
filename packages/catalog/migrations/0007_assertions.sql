CREATE TABLE probe_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth_users(id) ON DELETE SET NULL,
  repository_link_id uuid REFERENCES repository_links(id) ON DELETE SET NULL,
  digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  bundle jsonb NOT NULL CHECK(jsonb_typeof(bundle)='object' AND octet_length(bundle::text)<=3145728),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,repository_link_id,digest),
  FOREIGN KEY(repository_link_id,owner_user_id) REFERENCES repository_links(id,user_id) ON DELETE SET NULL(repository_link_id)
);
CREATE FUNCTION preserve_probe_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Public probe revisions are retained'; END IF;
  IF (to_jsonb(OLD)-ARRAY['owner_user_id','repository_link_id','revoked_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['owner_user_id','repository_link_id','revoked_at'])
    OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NEW.owner_user_id IS NOT NULL)
    OR (NEW.repository_link_id IS DISTINCT FROM OLD.repository_link_id AND NEW.repository_link_id IS NOT NULL)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
  THEN RAISE EXCEPTION 'Immutable probe revision'; END IF;
  IF NEW.owner_user_id IS NULL OR NEW.repository_link_id IS NULL THEN NEW.revoked_at:=coalesce(NEW.revoked_at,clock_timestamp()); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER probe_revision_identity BEFORE UPDATE OR DELETE ON probe_revisions FOR EACH ROW EXECUTE FUNCTION preserve_probe_revision();
CREATE FUNCTION revoke_link_probes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    UPDATE probe_revisions SET revoked_at=clock_timestamp() WHERE repository_link_id=NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER link_probe_revocation AFTER UPDATE OF revoked_at ON repository_links FOR EACH ROW EXECUTE FUNCTION revoke_link_probes();
ALTER TABLE scans ADD COLUMN assertion_revision_id uuid REFERENCES probe_revisions(id);
ALTER TABLE scans ADD CHECK(assertion_revision_id IS NULL OR previous_scan_id IS NOT NULL);
ALTER TABLE runs ADD COLUMN assertion_revision_id uuid REFERENCES probe_revisions(id);
ALTER TABLE runs DROP CONSTRAINT runs_scan_id_image_id_probe_group_mode_key;
ALTER TABLE runs ADD UNIQUE NULLS NOT DISTINCT(scan_id,image_id,probe_group,mode,assertion_revision_id);
ALTER TABLE runs ADD CHECK(assertion_revision_id IS NULL OR (probe_group='root' AND mode='esm'));
CREATE FUNCTION validate_run_assertion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assertion_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scans s WHERE s.id=NEW.scan_id AND s.assertion_revision_id=NEW.assertion_revision_id)
  THEN RAISE EXCEPTION 'Run assertion differs from its scan'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_assertion BEFORE INSERT ON runs FOR EACH ROW EXECUTE FUNCTION validate_run_assertion();
