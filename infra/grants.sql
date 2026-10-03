REVOKE ALL ON ALL TABLES IN SCHEMA public FROM compatlab_web,compatlab_control,compatlab_operator;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO compatlab_operator,compatlab_control;
GRANT INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO compatlab_operator;
GRANT SELECT ON packages,package_versions,preparations,runtime_images,matrices,matrix_members,scans,runs,jobs,reports,blocks,workers,service_controls TO compatlab_web;
GRANT INSERT ON packages,package_versions,preparations,scans,jobs,audit_events TO compatlab_web;
GRANT UPDATE (observed_tags,tags_observed_at,integrity_anomaly) ON package_versions TO compatlab_web;
GRANT INSERT ON jobs,runs,reports,audit_events TO compatlab_control;
GRANT UPDATE ON workers,preparations,scans,jobs,runs,reports TO compatlab_control;
GRANT DELETE ON audit_events TO compatlab_control;
