CREATE INDEX reports_discovery_recent ON reports(created_at DESC,id)
  WHERE invalidated_at IS NULL AND replaced_by IS NULL;
