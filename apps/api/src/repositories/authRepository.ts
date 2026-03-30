import type { AuthSession, SsoProviderSummary } from "@legal-agent/shared";
import { pool } from "../database.js";
import { mapAttorney, mapPasskey, mapSsoProvider } from "./mappers.js";

export const authRepository = {
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

  async updateAttorneyPassword(attorneyId: string, passwordHash: string) {
    await pool.query(
      `update attorneys
       set password_hash = $2, can_login = true
       where id = $1`,
      [attorneyId, passwordHash]
    );
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

  // SSO Providers
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

  // SSO Auth State
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

  // MFA
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

  // WebAuthn / Passkeys
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

  // SAML
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
  }
};
