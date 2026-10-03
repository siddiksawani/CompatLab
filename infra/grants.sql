REVOKE ALL ON ALL TABLES IN SCHEMA public FROM compatlab_web,compatlab_control,compatlab_operator;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO compatlab_operator,compatlab_control;
GRANT INSERT ON packages,package_versions,preparations,runtime_images,matrices,matrix_members,scans,jobs,workers,blocks,reports TO compatlab_operator;
GRANT INSERT ON audit_events TO compatlab_operator;
GRANT UPDATE ON workers,preparations,scans,jobs,runs,reports,runtime_images,matrices,blocks,service_controls TO compatlab_operator;
GRANT UPDATE (observed_tags,tags_observed_at,integrity_anomaly) ON package_versions TO compatlab_operator;
GRANT DELETE ON audit_events TO compatlab_operator;
GRANT SELECT ON packages,package_versions,preparations,runtime_images,matrices,matrix_members,scans,runs,jobs,reports,blocks,workers,service_controls TO compatlab_web;
GRANT INSERT ON packages,package_versions,preparations,scans,jobs,audit_events TO compatlab_web;
GRANT UPDATE (observed_tags,tags_observed_at,integrity_anomaly) ON package_versions TO compatlab_web;
GRANT INSERT ON jobs,runs,reports,audit_events TO compatlab_control;
GRANT UPDATE ON workers,preparations,scans,jobs,runs,reports TO compatlab_control;
GRANT DELETE ON audit_events TO compatlab_control;
REVOKE SELECT ON monitors,monitor_releases,notifications,notification_deliveries FROM compatlab_operator,compatlab_control;
GRANT SELECT,INSERT,UPDATE,DELETE ON monitors,monitor_releases,notifications,notification_deliveries TO compatlab_web;
REVOKE SELECT ON auth_users,auth_sessions,auth_accounts,auth_verifications FROM compatlab_operator,compatlab_control;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_users,auth_sessions,auth_accounts,auth_verifications,repository_links,github_deliveries,request_buckets TO compatlab_web;
GRANT SELECT,UPDATE ON auth_authority_state TO compatlab_web;
GRANT SELECT (id,expires_at) ON auth_sessions,auth_verifications TO compatlab_control,compatlab_operator;
GRANT DELETE ON auth_sessions,auth_verifications,github_deliveries,request_buckets TO compatlab_control,compatlab_operator;

CREATE OR REPLACE FUNCTION public.expired_auth_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user IN ('compatlab_control','compatlab_operator') AND OLD.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Only expired authentication records may be removed by maintenance';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS expired_auth_only ON auth_sessions;
CREATE TRIGGER expired_auth_only BEFORE DELETE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION public.expired_auth_only();
DROP TRIGGER IF EXISTS expired_auth_only ON auth_verifications;
CREATE TRIGGER expired_auth_only BEFORE DELETE ON auth_verifications FOR EACH ROW EXECUTE FUNCTION public.expired_auth_only();

CREATE OR REPLACE FUNCTION public.stamp_operator_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user='compatlab_operator' THEN
    IF NEW.action='operator_database_mutation' THEN
      RAISE EXCEPTION 'Database mutation audit events cannot be supplied by an operator';
    END IF;
    NEW.details := NEW.details || jsonb_build_object('claimedActor',NEW.actor,'databaseRole',current_user,'transactionId',pg_current_xact_id()::text);
    NEW.actor := 'database:' || current_user;
    NEW.id := gen_random_uuid();
    NEW.created_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS operator_audit_origin ON public.audit_events;
CREATE TRIGGER operator_audit_origin BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.stamp_operator_audit();

CREATE OR REPLACE FUNCTION public.audit_operator_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  operator_role text := coalesce(nullif(current_setting('role',true),'none'),session_user);
  row_id text;
BEGIN
  IF operator_role <> 'compatlab_operator' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='service_controls' THEN row_id := 'singleton';
  ELSIF TG_TABLE_NAME='matrix_members' THEN row_id := NEW.matrix_id::text || ':' || NEW.position::text;
  ELSE row_id := NEW.id::text;
  END IF;
  INSERT INTO public.audit_events(actor,reason,action,details)
  VALUES('database:' || operator_role,'Database-enforced operator mutation.','operator_database_mutation',
    jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,'rowId',row_id,'transactionId',pg_current_xact_id()::text));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_operator_mutation() FROM PUBLIC;
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['packages','package_versions','preparations','runtime_images','matrices','matrix_members','scans','jobs','workers','blocks','runs','reports','service_controls'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS operator_mutation_audit ON public.%I',relation);
    EXECUTE format('CREATE TRIGGER operator_mutation_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_operator_mutation()',relation);
  END LOOP;
END $$;
