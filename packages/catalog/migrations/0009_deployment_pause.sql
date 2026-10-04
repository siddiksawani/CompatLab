ALTER TABLE service_controls ADD COLUMN deployment_release text
  CHECK (deployment_release ~ '^[a-f0-9]{40}$');
