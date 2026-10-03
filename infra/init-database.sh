#!/usr/bin/env bash
set -euo pipefail
psql --username postgres --dbname compatlab --set ON_ERROR_STOP=1 \
  --set web_password="$WEB_DB_PASSWORD" --set control_password="$CONTROL_DB_PASSWORD" \
  --set operator_password="$OPERATOR_DB_PASSWORD" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE compatlab_web LOGIN PASSWORD :'web_password';
CREATE ROLE compatlab_control LOGIN PASSWORD :'control_password';
CREATE ROLE compatlab_operator LOGIN PASSWORD :'operator_password';
GRANT CONNECT ON DATABASE compatlab TO compatlab_web,compatlab_control,compatlab_operator;
GRANT USAGE ON SCHEMA public TO compatlab_web,compatlab_control,compatlab_operator;
SQL
