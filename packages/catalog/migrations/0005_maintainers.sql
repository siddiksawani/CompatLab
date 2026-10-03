CREATE TABLE auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text CHECK (ip_address IS NULL),
  user_agent text CHECK (user_agent IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL CHECK (provider_id='github'),
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text CHECK (password IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id,account_id),
  UNIQUE(user_id,provider_id)
);
CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier ON auth_verifications(identifier);
CREATE INDEX auth_verifications_expiry ON auth_verifications(expires_at);
CREATE TABLE repository_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  repository_id text NOT NULL CHECK (repository_id ~ '^[0-9]+$'),
  installation_id text NOT NULL CHECK (installation_id ~ '^[0-9]+$'),
  full_name text NOT NULL,
  authority text NOT NULL DEFAULT 'repository_authorized' CHECK (authority='repository_authorized'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,repository_id)
);
CREATE INDEX repository_links_installation ON repository_links(installation_id);
CREATE TABLE auth_authority_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0
);
INSERT INTO auth_authority_state(singleton) VALUES (true);
CREATE TABLE github_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_deliveries_expiry ON github_deliveries(received_at);
CREATE TABLE request_buckets (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX request_buckets_expiry ON request_buckets(expires_at);
ALTER TABLE scans ADD COLUMN account_key text CHECK (account_key ~ '^[a-f0-9]{64}$');
CREATE INDEX scans_account_requests ON scans(account_key,requested_at) WHERE account_key IS NOT NULL;
