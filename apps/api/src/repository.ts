import type {
  ApiKeySummary,
  Attorney,
  AuthSession,
  ClauseRecord,
  DashboardSnapshot,
  DocumentRecord,
  FlagRecord,
  InvitationSummary,
  PasskeySummary,
  Matter,
  ResearchResponse,
  ScimTokenSummary,
  SsoProviderSummary,
  Tenant
} from "@legal-agent/shared";
import { pool } from "./database.js";

function mapAttorney(row: Record<string, unknown>): Attorney {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    canLogin: Boolean(row.can_login)
  };
}

function mapTenant(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    name: String(row.name),
    region: String(row.region),
    plan: String(row.plan)
  };
}

function mapMatter(row: Record<string, unknown>): Matter {
  return {
    id: String(row.id),
    matterCode: String(row.matter_code),
    title: String(row.title),
    clientName: String(row.client_name ?? ""),
    matterType: String(row.matter_type),
    status: row.status as Matter["status"],
    jurisdiction: String(row.jurisdiction),
    responsibleAttorneyId: String(row.responsible_attorney_id ?? "")
  };
}

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    matterId: String(row.matter_id),
    sourceName: String(row.source_name),
    mimeType: String(row.mime_type),
    docType: String(row.doc_type ?? ""),
    ingestionStatus: row.ingestion_status as DocumentRecord["ingestionStatus"],
    securityStatus: (row.security_status as DocumentRecord["securityStatus"]) ?? "clean",
    securityReason: row.security_reason ? String(row.security_reason) : undefined,
    normalizedText: String(row.normalized_text ?? ""),
    privilegeScore: Number(row.privilege_score ?? 0),
    relevanceScore: Number(row.relevance_score ?? 0),
    storagePath: String(row.file_uri ?? ""),
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    sha256: String(row.sha256 ?? "")
  };
}

function mapClause(row: Record<string, unknown>): ClauseRecord {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    clauseType: String(row.clause_type),
    heading: row.heading ? String(row.heading) : null,
    textExcerpt: String(row.text_excerpt),
    pageFrom: Number(row.page_from ?? 1),
    pageTo: Number(row.page_to ?? 1),
    riskLevel: row.risk_level as ClauseRecord["riskLevel"],
    confidence: Number(row.confidence ?? 0),
    reviewerStatus: row.reviewer_status as ClauseRecord["reviewerStatus"]
  };
}

function mapFlag(row: Record<string, unknown>): FlagRecord {
  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    documentId: String(row.document_id),
    clauseId: row.clause_id ? String(row.clause_id) : undefined,
    flagType: String(row.flag_type),
    severity: row.severity as FlagRecord["severity"],
    reason: String(row.reason),
    confidence: Number(row.confidence ?? 0),
    status: row.status as FlagRecord["status"]
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKeySummary {
  return {
    id: String(row.id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    role: row.role as Attorney["role"],
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : undefined
  };
}

function mapInvitation(row: Record<string, unknown>): InvitationSummary {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: row.full_name ? String(row.full_name) : undefined,
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    status: String(row.status),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    acceptedAt: row.accepted_at ? new Date(String(row.accepted_at)).toISOString() : undefined,
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function mapPasskey(row: Record<string, unknown>): PasskeySummary {
  return {
    id: String(row.id),
    credentialId: String(row.credential_id),
    label: row.label ? String(row.label) : undefined,
    deviceType: row.device_type as PasskeySummary["deviceType"],
    backedUp: Boolean(row.backed_up),
    transports: Array.isArray(row.transports) ? row.transports.map(String) : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : undefined
  };
}

function mapScimToken(row: Record<string, unknown>): ScimTokenSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : undefined
  };
}

function mapSsoProvider(row: Record<string, unknown>): SsoProviderSummary {
  return {
    id: String(row.id),
    providerName: String(row.provider_name),
    providerType: (row.provider_type as SsoProviderSummary["providerType"]) ?? "oidc",
    displayName: String(row.display_name),
    clientId: String(row.client_id),
    issuerUrl: row.issuer_url ? String(row.issuer_url) : undefined,
    jwksUri: row.jwks_uri ? String(row.jwks_uri) : undefined,
    authorizationEndpoint: row.authorization_endpoint ? String(row.authorization_endpoint) : undefined,
    tokenEndpoint: row.token_endpoint ? String(row.token_endpoint) : undefined,
    userinfoEndpoint: row.userinfo_endpoint ? String(row.userinfo_endpoint) : undefined,
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    ssoUrl: row.sso_url ? String(row.sso_url) : undefined,
    sloUrl: row.slo_url ? String(row.slo_url) : undefined,
    x509Cert: row.x509_cert ? String(row.x509_cert) : undefined,
    nameIdFormat: row.name_id_format ? String(row.name_id_format) : undefined,
    scopes: String(row.scopes),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

export const repository = {
  async authenticateApiKey(keyHash: string): Promise<AuthSession | null> {
    const result = await pool.query(
      `select k.id as api_key_id, k.tenant_id, k.attorney_id, k.role, a.email, a.full_name, a.is_tenant_admin
       from api_keys k
       join attorneys a on a.id = k.attorney_id
       where k.key_hash = $1 and k.status = 'active'
       limit 1`,
      [keyHash]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    await pool.query("update api_keys set last_used_at = now() where id = $1", [row.api_key_id]);

    return {
      tenantId: String(row.tenant_id),
      attorneyId: String(row.attorney_id),
      role: row.role as AuthSession["role"],
      apiKeyId: undefined,
      email: String(row.email ?? ""),
      fullName: String(row.full_name ?? ""),
      isTenantAdmin: Boolean(row.is_tenant_admin),
      authMethod: "api_key"
    };
  },

  async getAttorneyForLogin(email: string, tenantId: string) {
    if (!tenantId) {
      throw new Error("Tenant ID is required for login");
    }
    const result = await pool.query(
      `select a.*
       from attorneys a
       where lower(a.email) = lower($1) and a.tenant_id = $2 and a.can_login = true and a.is_active = true
       limit 1`,
      [email, tenantId]
    );
    return result.rows[0] ?? null;
  },

  async getAttorneyByEmailForTenant(tenantId: string, email: string) {
    const result = await pool.query(
      `select * from attorneys
       where tenant_id = $1 and lower(email) = lower($2)
       limit 1`,
      [tenantId, email]
    );

    return result.rows[0] ? mapAttorney(result.rows[0]) : null;
  },

  async getAttorneyByEmailForPasswordReset(email: string, tenantId?: string) {
    // For password reset, we allow lookup by email with optional tenant scope
    // This is needed for forgot-password flows where tenant may not be known
    const query = tenantId
      ? `select * from attorneys
         where lower(email) = lower($1) and tenant_id = $2 and can_login = true and is_active = true
         limit 1`
      : `select * from attorneys
         where lower(email) = lower($1) and can_login = true and is_active = true
         limit 1`;
    const params = tenantId ? [email, tenantId] : [email];
    const result = await pool.query(query, params);
    return result.rows[0] ?? null;
  },

  async getAttorneyForPasswordless(tenantId: string, email: string) {
    const result = await pool.query(
      `select *
       from attorneys
       where tenant_id = $1
         and lower(email) = lower($2)
         and can_login = true
         and is_active = true
       limit 1`,
      [tenantId, email]
    );

    return result.rows[0] ?? null;
  },

  async getAttorneyByIdForTenant(attorneyId: string, tenantId: string) {
    const result = await pool.query(
      `select * from attorneys
       where id = $1 and tenant_id = $2
       limit 1`,
      [attorneyId, tenantId]
    );

    return result.rows[0] ?? null;
  },

  async getAttorneySession(attorneyId: string): Promise<AuthSession | null> {
    const result = await pool.query(
      `select id, tenant_id, email, full_name, role, is_tenant_admin
       from attorneys
       where id = $1 and is_active = true
       limit 1`,
      [attorneyId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      tenantId: String(row.tenant_id),
      attorneyId: String(row.id),
      role: row.role as AuthSession["role"],
      apiKeyId: undefined,
      email: String(row.email ?? ""),
      fullName: String(row.full_name ?? ""),
      isTenantAdmin: Boolean(row.is_tenant_admin),
      authMethod: "jwt"
    };
  },

  async getAttorneySecurity(attorneyId: string) {
    const result = await pool.query(
      `select id, tenant_id, email, full_name, role, is_tenant_admin, mfa_enabled, mfa_secret,
              mfa_recovery_codes, mfa_enabled_at
       from attorneys
       where id = $1 and is_active = true
       limit 1`,
      [attorneyId]
    );

    return result.rows[0] ?? null;
  },

  async markAttorneyLoggedIn(attorneyId: string) {
    await pool.query(
      "update attorneys set last_login_at = now(), failed_login_attempts = 0, locked_until = null where id = $1",
      [attorneyId]
    );
  },

  async recordFailedLoginAttempt(attorneyId: string, lockoutThreshold: number, lockoutDurationMinutes: number) {
    // Increment failed attempts and lock if threshold exceeded
    await pool.query(
      `update attorneys 
       set failed_login_attempts = failed_login_attempts + 1,
           locked_until = case 
             when failed_login_attempts + 1 >= $2 
             then now() + interval '1 minute' * $3
             else locked_until
           end
       where id = $1`,
      [attorneyId, lockoutThreshold, lockoutDurationMinutes]
    );
  },

  async isAccountLocked(attorneyId: string): Promise<{ locked: boolean; lockedUntil: Date | null }> {
    const result = await pool.query(
      `select locked_until from attorneys where id = $1`,
      [attorneyId]
    );
    const lockedUntil = result.rows[0]?.locked_until;
    if (!lockedUntil) {
      return { locked: false, lockedUntil: null };
    }
    const lockDate = new Date(lockedUntil);
    return { 
      locked: lockDate > new Date(), 
      lockedUntil: lockDate > new Date() ? lockDate : null 
    };
  },

  async clearAccountLockout(attorneyId: string) {
    await pool.query(
      "update attorneys set failed_login_attempts = 0, locked_until = null where id = $1",
      [attorneyId]
    );
  },

  async getTenantIds() {
    const result = await pool.query("select id from tenants order by created_at asc");
    return result.rows.map((row) => String(row.id));
  },

  async getDashboard(tenantId: string): Promise<DashboardSnapshot> {
    const [tenant, attorneys, matters, documents, clauses, flags] = await Promise.all([
      pool.query("select * from tenants where id = $1 limit 1", [tenantId]),
      pool.query("select * from attorneys where tenant_id = $1 order by created_at desc limit 100", [tenantId]),
      pool.query("select * from matters where tenant_id = $1 order by opened_at desc limit 100", [tenantId]),
      pool.query("select * from documents where tenant_id = $1 order by created_at desc limit 200", [tenantId]),
      pool.query("select * from clauses where tenant_id = $1 order by created_at desc limit 500", [tenantId]),
      pool.query("select * from flags where tenant_id = $1 order by created_at desc limit 200", [tenantId])
    ]);

    return {
      tenant: tenant.rows[0] ? mapTenant(tenant.rows[0]) : undefined,
      attorneys: attorneys.rows.map(mapAttorney),
      matters: matters.rows.map(mapMatter),
      documents: documents.rows.map(mapDocument),
      clauses: clauses.rows.map(mapClause),
      flags: flags.rows.map(mapFlag)
    };
  },

  async listTenants(options?: { limit?: number; offset?: number }) {
    const limit = Math.min(options?.limit ?? 200, 200);
    const offset = options?.offset ?? 0;
    const result = await pool.query(
      "select * from tenants order by created_at desc limit $1 offset $2",
      [limit, offset]
    );
    return result.rows.map(mapTenant);
  },

  async countTenants() {
    const result = await pool.query<{ count: string }>("select count(*)::text as count from tenants");
    return Number(result.rows[0]?.count ?? "0");
  },

  async createTenant(input: { id: string; name: string; region: string; plan: string }) {
    const result = await pool.query(
      `insert into tenants (id, name, region, plan)
       values ($1, $2, $3, $4)
       returning *`,
      [input.id, input.name, input.region, input.plan]
    );

    return mapTenant(result.rows[0]);
  },

  async updateTenant(input: { tenantId: string; name: string; region: string; plan: string }) {
    const result = await pool.query(
      `update tenants
       set name = $2, region = $3, plan = $4
       where id = $1
       returning *`,
      [input.tenantId, input.name, input.region, input.plan]
    );

    return result.rows[0] ? mapTenant(result.rows[0]) : undefined;
  },

  async listAttorneys(tenantId: string, options?: { limit?: number; offset?: number }) {
    const limit = Math.min(options?.limit ?? 200, 200);
    const offset = options?.offset ?? 0;
    const result = await pool.query(
      "select * from attorneys where tenant_id = $1 order by created_at desc limit $2 offset $3",
      [tenantId, limit, offset]
    );
    return result.rows.map(mapAttorney);
  },

  async countAttorneys(tenantId: string) {
    const result = await pool.query<{ count: string }>(
      "select count(*)::text as count from attorneys where tenant_id = $1",
      [tenantId]
    );
    return Number(result.rows[0]?.count ?? "0");
  },

  async listAttorneysForScim(input: { tenantId: string; startIndex: number; count: number; email?: string }) {
    const offset = Math.max(input.startIndex - 1, 0);
    const values: Array<string | number> = [input.tenantId];
    let whereClause = "where tenant_id = $1";

    if (input.email) {
      values.push(input.email);
      whereClause += ` and lower(email) = lower($${values.length})`;
    }

    const totalResult = await pool.query<{ count: string }>(
      `select count(*)::text as count from attorneys ${whereClause}`,
      values
    );

    values.push(input.count);
    values.push(offset);
    const result = await pool.query(
      `select * from attorneys
       ${whereClause}
       order by created_at asc
       limit $${values.length - 1} offset $${values.length}`,
      values
    );

    return {
      totalResults: Number(totalResult.rows[0]?.count ?? "0"),
      attorneys: result.rows
    };
  },

  async createAttorney(input: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: Attorney["role"];
    practiceArea: string;
    passwordHash: string;
    isTenantAdmin: boolean;
    canLogin?: boolean;
    isActive?: boolean;
  }) {
    const result = await pool.query(
      `insert into attorneys
       (id, tenant_id, email, full_name, role, practice_area, password_hash, can_login, is_tenant_admin, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [
        input.id,
        input.tenantId,
        input.email,
        input.fullName,
        input.role,
        input.practiceArea,
        input.passwordHash,
        input.canLogin ?? true,
        input.isTenantAdmin,
        input.isActive ?? true
      ]
    );

    return mapAttorney(result.rows[0]);
  },

  async updateAttorneyIdentity(input: {
    attorneyId: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: Attorney["role"];
    practiceArea: string;
    isTenantAdmin: boolean;
    canLogin: boolean;
    isActive: boolean;
  }) {
    const result = await pool.query(
      `update attorneys
       set email = $3,
           full_name = $4,
           role = $5,
           practice_area = $6,
           is_tenant_admin = $7,
           can_login = $8,
           is_active = $9
       where id = $1 and tenant_id = $2
       returning *`,
      [
        input.attorneyId,
        input.tenantId,
        input.email,
        input.fullName,
        input.role,
        input.practiceArea,
        input.isTenantAdmin,
        input.canLogin,
        input.isActive
      ]
    );

    return result.rows[0] ? mapAttorney(result.rows[0]) : undefined;
  },

  async listApiKeys(tenantId: string, options?: { limit?: number; offset?: number }) {
    const limit = Math.min(options?.limit ?? 200, 200);
    const offset = options?.offset ?? 0;
    const result = await pool.query(
      "select * from api_keys where tenant_id = $1 order by created_at desc limit $2 offset $3",
      [tenantId, limit, offset]
    );
    return result.rows.map(mapApiKey);
  },

  async countApiKeys(tenantId: string) {
    const result = await pool.query<{ count: string }>(
      "select count(*)::text as count from api_keys where tenant_id = $1",
      [tenantId]
    );
    return Number(result.rows[0]?.count ?? "0");
  },

  async createApiKey(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    role: Attorney["role"];
  }) {
    const result = await pool.query(
      `insert into api_keys
       (id, tenant_id, attorney_id, name, key_prefix, key_hash, role, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'active')
       returning *`,
      [
        input.id,
        input.tenantId,
        input.attorneyId,
        input.name,
        input.keyPrefix,
        input.keyHash,
        input.role
      ]
    );

    return mapApiKey(result.rows[0]);
  },

  async listScimTokens(tenantId: string) {
    const result = await pool.query(
      "select * from scim_tokens where tenant_id = $1 order by created_at desc",
      [tenantId]
    );
    return result.rows.map(mapScimToken);
  },

  async createScimToken(input: {
    id: string;
    tenantId: string;
    createdBy: string;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
  }) {
    const result = await pool.query(
      `insert into scim_tokens
       (id, tenant_id, created_by, name, token_prefix, token_hash, status)
       values ($1, $2, $3, $4, $5, $6, 'active')
       returning *`,
      [
        input.id,
        input.tenantId,
        input.createdBy,
        input.name,
        input.tokenPrefix,
        input.tokenHash
      ]
    );

    return mapScimToken(result.rows[0]);
  },

  async authenticateScimToken(tokenHash: string): Promise<{ id: string; tenantId: string } | null> {
    const result = await pool.query(
      `select id, tenant_id
       from scim_tokens
       where token_hash = $1 and status = 'active'
       limit 1`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    await pool.query("update scim_tokens set last_used_at = now() where id = $1", [row.id]);

    return {
      id: String(row.id),
      tenantId: String(row.tenant_id)
    };
  },

  async listInvitations(tenantId: string, options?: { limit?: number; offset?: number }) {
    const limit = Math.min(options?.limit ?? 200, 200);
    const offset = options?.offset ?? 0;
    const result = await pool.query(
      "select * from invitations where tenant_id = $1 order by created_at desc limit $2 offset $3",
      [tenantId, limit, offset]
    );
    return result.rows.map(mapInvitation);
  },

  async countInvitations(tenantId: string) {
    const result = await pool.query<{ count: string }>(
      "select count(*)::text as count from invitations where tenant_id = $1",
      [tenantId]
    );
    return Number(result.rows[0]?.count ?? "0");
  },

  async createInvitation(input: {
    id: string;
    tenantId: string;
    email: string;
    fullName?: string;
    role: Attorney["role"];
    practiceArea: string;
    isTenantAdmin: boolean;
    tokenHash: string;
    createdBy: string;
  }) {
    const result = await pool.query(
      `insert into invitations
       (id, tenant_id, email, full_name, role, practice_area, is_tenant_admin, token_hash, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '7 days', $9)
       returning *`,
      [
        input.id,
        input.tenantId,
        input.email,
        input.fullName ?? null,
        input.role,
        input.practiceArea,
        input.isTenantAdmin,
        input.tokenHash,
        input.createdBy
      ]
    );

    return mapInvitation(result.rows[0]);
  },

  async getInvitationByTokenHash(tokenHash: string) {
    const result = await pool.query(
      `select * from invitations
       where token_hash = $1 and status = 'pending' and expires_at > now()
       limit 1`,
      [tokenHash]
    );

    return result.rows[0] ? result.rows[0] : null;
  },

  async getPendingInvitationByEmail(tenantId: string, email: string) {
    const result = await pool.query(
      `select * from invitations
       where tenant_id = $1
         and lower(email) = lower($2)
         and status = 'pending'
         and expires_at > now()
       limit 1`,
      [tenantId, email]
    );

    return result.rows[0] ?? null;
  },

  async markInvitationAccepted(invitationId: string) {
    const result = await pool.query(
      `update invitations
       set status = 'accepted', accepted_at = now()
       where id = $1
       returning *`,
      [invitationId]
    );

    return result.rows[0] ? mapInvitation(result.rows[0]) : undefined;
  },

  async createPasswordResetToken(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    tokenHash: string;
  }) {
    await pool.query(
      `insert into password_reset_tokens
       (id, tenant_id, attorney_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 hour')`,
      [input.id, input.tenantId, input.attorneyId, input.tokenHash]
    );
  },

  async getPasswordResetToken(tokenHash: string) {
    const result = await pool.query(
      `select * from password_reset_tokens
       where token_hash = $1 and status = 'pending' and expires_at > now()
       limit 1`,
      [tokenHash]
    );
    return result.rows[0] ?? null;
  },

  async consumePasswordResetToken(tokenId: string) {
    await pool.query(
      `update password_reset_tokens
       set status = 'used', used_at = now()
       where id = $1`,
      [tokenId]
    );
  },

  async updateAttorneyPassword(attorneyId: string, passwordHash: string) {
    await pool.query(
      `update attorneys
       set password_hash = $2, can_login = true
       where id = $1`,
      [attorneyId, passwordHash]
    );
  },

  async listSsoProviders(tenantId: string) {
    const result = await pool.query(
      "select * from sso_providers where tenant_id = $1 order by created_at desc",
      [tenantId]
    );
    return result.rows.map(mapSsoProvider);
  },

  async listEnabledSsoProviders(tenantId: string) {
    const result = await pool.query(
      "select * from sso_providers where tenant_id = $1 and enabled = true order by created_at desc",
      [tenantId]
    );
    return result.rows.map(mapSsoProvider);
  },

  async getSsoProviderForTenant(tenantId: string, providerName: string) {
    const result = await pool.query(
      "select * from sso_providers where tenant_id = $1 and provider_name = $2 and enabled = true limit 1",
      [tenantId, providerName]
    );
    return result.rows[0] ?? null;
  },

  async getSsoProviderByTenantAndName(tenantId: string, providerName: string) {
    const result = await pool.query(
      "select * from sso_providers where tenant_id = $1 and provider_name = $2 limit 1",
      [tenantId, providerName]
    );
    return result.rows[0] ?? null;
  },

  async getSsoProviderById(providerId: string) {
    const result = await pool.query("select * from sso_providers where id = $1 limit 1", [providerId]);
    return result.rows[0] ?? null;
  },

  async upsertSsoProvider(input: {
    id?: string;
    tenantId: string;
    providerName: string;
    providerType: SsoProviderSummary["providerType"];
    displayName: string;
    clientId: string;
    clientSecret: string;
    issuerUrl?: string;
    jwksUri?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    userinfoEndpoint?: string;
    entityId?: string;
    ssoUrl?: string;
    sloUrl?: string;
    x509Cert?: string;
    nameIdFormat?: string;
    scopes: string;
    enabled: boolean;
  }) {
    const result = await pool.query(
      `insert into sso_providers
       (id, tenant_id, provider_name, provider_type, display_name, client_id, client_secret, issuer_url,
        jwks_uri, authorization_endpoint, token_endpoint, userinfo_endpoint, entity_id, sso_url, slo_url, x509_cert,
        name_id_format, scopes, enabled, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now())
       on conflict (tenant_id, provider_name)
       do update set
         provider_type = excluded.provider_type,
         display_name = excluded.display_name,
         client_id = excluded.client_id,
         client_secret = case
           when excluded.client_secret = '' then sso_providers.client_secret
           else excluded.client_secret
         end,
         issuer_url = excluded.issuer_url,
         jwks_uri = excluded.jwks_uri,
         authorization_endpoint = excluded.authorization_endpoint,
         token_endpoint = excluded.token_endpoint,
         userinfo_endpoint = excluded.userinfo_endpoint,
         entity_id = excluded.entity_id,
         sso_url = excluded.sso_url,
         slo_url = excluded.slo_url,
         x509_cert = excluded.x509_cert,
         name_id_format = excluded.name_id_format,
         scopes = excluded.scopes,
         enabled = excluded.enabled,
         updated_at = now()
      returning *`,
      [
        input.id ?? input.providerName,
        input.tenantId,
        input.providerName,
        input.providerType,
        input.displayName,
        input.clientId,
        input.clientSecret,
        input.issuerUrl ?? null,
        input.jwksUri ?? null,
        input.authorizationEndpoint ?? null,
        input.tokenEndpoint ?? null,
        input.userinfoEndpoint ?? null,
        input.entityId ?? null,
        input.ssoUrl ?? null,
        input.sloUrl ?? null,
        input.x509Cert ?? null,
        input.nameIdFormat ?? null,
        input.scopes,
        input.enabled
      ]
    );

    return mapSsoProvider(result.rows[0]);
  },

  async createSsoAuthState(input: {
    id: string;
    tenantId: string;
    providerId: string;
    stateHash: string;
    nonce: string;
    codeVerifier: string;
    redirectPath?: string;
  }) {
    await pool.query(
      `insert into sso_auth_states
       (id, tenant_id, provider_id, state_hash, nonce, code_verifier, redirect_path, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, now() + interval '15 minutes')`,
      [
        input.id,
        input.tenantId,
        input.providerId,
        input.stateHash,
        input.nonce,
        input.codeVerifier,
        input.redirectPath ?? null
      ]
    );
  },

  async consumeSsoAuthState(stateHash: string) {
    const result = await pool.query(
      `update sso_auth_states
       set consumed_at = now()
       where state_hash = $1 and consumed_at is null and expires_at > now()
       returning *`,
      [stateHash]
    );

    return result.rows[0] ?? null;
  },

  async createAuthExchange(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    codeHash: string;
    authMethod: string;
    federationProtocol?: "oidc" | "saml";
    identityProvider?: string;
  }) {
    await pool.query(
      `insert into auth_exchanges
       (id, tenant_id, attorney_id, code_hash, auth_method, federation_protocol, identity_provider, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, now() + interval '5 minutes')`,
      [
        input.id,
        input.tenantId,
        input.attorneyId,
        input.codeHash,
        input.authMethod,
        input.federationProtocol ?? null,
        input.identityProvider ?? null
      ]
    );
  },

  async consumeAuthExchange(codeHash: string) {
    const result = await pool.query(
      `update auth_exchanges
       set consumed_at = now()
       where code_hash = $1 and consumed_at is null and expires_at > now()
       returning *`,
      [codeHash]
    );

    return result.rows[0] ?? null;
  },

  async upsertMfaEnrollment(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    secret: string;
    recoveryCodeHashes: string[];
  }) {
    const result = await pool.query(
      `insert into mfa_enrollments
       (id, tenant_id, attorney_id, secret, recovery_code_hashes, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, now() + interval '30 minutes')
       on conflict (attorney_id)
       do update set
         secret = excluded.secret,
         recovery_code_hashes = excluded.recovery_code_hashes,
         expires_at = now() + interval '30 minutes',
         created_at = now()
       returning *`,
      [input.id, input.tenantId, input.attorneyId, input.secret, JSON.stringify(input.recoveryCodeHashes)]
    );

    return result.rows[0] ?? null;
  },

  async getMfaEnrollment(attorneyId: string) {
    const result = await pool.query(
      `select * from mfa_enrollments
       where attorney_id = $1 and expires_at > now()
       limit 1`,
      [attorneyId]
    );

    return result.rows[0] ?? null;
  },

  async deleteMfaEnrollment(attorneyId: string) {
    await pool.query("delete from mfa_enrollments where attorney_id = $1", [attorneyId]);
  },

  async enableAttorneyMfa(input: {
    attorneyId: string;
    secret: string;
    recoveryCodeHashes: string[];
  }) {
    await pool.query(
      `update attorneys
       set mfa_enabled = true,
           mfa_secret = $2,
           mfa_recovery_codes = $3::jsonb,
           mfa_enabled_at = now()
       where id = $1`,
      [input.attorneyId, input.secret, JSON.stringify(input.recoveryCodeHashes)]
    );
  },

  async disableAttorneyMfa(attorneyId: string) {
    await pool.query(
      `update attorneys
       set mfa_enabled = false,
           mfa_secret = null,
           mfa_recovery_codes = '[]'::jsonb,
           mfa_enabled_at = null
       where id = $1`,
      [attorneyId]
    );
  },

  async updateAttorneyRecoveryCodes(attorneyId: string, recoveryCodeHashes: string[]) {
    await pool.query(
      `update attorneys
       set mfa_recovery_codes = $2::jsonb
       where id = $1`,
      [attorneyId, JSON.stringify(recoveryCodeHashes)]
    );
  },

  async createMfaChallenge(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    challengeHash: string;
    authMethod: string;
  }) {
    await pool.query(
      `insert into mfa_challenges
       (id, tenant_id, attorney_id, challenge_hash, auth_method, expires_at)
       values ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
      [input.id, input.tenantId, input.attorneyId, input.challengeHash, input.authMethod]
    );
  },

  async getMfaChallenge(challengeHash: string) {
    const result = await pool.query(
      `select * from mfa_challenges
       where challenge_hash = $1 and consumed_at is null and expires_at > now()
       limit 1`,
      [challengeHash]
    );

    return result.rows[0] ?? null;
  },

  async consumeMfaChallenge(challengeId: string) {
    await pool.query(
      `update mfa_challenges
       set consumed_at = now()
       where id = $1`,
      [challengeId]
    );
  },

  async listWebauthnCredentials(attorneyId: string) {
    const result = await pool.query(
      `select * from webauthn_credentials
       where attorney_id = $1
       order by created_at desc`,
      [attorneyId]
    );

    return result.rows.map(mapPasskey);
  },

  async getWebauthnCredentialByCredentialId(credentialId: string) {
    const result = await pool.query(
      `select * from webauthn_credentials
       where credential_id = $1
       limit 1`,
      [credentialId]
    );

    return result.rows[0] ?? null;
  },

  async createWebauthnCredential(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    deviceType: string;
    backedUp: boolean;
    transports: string[];
    label?: string;
  }) {
    const result = await pool.query(
      `insert into webauthn_credentials
       (id, tenant_id, attorney_id, credential_id, public_key, counter, device_type, backed_up, transports, label)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       returning *`,
      [
        input.id,
        input.tenantId,
        input.attorneyId,
        input.credentialId,
        input.publicKey,
        input.counter,
        input.deviceType,
        input.backedUp,
        JSON.stringify(input.transports),
        input.label ?? null
      ]
    );

    return mapPasskey(result.rows[0]);
  },

  async updateWebauthnCredential(input: {
    credentialId: string;
    counter: number;
    backedUp: boolean;
    transports: string[];
  }) {
    await pool.query(
      `update webauthn_credentials
       set counter = $2,
           backed_up = $3,
           transports = $4::jsonb,
           last_used_at = now()
       where credential_id = $1`,
      [input.credentialId, input.counter, input.backedUp, JSON.stringify(input.transports)]
    );
  },

  async deleteWebauthnCredential(attorneyId: string, credentialRecordId: string) {
    const result = await pool.query(
      `delete from webauthn_credentials
       where attorney_id = $1 and id = $2
       returning *`,
      [attorneyId, credentialRecordId]
    );

    return result.rows[0] ? mapPasskey(result.rows[0]) : undefined;
  },

  async createWebauthnChallenge(input: {
    id: string;
    tenantId: string;
    attorneyId: string;
    challengeValue: string;
    challengeType: string;
    linkedMfaChallengeId?: string;
    label?: string;
  }) {
    const result = await pool.query(
      `insert into webauthn_challenges
       (id, tenant_id, attorney_id, challenge_value, challenge_type, linked_mfa_challenge_id, label, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, now() + interval '10 minutes')
       returning *`,
      [
        input.id,
        input.tenantId,
        input.attorneyId,
        input.challengeValue,
        input.challengeType,
        input.linkedMfaChallengeId ?? null,
        input.label ?? null
      ]
    );

    return result.rows[0] ?? null;
  },

  async getWebauthnChallenge(challengeId: string) {
    const result = await pool.query(
      `select * from webauthn_challenges
       where id = $1 and consumed_at is null and expires_at > now()
       limit 1`,
      [challengeId]
    );

    return result.rows[0] ?? null;
  },

  async consumeWebauthnChallenge(challengeId: string) {
    const result = await pool.query(
      `update webauthn_challenges
       set consumed_at = now()
       where id = $1 and consumed_at is null and expires_at > now()
       returning *`,
      [challengeId]
    );

    return result.rows[0] ?? null;
  },

  async createSamlRelayState(input: {
    id: string;
    tenantId: string;
    providerId: string;
    relayStateHash: string;
    redirectPath?: string;
  }) {
    await pool.query(
      `insert into saml_relay_states
       (id, tenant_id, provider_id, relay_state_hash, redirect_path, expires_at)
       values ($1, $2, $3, $4, $5, now() + interval '15 minutes')`,
      [input.id, input.tenantId, input.providerId, input.relayStateHash, input.redirectPath ?? null]
    );
  },

  async consumeSamlRelayState(relayStateHash: string) {
    const result = await pool.query(
      `update saml_relay_states
       set consumed_at = now()
       where relay_state_hash = $1 and consumed_at is null and expires_at > now()
       returning *`,
      [relayStateHash]
    );

    return result.rows[0] ?? null;
  },

  async upsertSamlLoginSession(input: {
    id: string;
    tenantId: string;
    providerId: string;
    attorneyId: string;
    nameId: string;
    nameIdFormat?: string;
    sessionIndex?: string;
  }) {
    await pool.query(
      `insert into saml_login_sessions
       (id, tenant_id, provider_id, attorney_id, name_id, name_id_format, session_index, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (provider_id, attorney_id)
       do update set
         name_id = excluded.name_id,
         name_id_format = excluded.name_id_format,
         session_index = excluded.session_index,
         updated_at = now()`,
      [
        input.id,
        input.tenantId,
        input.providerId,
        input.attorneyId,
        input.nameId,
        input.nameIdFormat ?? null,
        input.sessionIndex ?? null
      ]
    );
  },

  async getLatestSamlLoginSession(attorneyId: string, providerId?: string) {
    const values: string[] = [attorneyId];
    let whereClause = "where attorney_id = $1";

    if (providerId) {
      values.push(providerId);
      whereClause += ` and provider_id = $${values.length}`;
    }

    const result = await pool.query(
      `select * from saml_login_sessions
       ${whereClause}
       order by updated_at desc
       limit 1`,
      values
    );

    return result.rows[0] ?? null;
  },

  async createSamlLogoutState(input: {
    id: string;
    tenantId: string;
    providerId: string;
    attorneyId?: string;
    relayStateHash: string;
    redirectPath?: string;
  }) {
    await pool.query(
      `insert into saml_logout_states
       (id, tenant_id, provider_id, attorney_id, relay_state_hash, redirect_path, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + interval '15 minutes')`,
      [
        input.id,
        input.tenantId,
        input.providerId,
        input.attorneyId ?? null,
        input.relayStateHash,
        input.redirectPath ?? null
      ]
    );
  },

  async consumeSamlLogoutState(relayStateHash: string) {
    const result = await pool.query(
      `update saml_logout_states
       set consumed_at = now()
       where relay_state_hash = $1 and consumed_at is null and expires_at > now()
       returning *`,
      [relayStateHash]
    );

    return result.rows[0] ?? null;
  },

  async listScimGroups(input: { tenantId: string; startIndex: number; count: number; displayName?: string }) {
    const offset = Math.max(input.startIndex - 1, 0);
    const values: Array<string | number> = [input.tenantId];
    let whereClause = "where tenant_id = $1";

    if (input.displayName) {
      values.push(input.displayName);
      whereClause += ` and lower(display_name) = lower($${values.length})`;
    }

    const totalResult = await pool.query<{ count: string }>(
      `select count(*)::text as count from scim_groups ${whereClause}`,
      values
    );

    values.push(input.count);
    values.push(offset);
    const result = await pool.query(
      `select * from scim_groups
       ${whereClause}
       order by created_at asc
       limit $${values.length - 1} offset $${values.length}`,
      values
    );

    return {
      totalResults: Number(totalResult.rows[0]?.count ?? "0"),
      groups: result.rows
    };
  },

  async getScimGroup(groupId: string, tenantId: string) {
    const result = await pool.query(
      `select * from scim_groups
       where id = $1 and tenant_id = $2
       limit 1`,
      [groupId, tenantId]
    );

    return result.rows[0] ?? null;
  },

  async listScimGroupMembers(groupId: string) {
    const result = await pool.query(
      `select a.id, a.email, a.full_name
       from scim_group_members gm
       join attorneys a on a.id = gm.attorney_id
       where gm.group_id = $1
       order by a.full_name asc`,
      [groupId]
    );

    return result.rows;
  },

  async createScimGroup(input: {
    id: string;
    tenantId: string;
    displayName: string;
    description?: string;
    externalId?: string;
  }) {
    const result = await pool.query(
      `insert into scim_groups
       (id, tenant_id, display_name, description, external_id, updated_at)
       values ($1, $2, $3, $4, $5, now())
       returning *`,
      [input.id, input.tenantId, input.displayName, input.description ?? null, input.externalId ?? null]
    );

    return result.rows[0] ?? null;
  },

  async updateScimGroup(input: {
    groupId: string;
    tenantId: string;
    displayName: string;
    description?: string;
    externalId?: string;
  }) {
    const result = await pool.query(
      `update scim_groups
       set display_name = $3,
           description = $4,
           external_id = $5,
           updated_at = now()
       where id = $1 and tenant_id = $2
       returning *`,
      [input.groupId, input.tenantId, input.displayName, input.description ?? null, input.externalId ?? null]
    );

    return result.rows[0] ?? null;
  },

  async replaceScimGroupMembers(groupId: string, tenantId: string, attorneyIds: string[]) {
    await pool.query("delete from scim_group_members where group_id = $1", [groupId]);

    for (const attorneyId of attorneyIds) {
      await pool.query(
        `insert into scim_group_members (group_id, attorney_id)
         select $1, $2
         where exists (
           select 1 from attorneys where id = $2 and tenant_id = $3
         )`,
        [groupId, attorneyId, tenantId]
      );
    }
  },

  async addScimGroupMembers(groupId: string, tenantId: string, attorneyIds: string[]) {
    for (const attorneyId of attorneyIds) {
      await pool.query(
        `insert into scim_group_members (group_id, attorney_id)
         select $1, $2
         where exists (
           select 1 from attorneys where id = $2 and tenant_id = $3
         )
         on conflict do nothing`,
        [groupId, attorneyId, tenantId]
      );
    }
  },

  async removeScimGroupMembers(groupId: string, attorneyIds: string[]) {
    for (const attorneyId of attorneyIds) {
      await pool.query(
        `delete from scim_group_members
         where group_id = $1 and attorney_id = $2`,
        [groupId, attorneyId]
      );
    }
  },

  async deleteScimGroup(groupId: string, tenantId: string) {
    const result = await pool.query(
      `delete from scim_groups
       where id = $1 and tenant_id = $2
       returning *`,
      [groupId, tenantId]
    );

    return result.rows[0] ?? null;
  },

  async saveSamlRequest(requestId: string, requestValue: string) {
    const result = await pool.query(
      `insert into saml_request_cache
       (request_id, request_value, expires_at)
       values ($1, $2, now() + interval '15 minutes')
       on conflict (request_id)
       do update set
         request_value = excluded.request_value,
         expires_at = excluded.expires_at,
         created_at = now()
       returning request_value`,
      [requestId, requestValue]
    );

    return result.rows[0]?.request_value ? String(result.rows[0].request_value) : null;
  },

  async getSamlRequest(requestId: string) {
    const result = await pool.query(
      `select request_value from saml_request_cache
       where request_id = $1 and expires_at > now()
       limit 1`,
      [requestId]
    );

    return result.rows[0]?.request_value ? String(result.rows[0].request_value) : null;
  },

  async consumeSamlRequest(requestId: string | null) {
    if (!requestId) {
      return null;
    }

    const result = await pool.query(
      `delete from saml_request_cache
       where request_id = $1
       returning request_value`,
      [requestId]
    );

    return result.rows[0]?.request_value ? String(result.rows[0].request_value) : null;
  },

  async addDocument(document: DocumentRecord) {
    await pool.query(
      `insert into documents
       (id, tenant_id, matter_id, source_name, file_uri, sha256, mime_type, doc_type, ingestion_status, security_status,
        security_reason, normalized_text, privilege_score, relevance_score, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
      [
        document.id,
        document.tenantId,
        document.matterId,
        document.sourceName,
        document.storagePath ?? "",
        document.sha256 ?? `sha-${document.id}`,
        document.mimeType,
        document.docType,
        document.ingestionStatus,
        document.securityStatus,
        document.securityReason ?? null,
        document.normalizedText,
        document.privilegeScore,
        document.relevanceScore
      ]
    );
    return document;
  },

  async updateDocument(documentId: string, tenantId: string, updater: (document: DocumentRecord) => DocumentRecord) {
    // Always validate tenant for defense in depth
    const current = await this.getDocumentForTenant(documentId, tenantId);
    if (!current) {
      return undefined;
    }

    const next = updater(current);

    await pool.query(
      `update documents
       set ingestion_status = $2,
           normalized_text = $3,
           privilege_score = $4,
           relevance_score = $5,
           file_uri = $6,
           security_status = $7,
           security_reason = $8,
           scan_completed_at = case
             when $7 in ('clean', 'quarantined') then now()
             else scan_completed_at
           end
       where id = $1`,
      [
        documentId,
        next.ingestionStatus,
        next.normalizedText,
        next.privilegeScore,
        next.relevanceScore,
        next.storagePath ?? "",
        next.securityStatus,
        next.securityReason ?? null
      ]
    );

    await pool.query("delete from document_chunks where document_id = $1", [documentId]);
    if (next.embedding?.length) {
      await pool.query(
        `insert into document_chunks
         (id, tenant_id, document_id, page_from, page_to, chunk_index, text_content, citation_json, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::float8[])`,
        [
          `${documentId}-chunk-1`,
          next.tenantId,
          documentId,
          1,
          1,
          0,
          next.normalizedText.slice(0, 10000),
          JSON.stringify({ source: next.sourceName }),
          next.embedding
        ]
      );
    }

    return next;
  },

  async getDocument(documentId: string) {
    const result = await pool.query("select * from documents where id = $1 limit 1", [documentId]);
    return result.rows[0] ? mapDocument(result.rows[0]) : undefined;
  },

  async getDocumentForTenant(documentId: string, tenantId: string) {
    const result = await pool.query(
      "select * from documents where id = $1 and tenant_id = $2 limit 1",
      [documentId, tenantId]
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : undefined;
  },

  async getDocumentByShaForTenant(tenantId: string, sha256: string) {
    const result = await pool.query(
      "select * from documents where tenant_id = $1 and sha256 = $2 limit 1",
      [tenantId, sha256]
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : undefined;
  },

  async getMatterForTenant(matterId: string, tenantId: string) {
    const result = await pool.query("select * from matters where id = $1 and tenant_id = $2 limit 1", [
      matterId,
      tenantId
    ]);
    return result.rows[0] ? mapMatter(result.rows[0]) : undefined;
  },

  async replaceClauses(documentId: string, clauses: ClauseRecord[], tenantId: string) {
    // Verify document belongs to tenant before modifying clauses
    const document = await this.getDocumentForTenant(documentId, tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    await pool.query("delete from clauses where document_id = $1 and tenant_id = $2", [documentId, tenantId]);

    // Batch insert for better performance
    if (clauses.length > 0) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const clause of clauses) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10})`);
        values.push(
          clause.id,
          tenantId,
          documentId,
          clause.clauseType,
          clause.heading,
          clause.textExcerpt,
          clause.pageFrom,
          clause.pageTo,
          clause.riskLevel,
          clause.confidence,
          clause.reviewerStatus
        );
        paramIndex += 11;
      }

      await pool.query(
        `insert into clauses
         (id, tenant_id, document_id, clause_type, heading, text_excerpt, page_from, page_to, risk_level, confidence, reviewer_status)
         values ${placeholders.join(", ")}`,
        values
      );
    }
  },

  async getClausesByDocument(documentId: string, tenantId: string, limit = 1000) {
    const result = await pool.query(
      "select * from clauses where document_id = $1 and tenant_id = $2 order by created_at desc limit $3", 
      [documentId, tenantId, limit]
    );
    return result.rows.map(mapClause);
  },

  async addFlags(flags: FlagRecord[], tenantId: string) {
    for (const flag of flags) {
      await pool.query(
        `insert into flags
         (id, tenant_id, matter_id, document_id, clause_id, flag_type, severity, reason, confidence, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          flag.id,
          tenantId,
          flag.matterId,
          flag.documentId,
          flag.clauseId ?? null,
          flag.flagType,
          flag.severity,
          flag.reason,
          flag.confidence,
          flag.status
        ]
      );
    }
  },

  async getFlagById(flagId: string, tenantId: string) {
    const result = await pool.query(
      "select * from flags where id = $1 and tenant_id = $2 limit 1",
      [flagId, tenantId]
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : undefined;
  },

  async resolveFlag(flagId: string, tenantId: string) {
    const result = await pool.query(
      "update flags set status = 'resolved', resolved_at = now() where id = $1 and tenant_id = $2 returning *",
      [flagId, tenantId]
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : undefined;
  },

  async updateFlagStatus(flagId: string, tenantId: string, status: "approved" | "rejected") {
    const result = await pool.query(
      "update flags set status = $3, resolved_at = now() where id = $1 and tenant_id = $2 returning *",
      [flagId, tenantId, status]
    );
    return result.rows[0] ? mapFlag(result.rows[0]) : undefined;
  },

  async getMatterDocuments(matterId: string, tenantId: string) {
    const result = await pool.query(
      "select * from documents where matter_id = $1 and tenant_id = $2 order by created_at desc limit 500",
      [matterId, tenantId]
    );
    return result.rows.map(mapDocument);
  },

  // TODO: Issue #10 — When pgvector extension is available, replace this with a
  // proper vector similarity search using the <=> operator:
  //   SELECT d.*, c.embedding <=> $2::vector AS distance
  //   FROM documents d JOIN document_chunks c ON ...
  //   WHERE d.tenant_id = $1
  //   ORDER BY distance ASC LIMIT 20
  async getDocumentEmbeddings(tenantId: string, options?: { limit?: number }) {
    // Default to 100 documents max for embedding search to avoid memory issues
    const limit = Math.min(options?.limit ?? 100, 500);
    const result = await pool.query(
      `select d.*, c.embedding
       from documents d
       left join document_chunks c on c.document_id = d.id and c.chunk_index = 0
       where d.tenant_id = $1
       order by d.created_at desc
       limit $2`,
      [tenantId, limit]
    );

    return result.rows.map((row) => ({
      ...mapDocument(row),
      embedding: Array.isArray(row.embedding) ? row.embedding.map(Number) : []
    }));
  },

  async recordResearch(_: ResearchResponse) {
    return true;
  },

  async createWorkflowJob(input: {
    id: string;
    tenantId: string;
    jobType: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }) {
    await pool.query(
      `insert into workflow_jobs (id, tenant_id, job_type, payload, status, max_attempts)
       values ($1, $2, $3, $4::jsonb, 'queued', $5)`,
      [input.id, input.tenantId, input.jobType, JSON.stringify(input.payload), input.maxAttempts ?? 5]
    );
  },

  async claimWorkflowJobs(workerId: string, limit = 10) {
    const result = await pool.query(
      `update workflow_jobs
       set status = 'processing',
           locked_at = now(),
           locked_by = $1,
           attempts = attempts + 1,
           updated_at = now()
       where id in (
         select id
         from workflow_jobs
         where status = 'queued'
           and available_at <= now()
         order by created_at asc
         limit $2
         for update skip locked
       )
       returning *`,
      [workerId, limit]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      jobType: String(row.job_type),
      payload: row.payload as Record<string, unknown>,
      attempts: Number(row.attempts ?? 0),
      maxAttempts: Number(row.max_attempts ?? 0)
    }));
  },

  async completeWorkflowJob(jobId: string) {
    await pool.query(
      `update workflow_jobs
       set status = 'completed', updated_at = now(), locked_at = null, locked_by = null
       where id = $1`,
      [jobId]
    );
  },

  async failWorkflowJob(jobId: string, error: string, maxAttempts: number) {
    const job = await pool.query("select attempts from workflow_jobs where id = $1 limit 1", [jobId]);
    const attempts = Number(job.rows[0]?.attempts ?? 0);
    const finalFailure = attempts >= maxAttempts;

    await pool.query(
      `update workflow_jobs
       set status = case when attempts >= $3 then 'failed' else 'queued' end,
           last_error = $2,
           updated_at = now(),
           available_at = case when attempts >= $3 then available_at else now() + interval '30 seconds' end,
           locked_at = null,
           locked_by = null
       where id = $1`,
      [jobId, error.slice(0, 2000), maxAttempts]
    );

    return finalFailure;
  },

  /**
   * Recover jobs that have been stuck in processing state for too long.
   * Returns the number of jobs recovered.
   */
  async recoverStuckWorkflowJobs(timeoutMs: number) {
    const result = await pool.query(
      `update workflow_jobs
       set status = 'queued',
           locked_at = null,
           locked_by = null,
           last_error = 'Job timed out and was recovered',
           updated_at = now(),
           available_at = now()
       where status = 'processing'
         and locked_at < now() - ($1 || ' milliseconds')::interval
       returning id`,
      [timeoutMs]
    );
    
    return result.rowCount ?? 0;
  },

  async recordAuditEvent(input: {
    id: string;
    tenantId: string;
    actorAttorneyId?: string;
    eventType: string;
    objectType: string;
    objectId: string;
    metadata?: Record<string, unknown>;
  }) {
    await pool.query(
      `insert into audit_events
       (id, tenant_id, actor_attorney_id, event_type, object_type, object_id, metadata)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.id,
        input.tenantId,
        input.actorAttorneyId ?? null,
        input.eventType,
        input.objectType,
        input.objectId,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }
};
