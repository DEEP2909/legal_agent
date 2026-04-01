-- Initial database schema migration
-- Creates all core tables for the Legal Agent platform

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  region text NOT NULL DEFAULT 'IN',
  plan text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Attorneys table
CREATE TABLE IF NOT EXISTS attorneys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL,
  practice_area text,
  password_hash text,
  can_login boolean NOT NULL DEFAULT true,
  is_tenant_admin boolean NOT NULL DEFAULT false,
  must_reset_password boolean NOT NULL DEFAULT false,
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret text,
  mfa_recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  mfa_enabled_at timestamptz,
  last_login_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Matters table
CREATE TABLE IF NOT EXISTS matters (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_code text NOT NULL,
  title text NOT NULL,
  client_name text,
  matter_type text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  jurisdiction text NOT NULL DEFAULT 'India',
  responsible_attorney_id uuid REFERENCES attorneys(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (tenant_id, matter_code)
);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  source_name text NOT NULL,
  file_uri text NOT NULL,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  page_count integer,
  language text DEFAULT 'en',
  doc_type text,
  ingestion_status text NOT NULL,
  security_status text NOT NULL DEFAULT 'clean',
  security_reason text,
  scan_completed_at timestamptz,
  normalized_text text,
  ocr_confidence numeric(5,2),
  dedup_group_id uuid,
  privilege_score numeric(5,2),
  relevance_score numeric(5,2),
  created_by uuid REFERENCES attorneys(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);

-- Document chunks table (for vector search)
CREATE TABLE IF NOT EXISTS document_chunks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  page_from integer,
  page_to integer,
  chunk_index integer NOT NULL,
  text_content text NOT NULL,
  citation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding halfvec(3072),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Clauses table
CREATE TABLE IF NOT EXISTS clauses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  clause_type text NOT NULL,
  heading text,
  text_excerpt text NOT NULL,
  page_from integer,
  page_to integer,
  source_span jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_level text,
  confidence numeric(5,2),
  reviewer_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Flags table
CREATE TABLE IF NOT EXISTS flags (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  document_id uuid REFERENCES documents(id),
  clause_id uuid REFERENCES clauses(id),
  flag_type text NOT NULL,
  severity text NOT NULL,
  reason text NOT NULL,
  model_name text,
  confidence numeric(5,2),
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES attorneys(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Review actions table
CREATE TABLE IF NOT EXISTS review_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  action_type text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  reviewer_id uuid NOT NULL REFERENCES attorneys(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  name text NOT NULL DEFAULT 'default',
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Workflow jobs table
CREATE TABLE IF NOT EXISTS workflow_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Audit events table
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_attorney_id uuid REFERENCES attorneys(id),
  event_type text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  full_name text,
  role text NOT NULL,
  practice_area text NOT NULL,
  is_tenant_admin boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by uuid REFERENCES attorneys(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SSO providers table
CREATE TABLE IF NOT EXISTS sso_providers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'oidc',
  display_name text NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  issuer_url text,
  jwks_uri text,
  authorization_endpoint text,
  token_endpoint text,
  userinfo_endpoint text,
  entity_id text,
  sso_url text,
  slo_url text,
  x509_cert text,
  name_id_format text,
  scopes text NOT NULL DEFAULT 'openid profile email',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_name)
);

-- SSO auth states table
CREATE TABLE IF NOT EXISTS sso_auth_states (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES sso_providers(id),
  state_hash text NOT NULL UNIQUE,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  redirect_path text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auth exchanges table
CREATE TABLE IF NOT EXISTS auth_exchanges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  code_hash text NOT NULL UNIQUE,
  auth_method text NOT NULL,
  federation_protocol text,
  identity_provider text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- MFA enrollments table
CREATE TABLE IF NOT EXISTS mfa_enrollments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id) UNIQUE,
  secret text NOT NULL,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- MFA challenges table
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  challenge_hash text NOT NULL UNIQUE,
  auth_method text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn credentials table
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_type text NOT NULL,
  backed_up boolean NOT NULL DEFAULT false,
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  label text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn challenges table
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  challenge_value text NOT NULL,
  challenge_type text NOT NULL,
  linked_mfa_challenge_id uuid REFERENCES mfa_challenges(id),
  label text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SCIM tokens table
CREATE TABLE IF NOT EXISTS scim_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid REFERENCES attorneys(id),
  name text NOT NULL,
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SAML relay states table
CREATE TABLE IF NOT EXISTS saml_relay_states (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES sso_providers(id),
  relay_state_hash text NOT NULL UNIQUE,
  redirect_path text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SAML login sessions table
CREATE TABLE IF NOT EXISTS saml_login_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES sso_providers(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  name_id text NOT NULL,
  name_id_format text,
  session_index text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, attorney_id)
);

-- SAML logout states table
CREATE TABLE IF NOT EXISTS saml_logout_states (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES sso_providers(id),
  attorney_id uuid REFERENCES attorneys(id),
  relay_state_hash text NOT NULL UNIQUE,
  redirect_path text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SCIM groups table
CREATE TABLE IF NOT EXISTS scim_groups (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  display_name text NOT NULL,
  description text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_name)
);

-- SCIM group members table
CREATE TABLE IF NOT EXISTS scim_group_members (
  group_id uuid NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  attorney_id uuid NOT NULL REFERENCES attorneys(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, attorney_id)
);

-- SAML request cache table
CREATE TABLE IF NOT EXISTS saml_request_cache (
  request_id text PRIMARY KEY,
  request_value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Research queries table
CREATE TABLE IF NOT EXISTS research_queries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid REFERENCES attorneys(id),
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  model_name text,
  source_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_used text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Playbooks table
CREATE TABLE IF NOT EXISTS playbooks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES attorneys(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attorney_id uuid NOT NULL REFERENCES attorneys(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_documents_matter ON documents (matter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clauses_document ON clauses (document_id, clause_type);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags (tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash, status);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_status ON workflow_jobs (tenant_id, status, available_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created ON audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant_status ON invitations (tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tenant_status ON password_reset_tokens (tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_sso_providers_tenant ON sso_providers (tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_sso_auth_states_provider ON sso_auth_states (provider_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_exchanges_tenant ON auth_exchanges (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_enrollments_tenant ON mfa_enrollments (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_tenant ON mfa_challenges (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_attorney ON webauthn_credentials (attorney_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_attorney ON webauthn_challenges (attorney_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_hash ON scim_tokens (token_hash, status);
CREATE INDEX IF NOT EXISTS idx_saml_relay_states_provider ON saml_relay_states (provider_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_saml_login_sessions_attorney ON saml_login_sessions (attorney_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saml_logout_states_provider ON saml_logout_states (provider_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_scim_groups_tenant ON scim_groups (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scim_group_members_attorney ON scim_group_members (attorney_id);
CREATE INDEX IF NOT EXISTS idx_saml_request_cache_expires ON saml_request_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_research_queries_tenant ON research_queries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_queries_attorney ON research_queries (attorney_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant ON document_chunks (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_tenant ON playbooks (tenant_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_attorney ON refresh_tokens (attorney_id, created_at DESC);

-- HNSW index for vector similarity search.
-- halfvec required: both HNSW and IVFFlat cap at 2000 dims for the standard vector type.
-- halfvec supports up to 16000 dims and is available in pgvector >= 0.7.0.
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
  ON document_chunks USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);
