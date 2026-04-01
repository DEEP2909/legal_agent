/**
 * Initial database schema migration
 * This migration creates all core tables for the Legal Agent platform
 */
exports.up = (pgm) => {
  // Enable pgvector extension for vector similarity search
  pgm.sql("CREATE EXTENSION IF NOT EXISTS vector");

  // Tenants table
  pgm.createTable("tenants", {
    id: { type: "uuid", primaryKey: true },
    name: { type: "text", notNull: true },
    region: { type: "text", notNull: true, default: "IN" },
    plan: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Attorneys table
  pgm.createTable("attorneys", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    email: { type: "text", notNull: true },
    full_name: { type: "text", notNull: true },
    role: { type: "text", notNull: true },
    practice_area: { type: "text" },
    password_hash: { type: "text" },
    can_login: { type: "boolean", notNull: true, default: true },
    is_tenant_admin: { type: "boolean", notNull: true, default: false },
    must_reset_password: { type: "boolean", notNull: true, default: false },
    mfa_enabled: { type: "boolean", notNull: true, default: false },
    mfa_secret: { type: "text" },
    mfa_recovery_codes: { type: "jsonb", notNull: true, default: "[]" },
    mfa_enabled_at: { type: "timestamptz" },
    last_login_at: { type: "timestamptz" },
    is_active: { type: "boolean", notNull: true, default: true },
    failed_login_attempts: { type: "integer", notNull: true, default: 0 },
    locked_until: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("attorneys", "attorneys_tenant_email_unique", {
    unique: ["tenant_id", "email"]
  });

  // Matters table
  pgm.createTable("matters", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    matter_code: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    client_name: { type: "text" },
    matter_type: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "open" },
    jurisdiction: { type: "text", notNull: true, default: "India" },
    responsible_attorney_id: { type: "uuid", references: "attorneys" },
    opened_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    closed_at: { type: "timestamptz" }
  });
  pgm.addConstraint("matters", "matters_tenant_code_unique", {
    unique: ["tenant_id", "matter_code"]
  });

  // Documents table
  pgm.createTable("documents", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    matter_id: { type: "uuid", references: "matters" },
    source_name: { type: "text", notNull: true },
    file_uri: { type: "text", notNull: true },
    sha256: { type: "text", notNull: true },
    mime_type: { type: "text", notNull: true },
    page_count: { type: "integer" },
    language: { type: "text", default: "en" },
    doc_type: { type: "text" },
    ingestion_status: { type: "text", notNull: true },
    security_status: { type: "text", notNull: true, default: "clean" },
    security_reason: { type: "text" },
    scan_completed_at: { type: "timestamptz" },
    normalized_text: { type: "text" },
    ocr_confidence: { type: "numeric(5,2)" },
    dedup_group_id: { type: "uuid" },
    privilege_score: { type: "numeric(5,2)" },
    relevance_score: { type: "numeric(5,2)" },
    created_by: { type: "uuid", references: "attorneys" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("documents", "documents_tenant_sha256_unique", {
    unique: ["tenant_id", "sha256"]
  });

  // Document chunks table (for vector search)
  pgm.createTable("document_chunks", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    document_id: { type: "uuid", notNull: true, references: "documents" },
    page_from: { type: "integer" },
    page_to: { type: "integer" },
    chunk_index: { type: "integer", notNull: true },
    text_content: { type: "text", notNull: true },
    citation_json: { type: "jsonb", notNull: true, default: "{}" },
    embedding: { type: "vector(3072)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Clauses table
  pgm.createTable("clauses", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    document_id: { type: "uuid", notNull: true, references: "documents" },
    clause_type: { type: "text", notNull: true },
    heading: { type: "text" },
    text_excerpt: { type: "text", notNull: true },
    page_from: { type: "integer" },
    page_to: { type: "integer" },
    source_span: { type: "jsonb", notNull: true, default: "{}" },
    extracted_entities: { type: "jsonb", notNull: true, default: "{}" },
    risk_level: { type: "text" },
    confidence: { type: "numeric(5,2)" },
    reviewer_status: { type: "text", notNull: true, default: "pending" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Flags table
  pgm.createTable("flags", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    matter_id: { type: "uuid", references: "matters" },
    document_id: { type: "uuid", references: "documents" },
    clause_id: { type: "uuid", references: "clauses" },
    flag_type: { type: "text", notNull: true },
    severity: { type: "text", notNull: true },
    reason: { type: "text", notNull: true },
    model_name: { type: "text" },
    confidence: { type: "numeric(5,2)" },
    status: { type: "text", notNull: true, default: "open" },
    assigned_to: { type: "uuid", references: "attorneys" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    resolved_at: { type: "timestamptz" }
  });

  // Review actions table
  pgm.createTable("review_actions", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    object_type: { type: "text", notNull: true },
    object_id: { type: "uuid", notNull: true },
    action_type: { type: "text", notNull: true },
    before_json: { type: "jsonb" },
    after_json: { type: "jsonb" },
    reviewer_id: { type: "uuid", notNull: true, references: "attorneys" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // API keys table
  pgm.createTable("api_keys", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    name: { type: "text", notNull: true, default: "default" },
    key_prefix: { type: "text", notNull: true },
    key_hash: { type: "text", notNull: true, unique: true },
    role: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "active" },
    last_used_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Workflow jobs table
  pgm.createTable("workflow_jobs", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    job_type: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "queued" },
    payload: { type: "jsonb", notNull: true, default: "{}" },
    attempts: { type: "integer", notNull: true, default: 0 },
    max_attempts: { type: "integer", notNull: true, default: 5 },
    last_error: { type: "text" },
    available_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    locked_at: { type: "timestamptz" },
    locked_by: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Audit events table
  pgm.createTable("audit_events", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    actor_attorney_id: { type: "uuid", references: "attorneys" },
    event_type: { type: "text", notNull: true },
    object_type: { type: "text", notNull: true },
    object_id: { type: "text", notNull: true },
    metadata: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Invitations table
  pgm.createTable("invitations", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    email: { type: "text", notNull: true },
    full_name: { type: "text" },
    role: { type: "text", notNull: true },
    practice_area: { type: "text", notNull: true },
    is_tenant_admin: { type: "boolean", notNull: true, default: false },
    token_hash: { type: "text", notNull: true, unique: true },
    status: { type: "text", notNull: true, default: "pending" },
    expires_at: { type: "timestamptz", notNull: true },
    accepted_at: { type: "timestamptz" },
    created_by: { type: "uuid", references: "attorneys" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Password reset tokens table
  pgm.createTable("password_reset_tokens", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    token_hash: { type: "text", notNull: true, unique: true },
    status: { type: "text", notNull: true, default: "pending" },
    expires_at: { type: "timestamptz", notNull: true },
    used_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // SSO providers table
  pgm.createTable("sso_providers", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    provider_name: { type: "text", notNull: true },
    provider_type: { type: "text", notNull: true, default: "oidc" },
    display_name: { type: "text", notNull: true },
    client_id: { type: "text", notNull: true },
    client_secret: { type: "text", notNull: true },
    issuer_url: { type: "text" },
    jwks_uri: { type: "text" },
    authorization_endpoint: { type: "text" },
    token_endpoint: { type: "text" },
    userinfo_endpoint: { type: "text" },
    entity_id: { type: "text" },
    sso_url: { type: "text" },
    slo_url: { type: "text" },
    x509_cert: { type: "text" },
    name_id_format: { type: "text" },
    scopes: { type: "text", notNull: true, default: "openid profile email" },
    enabled: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("sso_providers", "sso_providers_tenant_name_unique", {
    unique: ["tenant_id", "provider_name"]
  });

  // SSO auth states table
  pgm.createTable("sso_auth_states", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    provider_id: { type: "uuid", notNull: true, references: "sso_providers" },
    state_hash: { type: "text", notNull: true, unique: true },
    nonce: { type: "text", notNull: true },
    code_verifier: { type: "text", notNull: true },
    redirect_path: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Auth exchanges table
  pgm.createTable("auth_exchanges", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    code_hash: { type: "text", notNull: true, unique: true },
    auth_method: { type: "text", notNull: true },
    federation_protocol: { type: "text" },
    identity_provider: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // MFA enrollments table
  pgm.createTable("mfa_enrollments", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, unique: true, references: "attorneys" },
    secret: { type: "text", notNull: true },
    recovery_code_hashes: { type: "jsonb", notNull: true, default: "[]" },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // MFA challenges table
  pgm.createTable("mfa_challenges", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    challenge_hash: { type: "text", notNull: true, unique: true },
    auth_method: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // WebAuthn credentials table
  pgm.createTable("webauthn_credentials", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    credential_id: { type: "text", notNull: true, unique: true },
    public_key: { type: "text", notNull: true },
    counter: { type: "bigint", notNull: true, default: 0 },
    device_type: { type: "text", notNull: true },
    backed_up: { type: "boolean", notNull: true, default: false },
    transports: { type: "jsonb", notNull: true, default: "[]" },
    label: { type: "text" },
    last_used_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // WebAuthn challenges table
  pgm.createTable("webauthn_challenges", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    challenge_value: { type: "text", notNull: true },
    challenge_type: { type: "text", notNull: true },
    linked_mfa_challenge_id: { type: "uuid", references: "mfa_challenges" },
    label: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // SCIM tokens table
  pgm.createTable("scim_tokens", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    created_by: { type: "uuid", references: "attorneys" },
    name: { type: "text", notNull: true },
    token_prefix: { type: "text", notNull: true },
    token_hash: { type: "text", notNull: true, unique: true },
    status: { type: "text", notNull: true, default: "active" },
    last_used_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // SAML relay states table
  pgm.createTable("saml_relay_states", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    provider_id: { type: "uuid", notNull: true, references: "sso_providers" },
    relay_state_hash: { type: "text", notNull: true, unique: true },
    redirect_path: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // SAML login sessions table
  pgm.createTable("saml_login_sessions", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    provider_id: { type: "uuid", notNull: true, references: "sso_providers" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    name_id: { type: "text", notNull: true },
    name_id_format: { type: "text" },
    session_index: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("saml_login_sessions", "saml_login_sessions_provider_attorney_unique", {
    unique: ["provider_id", "attorney_id"]
  });

  // SAML logout states table
  pgm.createTable("saml_logout_states", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    provider_id: { type: "uuid", notNull: true, references: "sso_providers" },
    attorney_id: { type: "uuid", references: "attorneys" },
    relay_state_hash: { type: "text", notNull: true, unique: true },
    redirect_path: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // SCIM groups table
  pgm.createTable("scim_groups", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    display_name: { type: "text", notNull: true },
    description: { type: "text" },
    external_id: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("scim_groups", "scim_groups_tenant_name_unique", {
    unique: ["tenant_id", "display_name"]
  });

  // SCIM group members table
  pgm.createTable("scim_group_members", {
    group_id: { type: "uuid", notNull: true, references: { name: "scim_groups", options: { onDelete: "CASCADE" } } },
    attorney_id: { type: "uuid", notNull: true, references: { name: "attorneys", options: { onDelete: "CASCADE" } } },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  }, {
    primaryKey: ["group_id", "attorney_id"]
  });

  // SAML request cache table
  pgm.createTable("saml_request_cache", {
    request_id: { type: "text", primaryKey: true },
    request_value: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Research queries table
  pgm.createTable("research_queries", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", references: "attorneys" },
    question: { type: "text", notNull: true },
    answer: { type: "text", notNull: true, default: "" },
    model_name: { type: "text" },
    source_document_ids: { type: "jsonb", notNull: true, default: "[]" },
    context_used: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Playbooks table
  pgm.createTable("playbooks", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    rules: { type: "jsonb", notNull: true, default: "[]" },
    is_active: { type: "boolean", notNull: true, default: false },
    created_by: { type: "uuid", references: "attorneys" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  // Refresh tokens table
  pgm.createTable("refresh_tokens", {
    id: { type: "uuid", primaryKey: true },
    tenant_id: { type: "uuid", notNull: true, references: "tenants" },
    attorney_id: { type: "uuid", notNull: true, references: "attorneys" },
    token_hash: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    revoked_at: { type: "timestamptz" },
    replaced_by: { type: "uuid", references: "refresh_tokens" }
  });

  // Create all indexes
  pgm.createIndex("documents", ["matter_id", "created_at"], { name: "idx_documents_matter" });
  pgm.createIndex("clauses", ["document_id", "clause_type"], { name: "idx_clauses_document" });
  pgm.createIndex("flags", ["tenant_id", "status", "severity"], { name: "idx_flags_status" });
  pgm.createIndex("api_keys", ["key_hash", "status"], { name: "idx_api_keys_hash" });
  pgm.createIndex("workflow_jobs", ["tenant_id", "status", "available_at"], { name: "idx_workflow_jobs_status" });
  pgm.createIndex("audit_events", ["tenant_id", "created_at"], { name: "idx_audit_events_tenant_created" });
  pgm.createIndex("invitations", ["tenant_id", "status", "expires_at"], { name: "idx_invitations_tenant_status" });
  pgm.createIndex("password_reset_tokens", ["tenant_id", "status", "expires_at"], { name: "idx_password_reset_tenant_status" });
  pgm.createIndex("sso_providers", ["tenant_id", "enabled"], { name: "idx_sso_providers_tenant" });
  pgm.createIndex("sso_auth_states", ["provider_id", "expires_at"], { name: "idx_sso_auth_states_provider" });
  pgm.createIndex("auth_exchanges", ["tenant_id", "expires_at"], { name: "idx_auth_exchanges_tenant" });
  pgm.createIndex("mfa_enrollments", ["tenant_id", "expires_at"], { name: "idx_mfa_enrollments_tenant" });
  pgm.createIndex("mfa_challenges", ["tenant_id", "expires_at"], { name: "idx_mfa_challenges_tenant" });
  pgm.createIndex("webauthn_credentials", ["attorney_id", "created_at"], { name: "idx_webauthn_credentials_attorney" });
  pgm.createIndex("webauthn_challenges", ["attorney_id", "expires_at"], { name: "idx_webauthn_challenges_attorney" });
  pgm.createIndex("scim_tokens", ["token_hash", "status"], { name: "idx_scim_tokens_hash" });
  pgm.createIndex("saml_relay_states", ["provider_id", "expires_at"], { name: "idx_saml_relay_states_provider" });
  pgm.createIndex("saml_login_sessions", ["attorney_id", "updated_at"], { name: "idx_saml_login_sessions_attorney" });
  pgm.createIndex("saml_logout_states", ["provider_id", "expires_at"], { name: "idx_saml_logout_states_provider" });
  pgm.createIndex("scim_groups", ["tenant_id", "created_at"], { name: "idx_scim_groups_tenant" });
  pgm.createIndex("scim_group_members", "attorney_id", { name: "idx_scim_group_members_attorney" });
  pgm.createIndex("saml_request_cache", "expires_at", { name: "idx_saml_request_cache_expires" });
  pgm.createIndex("research_queries", ["tenant_id", "created_at"], { name: "idx_research_queries_tenant" });
  pgm.createIndex("research_queries", ["attorney_id", "created_at"], { name: "idx_research_queries_attorney" });
  pgm.createIndex("document_chunks", "document_id", { name: "idx_document_chunks_document" });
  pgm.createIndex("document_chunks", ["tenant_id", "document_id"], { name: "idx_document_chunks_tenant" });
  pgm.createIndex("playbooks", ["tenant_id", "is_active", "created_at"], { name: "idx_playbooks_tenant" });
  
  // Partial index for active refresh tokens
  pgm.sql(`CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash) WHERE revoked_at IS NULL`);
  pgm.createIndex("refresh_tokens", ["attorney_id", "created_at"], { name: "idx_refresh_tokens_attorney" });

  // IVFFlat index for vector similarity search
  pgm.sql(`CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`);
};

exports.down = (pgm) => {
  // Drop tables in reverse order (respecting foreign key constraints)
  pgm.dropTable("refresh_tokens", { cascade: true });
  pgm.dropTable("playbooks", { cascade: true });
  pgm.dropTable("research_queries", { cascade: true });
  pgm.dropTable("saml_request_cache", { cascade: true });
  pgm.dropTable("scim_group_members", { cascade: true });
  pgm.dropTable("scim_groups", { cascade: true });
  pgm.dropTable("saml_logout_states", { cascade: true });
  pgm.dropTable("saml_login_sessions", { cascade: true });
  pgm.dropTable("saml_relay_states", { cascade: true });
  pgm.dropTable("scim_tokens", { cascade: true });
  pgm.dropTable("webauthn_challenges", { cascade: true });
  pgm.dropTable("webauthn_credentials", { cascade: true });
  pgm.dropTable("mfa_challenges", { cascade: true });
  pgm.dropTable("mfa_enrollments", { cascade: true });
  pgm.dropTable("auth_exchanges", { cascade: true });
  pgm.dropTable("sso_auth_states", { cascade: true });
  pgm.dropTable("sso_providers", { cascade: true });
  pgm.dropTable("password_reset_tokens", { cascade: true });
  pgm.dropTable("invitations", { cascade: true });
  pgm.dropTable("audit_events", { cascade: true });
  pgm.dropTable("workflow_jobs", { cascade: true });
  pgm.dropTable("api_keys", { cascade: true });
  pgm.dropTable("review_actions", { cascade: true });
  pgm.dropTable("flags", { cascade: true });
  pgm.dropTable("clauses", { cascade: true });
  pgm.dropTable("document_chunks", { cascade: true });
  pgm.dropTable("documents", { cascade: true });
  pgm.dropTable("matters", { cascade: true });
  pgm.dropTable("attorneys", { cascade: true });
  pgm.dropTable("tenants", { cascade: true });
  
  pgm.sql("DROP EXTENSION IF EXISTS vector");
};
