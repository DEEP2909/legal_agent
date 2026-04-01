create table if not exists tenants (
  id uuid primary key,
  name text not null,
  region text not null default 'IN',
  plan text not null,
  created_at timestamptz not null default now()
);

create table if not exists attorneys (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  email text not null,
  full_name text not null,
  role text not null,
  practice_area text,
  password_hash text,
  can_login boolean not null default true,
  is_tenant_admin boolean not null default false,
  must_reset_password boolean not null default false,
  mfa_enabled boolean not null default false,
  mfa_secret text,
  mfa_recovery_codes jsonb not null default '[]'::jsonb,
  mfa_enabled_at timestamptz,
  last_login_at timestamptz,
  is_active boolean not null default true,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists matters (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  matter_code text not null,
  title text not null,
  client_name text,
  matter_type text not null,
  status text not null default 'open',
  jurisdiction text not null default 'India',
  responsible_attorney_id uuid references attorneys(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, matter_code)
);

create table if not exists documents (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  matter_id uuid references matters(id),
  source_name text not null,
  file_uri text not null,
  sha256 text not null,
  mime_type text not null,
  page_count integer,
  language text default 'en',
  doc_type text,
  ingestion_status text not null,
  security_status text not null default 'clean',
  security_reason text,
  scan_completed_at timestamptz,
  normalized_text text,
  ocr_confidence numeric(5,2),
  dedup_group_id uuid,
  privilege_score numeric(5,2),
  relevance_score numeric(5,2),
  created_by uuid references attorneys(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, sha256)
);

create table if not exists document_chunks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id),
  page_from integer,
  page_to integer,
  chunk_index integer not null,
  text_content text not null,
  citation_json jsonb not null default '{}'::jsonb,
  embedding double precision[],
  created_at timestamptz not null default now()
);

create table if not exists clauses (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id),
  clause_type text not null,
  heading text,
  text_excerpt text not null,
  page_from integer,
  page_to integer,
  source_span jsonb not null default '{}'::jsonb,
  extracted_entities jsonb not null default '{}'::jsonb,
  risk_level text,
  confidence numeric(5,2),
  reviewer_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists flags (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  matter_id uuid references matters(id),
  document_id uuid references documents(id),
  clause_id uuid references clauses(id),
  flag_type text not null,
  severity text not null,
  reason text not null,
  model_name text,
  confidence numeric(5,2),
  status text not null default 'open',
  assigned_to uuid references attorneys(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists review_actions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  object_type text not null,
  object_id uuid not null,
  action_type text not null,
  before_json jsonb,
  after_json jsonb,
  reviewer_id uuid not null references attorneys(id),
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  name text not null default 'default',
  key_prefix text not null,
  key_hash text not null unique,
  role text not null,
  status text not null default 'active',
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists workflow_jobs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  job_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  actor_attorney_id uuid references attorneys(id),
  event_type text not null,
  object_type text not null,
  object_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists invitations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  email text not null,
  full_name text,
  role text not null,
  practice_area text not null,
  is_tenant_admin boolean not null default false,
  token_hash text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references attorneys(id),
  created_at timestamptz not null default now()
);

create table if not exists password_reset_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  token_hash text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sso_providers (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  provider_name text not null,
  provider_type text not null default 'oidc',
  display_name text not null,
  client_id text not null,
  client_secret text not null,
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
  scopes text not null default 'openid profile email',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider_name)
);

create table if not exists sso_auth_states (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  provider_id uuid not null references sso_providers(id),
  state_hash text not null unique,
  nonce text not null,
  code_verifier text not null,
  redirect_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_exchanges (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  code_hash text not null unique,
  auth_method text not null,
  federation_protocol text,
  identity_provider text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists mfa_enrollments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  secret text not null,
  recovery_code_hashes jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (attorney_id)
);

create table if not exists mfa_challenges (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  challenge_hash text not null unique,
  auth_method text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists webauthn_credentials (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_type text not null,
  backed_up boolean not null default false,
  transports jsonb not null default '[]'::jsonb,
  label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists webauthn_challenges (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid not null references attorneys(id),
  challenge_value text not null,
  challenge_type text not null,
  linked_mfa_challenge_id uuid references mfa_challenges(id),
  label text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists scim_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  created_by uuid references attorneys(id),
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  status text not null default 'active',
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists saml_relay_states (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  provider_id uuid not null references sso_providers(id),
  relay_state_hash text not null unique,
  redirect_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists saml_login_sessions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  provider_id uuid not null references sso_providers(id),
  attorney_id uuid not null references attorneys(id),
  name_id text not null,
  name_id_format text,
  session_index text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, attorney_id)
);

create table if not exists saml_logout_states (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  provider_id uuid not null references sso_providers(id),
  attorney_id uuid references attorneys(id),
  relay_state_hash text not null unique,
  redirect_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists scim_groups (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  display_name text not null,
  description text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, display_name)
);

create table if not exists scim_group_members (
  group_id uuid not null references scim_groups(id) on delete cascade,
  attorney_id uuid not null references attorneys(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, attorney_id)
);

create table if not exists saml_request_cache (
  request_id text primary key,
  request_value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists research_queries (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  attorney_id uuid references attorneys(id),
  question text not null,
  answer text,
  model_name text,
  source_document_ids jsonb not null default '[]'::jsonb,
  context_used text,
  created_at timestamptz not null default now()
);

create index if not exists idx_documents_matter on documents (matter_id, created_at desc);
create index if not exists idx_clauses_document on clauses (document_id, clause_type);
create index if not exists idx_flags_status on flags (tenant_id, status, severity);
create index if not exists idx_api_keys_hash on api_keys (key_hash, status);
create index if not exists idx_workflow_jobs_status on workflow_jobs (tenant_id, status, available_at);
create index if not exists idx_audit_events_tenant_created on audit_events (tenant_id, created_at desc);
create index if not exists idx_invitations_tenant_status on invitations (tenant_id, status, expires_at);
create index if not exists idx_password_reset_tenant_status on password_reset_tokens (tenant_id, status, expires_at);
create index if not exists idx_sso_providers_tenant on sso_providers (tenant_id, enabled);
create index if not exists idx_sso_auth_states_provider on sso_auth_states (provider_id, expires_at);
create index if not exists idx_auth_exchanges_tenant on auth_exchanges (tenant_id, expires_at);
create index if not exists idx_mfa_enrollments_tenant on mfa_enrollments (tenant_id, expires_at);
create index if not exists idx_mfa_challenges_tenant on mfa_challenges (tenant_id, expires_at);
create index if not exists idx_webauthn_credentials_attorney on webauthn_credentials (attorney_id, created_at desc);
create index if not exists idx_webauthn_challenges_attorney on webauthn_challenges (attorney_id, expires_at);
create index if not exists idx_scim_tokens_hash on scim_tokens (token_hash, status);
create index if not exists idx_saml_relay_states_provider on saml_relay_states (provider_id, expires_at);
create index if not exists idx_saml_login_sessions_attorney on saml_login_sessions (attorney_id, updated_at desc);
create index if not exists idx_saml_logout_states_provider on saml_logout_states (provider_id, expires_at);
create index if not exists idx_scim_groups_tenant on scim_groups (tenant_id, created_at desc);
create index if not exists idx_scim_group_members_attorney on scim_group_members (attorney_id);
create index if not exists idx_saml_request_cache_expires on saml_request_cache (expires_at);
create index if not exists idx_research_queries_tenant on research_queries (tenant_id, created_at desc);
create index if not exists idx_research_queries_attorney on research_queries (attorney_id, created_at desc);

-- Playbooks table for tenant-specific risk assessment rules
create table if not exists playbooks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  description text,
  rules jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_by uuid references attorneys(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_playbooks_tenant on playbooks (tenant_id, is_active, created_at desc);

-- Note: All columns below are already defined in their respective CREATE TABLE statements above.
-- These ALTER TABLE statements were kept as migration-safe idempotent stubs during the initial
-- MVP development phase. They have been removed to reduce startup overhead.
-- If you need to add new columns, create a proper migration file instead.
