import type { AuthSession, DocumentRecord, LoginResponse, MfaMethod } from "@legal-agent/shared";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { createAccessToken } from "../auth.js";
import { config } from "../config.js";
import { repository } from "../repository.js";
import { decryptSecret, generateOpaqueToken, hashApiKey, hashPassword } from "../security.js";

// Region-specific playbook rules - re-export from helpers for backward compatibility
export { defaultPlaybook, playbooksByRegion, getPlaybookForJurisdiction } from "./helpers.js";

export function ensureTenant<T extends { tenantId?: string }>(entity: T, tenantId: string) {
  return { ...entity, tenantId } as T & { tenantId: string };
}

export function sanitizeDocumentForResponse(doc: DocumentRecord): Omit<DocumentRecord, "storagePath"> {
  const { storagePath, ...sanitized } = doc;
  return sanitized;
}

export function toProviderConfig(provider: Record<string, unknown>) {
  return {
    providerName: String(provider.provider_name ?? provider.providerName),
    displayName: String(provider.display_name ?? provider.displayName),
    clientId: String(provider.client_id ?? provider.clientId),
    clientSecret: decryptSecret(String(provider.client_secret ?? "")),
    issuerUrl: provider.issuer_url ? String(provider.issuer_url) : provider.issuerUrl ? String(provider.issuerUrl) : undefined,
    jwksUri: provider.jwks_uri ? String(provider.jwks_uri) : provider.jwksUri ? String(provider.jwksUri) : undefined,
    authorizationEndpoint: provider.authorization_endpoint
      ? String(provider.authorization_endpoint)
      : provider.authorizationEndpoint
        ? String(provider.authorizationEndpoint)
        : undefined,
    tokenEndpoint: provider.token_endpoint
      ? String(provider.token_endpoint)
      : provider.tokenEndpoint
        ? String(provider.tokenEndpoint)
        : undefined,
    userinfoEndpoint: provider.userinfo_endpoint
      ? String(provider.userinfo_endpoint)
      : provider.userinfoEndpoint
        ? String(provider.userinfoEndpoint)
        : undefined,
    scopes: String(provider.scopes),
    enabled: Boolean(provider.enabled)
  };
}

export function toSamlProviderConfig(provider: Record<string, unknown>) {
  return {
    tenantId: String(provider.tenant_id),
    providerName: String(provider.provider_name ?? provider.providerName),
    displayName: String(provider.display_name ?? provider.displayName),
    entityId: provider.entity_id ? String(provider.entity_id) : provider.entityId ? String(provider.entityId) : undefined,
    ssoUrl: provider.sso_url ? String(provider.sso_url) : provider.ssoUrl ? String(provider.ssoUrl) : undefined,
    logoutUrl: provider.slo_url ? String(provider.slo_url) : provider.sloUrl ? String(provider.sloUrl) : undefined,
    x509Cert: provider.x509_cert ? String(provider.x509_cert) : provider.x509Cert ? String(provider.x509Cert) : undefined,
    nameIdFormat: provider.name_id_format
      ? String(provider.name_id_format)
      : provider.nameIdFormat
        ? String(provider.nameIdFormat)
        : undefined
  };
}

export function normalizeRedirectPath(redirectPath?: string | null) {
  if (!redirectPath || !redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
    return "/";
  }

  return redirectPath;
}

export function buildWebRedirectUrl(redirectPath: string | null | undefined, params: Record<string, string>) {
  const redirectUrl = new URL(normalizeRedirectPath(redirectPath), config.webAppUrl);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return redirectUrl.toString();
}

export function getLoginExpirySeconds() {
  return 8 * 60 * 60;
}

export function getTotpForAttorney(email: string, secretBase32: string) {
  return new OTPAuth.TOTP({
    issuer: "Legal Agent",
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30
  });
}

export function getRecoveryCodeHashes(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((value) => String(value));
}

export async function getAvailableMfaMethods(attorneyId: string): Promise<MfaMethod[]> {
  const [attorneySecurity, passkeys] = await Promise.all([
    repository.getAttorneySecurity(attorneyId),
    repository.listWebauthnCredentials(attorneyId)
  ]);
  const methods: MfaMethod[] = [];

  if (Boolean(attorneySecurity?.mfa_enabled) && attorneySecurity?.mfa_secret) {
    methods.push("totp");
    if (getRecoveryCodeHashes(attorneySecurity.mfa_recovery_codes).length > 0) {
      methods.push("recovery_code");
    }
  }

  if (passkeys.length > 0) {
    methods.push("webauthn");
  }

  return methods;
}

export function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      givenName: parts[0] ?? fullName,
      familyName: ""
    };
  }

  return {
    givenName: parts.slice(0, -1).join(" "),
    familyName: parts.at(-1) ?? ""
  };
}

export function buildScimUserFromRow(row: Record<string, unknown>) {
  const fullName = String(row.full_name ?? row.email ?? "");
  const name = splitFullName(fullName);

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: String(row.id),
    externalId: String(row.id),
    userName: String(row.email),
    active: Boolean(row.is_active) && Boolean(row.can_login),
    name: {
      formatted: fullName,
      givenName: name.givenName,
      familyName: name.familyName
    },
    displayName: fullName,
    emails: [
      {
        value: String(row.email),
        primary: true
      }
    ],
    title: String(row.role ?? ""),
    meta: {
      resourceType: "User",
      created: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
      lastModified: row.last_login_at
        ? new Date(String(row.last_login_at)).toISOString()
        : row.created_at
          ? new Date(String(row.created_at)).toISOString()
          : undefined
    }
  };
}

export async function buildScimGroupFromRow(row: Record<string, unknown>) {
  const tenantId = String(row.tenant_id);
  const members = await repository.listScimGroupMembers(String(row.id), tenantId);
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: String(row.id),
    displayName: String(row.display_name),
    externalId: row.external_id ? String(row.external_id) : undefined,
    members: members.map((member) => ({
      value: String(member.id),
      display: String(member.full_name ?? member.email ?? member.id)
    })),
    meta: {
      resourceType: "Group",
      created: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
      lastModified: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined
    }
  };
}

export function buildLoginSuccessResponse(session: AuthSession, mustResetPassword?: boolean): LoginResponse {
  return {
    mfaRequired: false,
    accessToken: createAccessToken(session),
    expiresInSeconds: getLoginExpirySeconds(),
    session,
    mustResetPassword
  };
}

export async function buildMfaChallengeResponse(session: AuthSession, authMethod: string): Promise<LoginResponse> {
  const availableMethods = await getAvailableMfaMethods(session.attorneyId);
  if (availableMethods.length === 0) {
    throw new Error("MFA challenge requested without any enrolled factors.");
  }

  const rawChallenge = generateOpaqueToken("mfa");
  await repository.createMfaChallenge({
    id: randomUUID(),
    tenantId: session.tenantId,
    attorneyId: session.attorneyId,
    challengeHash: hashApiKey(rawChallenge),
    authMethod
  });

  return {
    mfaRequired: true,
    challengeToken: rawChallenge,
    expiresInSeconds: 10 * 60,
    session,
    availableMethods
  };
}

export async function resolveAttorneyForFederatedIdentity(input: {
  tenantId: string;
  email: string;
  fullName: string;
}) {
  let attorney = await repository.getAttorneyByEmailForTenant(input.tenantId, input.email);
  let acceptedInvitationId: string | null = null;

  if (!attorney) {
    const invitation = await repository.getPendingInvitationByEmail(input.tenantId, input.email);
    if (!invitation) {
      throw new Error("No attorney account or pending invitation exists for this SSO identity.");
    }

    attorney = await repository.createAttorney({
      id: randomUUID(),
      tenantId: input.tenantId,
      email: input.email,
      fullName: input.fullName,
      role: invitation.role as AuthSession["role"],
      practiceArea: String(invitation.practice_area),
      passwordHash: await hashPassword(generateOpaqueToken("pwd")),
      isTenantAdmin: Boolean(invitation.is_tenant_admin)
    });
    await repository.markInvitationAccepted(String(invitation.id));
    acceptedInvitationId = String(invitation.id);
  }

  return { attorney, acceptedInvitationId };
}

export async function buildFederatedRedirect(input: {
  tenantId: string;
  attorneyId: string;
  redirectPath?: string | null;
  providerName: string;
  authMethod: "oidc" | "saml";
}) {
  const session = await repository.getAttorneySession(input.attorneyId);
  if (!session) {
    throw new Error("Unable to create session.");
  }

  const availableMfaMethods = await getAvailableMfaMethods(input.attorneyId);
  if (availableMfaMethods.length > 0) {
    const mfaChallenge = await buildMfaChallengeResponse(session, input.authMethod);
    if (!mfaChallenge.mfaRequired) {
      throw new Error("Expected MFA challenge response.");
    }

    return {
      redirectUrl: buildWebRedirectUrl(input.redirectPath, {
        mfaChallenge: mfaChallenge.challengeToken
      })
    };
  }

  await repository.markAttorneyLoggedIn(input.attorneyId);
  await repository.recordAuditEvent({
    id: randomUUID(),
    tenantId: input.tenantId,
    actorAttorneyId: input.attorneyId,
    eventType: "auth.sso_login",
    objectType: "attorney",
    objectId: input.attorneyId,
    metadata: {
      providerName: input.providerName,
      authMethod: input.authMethod
    }
  });

  const exchangeCode = generateOpaqueToken("exchange");
  await repository.createAuthExchange({
    id: randomUUID(),
    tenantId: input.tenantId,
    attorneyId: input.attorneyId,
    codeHash: hashApiKey(exchangeCode),
    authMethod: input.authMethod,
    federationProtocol: input.authMethod,
    identityProvider: input.providerName
  });

  return {
    redirectUrl: buildWebRedirectUrl(input.redirectPath, {
      authExchange: exchangeCode
    })
  };
}
