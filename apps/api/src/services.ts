import type {
  ApiKeySummary,
  AuthSession,
  ClauseExtractionRequest,
  ClauseRecord,
  DocumentRecord,
  FlagRecord,
  InvitationSummary,
  LoginResponse,
  MfaMethod,
  MfaSetupResponse,
  MfaStatus,
  PasskeySummary,
  ResearchResponse,
  RiskAssessmentRequest,
  ScimTokenSummary,
  SsoProviderSummary
} from "@legal-agent/shared";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from "@simplewebauthn/server";
import { createHash, randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { createAccessToken } from "./auth.js";
import { sendInvitationEmail, sendPasswordResetEmail } from "./email.js";
import {
  answerResearchWithOpenAI,
  assessRiskWithOpenAI,
  embedTextWithOpenAI,
  extractClausesWithOpenAI
} from "./openaiClient.js";
import {
  buildClauseExtractionPrompt,
  buildResearchPrompt,
  buildRiskPrompt,
  clauseExtractionSystemPrompt
} from "./prompts.js";
import { repository } from "./repository.js";
import {
  buildSamlAuthorizeUrl,
  buildSamlLogoutResponseUrl,
  buildSamlLogoutUrl,
  generateSamlMetadata,
  validateSamlPostResponse,
  validateSamlRedirect
} from "./saml.js";
import { buildAuthorizationUrl, exchangeAuthorizationCode, fetchUserInfo, verifyIdToken } from "./sso.js";
import {
  decryptSecret,
  encryptSecret,
  fromBase64Url,
  generateRecoveryCodes,
  generatePkcePair,
  generateOpaqueToken,
  generateRawApiKey,
  getApiKeyPrefix,
  hashApiKey,
  hashRecoveryCode,
  hashPassword,
  toBase64Url,
  verifyPassword
} from "./security.js";
import { cosineSimilarity } from "./vector.js";
import { config } from "./config.js";
import { withTransaction } from "./transaction.js";

const defaultPlaybook = [
  "Indemnity cap must not exceed 20% of purchase price.",
  "Governing law must be Indian law for domestic deals.",
  "Counterparty assignment requires prior written consent.",
  "Confidentiality clauses must survive termination for at least 3 years.",
  "Dispute resolution should prefer arbitration seated in Mumbai."
];

function ensureTenant<T extends { tenantId?: string }>(entity: T, tenantId: string) {
  return { ...entity, tenantId } as T & { tenantId: string };
}

// Sanitize document for API response - remove internal fields
function sanitizeDocumentForResponse(doc: DocumentRecord): Omit<DocumentRecord, 'storagePath'> {
  const { storagePath, ...sanitized } = doc;
  return sanitized;
}

function toProviderConfig(provider: Record<string, unknown>) {
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

function toSamlProviderConfig(provider: Record<string, unknown>) {
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

function normalizeRedirectPath(redirectPath?: string | null) {
  if (!redirectPath || !redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
    return "/";
  }

  return redirectPath;
}

function buildWebRedirectUrl(redirectPath: string | null | undefined, params: Record<string, string>) {
  const redirectUrl = new URL(normalizeRedirectPath(redirectPath), config.webAppUrl);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return redirectUrl.toString();
}

function getLoginExpirySeconds() {
  return 8 * 60 * 60;
}

function getTotpForAttorney(email: string, secretBase32: string) {
  return new OTPAuth.TOTP({
    issuer: "Legal Agent",
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30
  });
}

function getRecoveryCodeHashes(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((value) => String(value));
}

async function getAvailableMfaMethods(attorneyId: string): Promise<MfaMethod[]> {
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

function splitFullName(fullName: string) {
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

function buildScimUserFromRow(row: Record<string, unknown>) {
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

async function buildScimGroupFromRow(row: Record<string, unknown>) {
  const members = await repository.listScimGroupMembers(String(row.id));
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

function buildLoginSuccessResponse(session: AuthSession, mustResetPassword?: boolean): LoginResponse {
  return {
    mfaRequired: false,
    accessToken: createAccessToken(session),
    expiresInSeconds: getLoginExpirySeconds(),
    session,
    mustResetPassword
  };
}

async function buildMfaChallengeResponse(session: AuthSession, authMethod: string): Promise<LoginResponse> {
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

async function resolveAttorneyForFederatedIdentity(input: {
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

async function buildFederatedRedirect(input: {
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

export const legalWorkflowService = {
  async login(input: { email: string; password: string; tenantId: string }): Promise<LoginResponse> {
    if (!input.tenantId) {
      throw new Error("Tenant ID is required for login.");
    }
    const attorney = await repository.getAttorneyForLogin(input.email, input.tenantId);
    
    // Check if account exists first (but don't reveal this to user)
    if (!attorney) {
      throw new Error("Invalid email or password.");
    }
    
    // Check if account is locked
    const lockStatus = await repository.isAccountLocked(String(attorney.id));
    if (lockStatus.locked) {
      const minutesRemaining = lockStatus.lockedUntil 
        ? Math.ceil((lockStatus.lockedUntil.getTime() - Date.now()) / 60000)
        : config.accountLockoutDurationMinutes;
      throw new Error(`Account is temporarily locked. Please try again in ${minutesRemaining} minutes.`);
    }
    
    // Verify password
    if (!(await verifyPassword(input.password, String(attorney.password_hash ?? "")))) {
      // Record failed attempt and potentially lock account
      await repository.recordFailedLoginAttempt(
        String(attorney.id),
        config.accountLockoutThreshold,
        config.accountLockoutDurationMinutes
      );
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: input.tenantId,
        actorAttorneyId: String(attorney.id),
        eventType: "auth.failed_login",
        objectType: "attorney",
        objectId: String(attorney.id)
      });
      throw new Error("Invalid email or password.");
    }

    const session = await repository.getAttorneySession(String(attorney.id));
    if (!session) {
      throw new Error("Unable to create session.");
    }

    const availableMfaMethods = await getAvailableMfaMethods(String(attorney.id));
    if (availableMfaMethods.length > 0) {
      return buildMfaChallengeResponse(session, "password");
    }

    await repository.markAttorneyLoggedIn(String(attorney.id));
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.password_login",
      objectType: "attorney",
      objectId: session.attorneyId
    });

    // Check if password reset is required (direct-created accounts)
    const mustResetPassword = Boolean(attorney.must_reset_password);
    return buildLoginSuccessResponse(session, mustResetPassword);
  },

  async me(session: AuthSession) {
    const freshSession = await repository.getAttorneySession(session.attorneyId);
    if (!freshSession) {
      throw new Error("Session no longer exists.");
    }

    return {
      ...freshSession,
      federationProtocol: session.federationProtocol,
      identityProvider: session.identityProvider
    };
  },

  async verifyMfaChallenge(input: { challengeToken: string; token?: string; recoveryCode?: string }) {
    const challenge = await repository.getMfaChallenge(hashApiKey(input.challengeToken));
    if (!challenge) {
      throw new Error("MFA challenge is invalid or expired.");
    }

    const attorneySecurity = await repository.getAttorneySecurity(String(challenge.attorney_id));
    if (!attorneySecurity || !attorneySecurity.mfa_enabled || !attorneySecurity.mfa_secret) {
      throw new Error("MFA is not enabled for this attorney.");
    }

    let verified = false;
    const recoveryCodeHashes = getRecoveryCodeHashes(attorneySecurity.mfa_recovery_codes);

    if (input.token) {
      const totp = getTotpForAttorney(
        String(attorneySecurity.email ?? ""),
        decryptSecret(String(attorneySecurity.mfa_secret))
      );
      verified = totp.validate({ token: input.token, window: 1 }) !== null;
    } else if (input.recoveryCode) {
      const recoveryHash = hashRecoveryCode(input.recoveryCode);
      const nextHashes = recoveryCodeHashes.filter((value) => value !== recoveryHash);
      verified = nextHashes.length !== recoveryCodeHashes.length;

      if (verified) {
        await repository.updateAttorneyRecoveryCodes(String(challenge.attorney_id), nextHashes);
      }
    }

    if (!verified) {
      throw new Error("The MFA code was invalid.");
    }

    await repository.consumeMfaChallenge(String(challenge.id));

    const session = await repository.getAttorneySession(String(challenge.attorney_id));
    if (!session) {
      throw new Error("Unable to create session.");
    }

    await repository.markAttorneyLoggedIn(session.attorneyId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.mfa_verified",
      objectType: "attorney",
      objectId: session.attorneyId,
      metadata: {
        method: input.token ? "totp" : "recovery_code",
        authMethod: String(challenge.auth_method)
      }
    });

    return buildLoginSuccessResponse(session);
  },

  async getMfaStatus(session: AuthSession): Promise<MfaStatus> {
    const [attorneySecurity, pendingEnrollment, passkeys] = await Promise.all([
      repository.getAttorneySecurity(session.attorneyId),
      repository.getMfaEnrollment(session.attorneyId),
      repository.listWebauthnCredentials(session.attorneyId)
    ]);
    const totpEnabled = Boolean(attorneySecurity?.mfa_enabled && attorneySecurity?.mfa_secret);
    const availableMethods: MfaMethod[] = [];
    if (totpEnabled) {
      availableMethods.push("totp");
      if (getRecoveryCodeHashes(attorneySecurity?.mfa_recovery_codes).length > 0) {
        availableMethods.push("recovery_code");
      }
    }
    if (passkeys.length > 0) {
      availableMethods.push("webauthn");
    }

    return {
      enabled: totpEnabled || passkeys.length > 0,
      totpEnabled,
      pendingEnrollment: Boolean(pendingEnrollment),
      recoveryCodesRemaining: getRecoveryCodeHashes(attorneySecurity?.mfa_recovery_codes).length,
      passkeyCount: passkeys.length,
      availableMethods,
      enabledAt: attorneySecurity?.mfa_enabled_at
        ? new Date(String(attorneySecurity.mfa_enabled_at)).toISOString()
        : undefined
    };
  },

  async beginMfaEnrollment(session: AuthSession): Promise<MfaSetupResponse> {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: "Legal Agent",
      label: session.email || session.fullName || session.attorneyId,
      secret
    });
    const recoveryCodes = generateRecoveryCodes();
    const recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);

    const enrollment = await repository.upsertMfaEnrollment({
      id: randomUUID(),
      tenantId: session.tenantId,
      attorneyId: session.attorneyId,
      secret: encryptSecret(secret.base32),
      recoveryCodeHashes
    });

    return {
      secretBase32: secret.base32,
      otpAuthUrl: totp.toString(),
      recoveryCodes,
      expiresAt: enrollment?.expires_at
        ? new Date(String(enrollment.expires_at)).toISOString()
        : new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };
  },

  async confirmMfaEnrollment(session: AuthSession, input: { token: string }) {
    const enrollment = await repository.getMfaEnrollment(session.attorneyId);
    if (!enrollment) {
      throw new Error("MFA enrollment is not pending or has expired.");
    }

    const secretBase32 = decryptSecret(String(enrollment.secret));
    const totp = getTotpForAttorney(session.email || session.attorneyId, secretBase32);
    if (totp.validate({ token: input.token, window: 1 }) === null) {
      throw new Error("The MFA setup code was invalid.");
    }

    const recoveryCodeHashes = getRecoveryCodeHashes(enrollment.recovery_code_hashes);

    await withTransaction(async () => {
      await repository.enableAttorneyMfa({
        attorneyId: session.attorneyId,
        secret: encryptSecret(secretBase32),
        recoveryCodeHashes
      });
      await repository.deleteMfaEnrollment(session.attorneyId);
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: session.tenantId,
        actorAttorneyId: session.attorneyId,
        eventType: "auth.mfa_enabled",
        objectType: "attorney",
        objectId: session.attorneyId
      });
    });

    return {
      enabled: true,
      totpEnabled: true,
      pendingEnrollment: false,
      recoveryCodesRemaining: recoveryCodeHashes.length,
      passkeyCount: (await repository.listWebauthnCredentials(session.attorneyId)).length,
      availableMethods: ["totp", "recovery_code"],
      enabledAt: new Date().toISOString()
    };
  },

  async disableMfa(session: AuthSession, input: { token?: string; recoveryCode?: string }) {
    const attorneySecurity = await repository.getAttorneySecurity(session.attorneyId);
    if (!attorneySecurity || !attorneySecurity.mfa_enabled || !attorneySecurity.mfa_secret) {
      throw new Error("MFA is not enabled.");
    }

    let verified = false;
    const recoveryCodeHashes = getRecoveryCodeHashes(attorneySecurity.mfa_recovery_codes);

    if (input.token) {
      const totp = getTotpForAttorney(
        String(attorneySecurity.email ?? ""),
        decryptSecret(String(attorneySecurity.mfa_secret))
      );
      verified = totp.validate({ token: input.token, window: 1 }) !== null;
    } else if (input.recoveryCode) {
      const recoveryHash = hashRecoveryCode(input.recoveryCode);
      verified = recoveryCodeHashes.includes(recoveryHash);
    }

    if (!verified) {
      throw new Error("A valid MFA code or recovery code is required to disable MFA.");
    }

    await repository.disableAttorneyMfa(session.attorneyId);
    await repository.deleteMfaEnrollment(session.attorneyId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.mfa_disabled",
      objectType: "attorney",
      objectId: session.attorneyId
    });

    return { ok: true };
  },

  async listPasskeys(session: AuthSession): Promise<PasskeySummary[]> {
    return repository.listWebauthnCredentials(session.attorneyId);
  },

  async beginPasskeyRegistration(session: AuthSession, input?: { label?: string }) {
    const existingPasskeys = await repository.listWebauthnCredentials(session.attorneyId);
    const options = await generateRegistrationOptions({
      rpName: config.webauthnRpName,
      rpID: config.webauthnRpId,
      userName: session.email || session.attorneyId,
      userID: Buffer.from(session.attorneyId, "utf8"),
      userDisplayName: session.fullName || session.email || session.attorneyId,
      attestationType: "none",
      excludeCredentials: existingPasskeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as Array<
          "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb"
        >
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
      }
    });

    const challenge = await repository.createWebauthnChallenge({
      id: randomUUID(),
      tenantId: session.tenantId,
      attorneyId: session.attorneyId,
      challengeValue: options.challenge,
      challengeType: "registration",
      label: input?.label
    });

    return {
      challengeId: String(challenge?.id),
      options
    };
  },

  async finishPasskeyRegistration(
    session: AuthSession,
    input: { challengeId: string; response: RegistrationResponseJSON; label?: string }
  ) {
    const challenge = await repository.getWebauthnChallenge(input.challengeId);
    if (!challenge || String(challenge.attorney_id) !== session.attorneyId) {
      throw new Error("Passkey registration challenge is invalid or expired.");
    }

    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: String(challenge.challenge_value),
      expectedOrigin: config.webAppUrl,
      expectedRPID: config.webauthnRpId,
      requireUserVerification: true
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration could not be verified.");
    }

    await repository.consumeWebauthnChallenge(input.challengeId);
    const registrationInfo = verification.registrationInfo;
    const credentialId = registrationInfo.credential.id;
    const existingCredential = await repository.getWebauthnCredentialByCredentialId(credentialId);
    if (!existingCredential) {
      await repository.createWebauthnCredential({
        id: randomUUID(),
        tenantId: session.tenantId,
        attorneyId: session.attorneyId,
        credentialId,
        publicKey: toBase64Url(Buffer.from(registrationInfo.credential.publicKey)),
        counter: registrationInfo.credential.counter,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports: input.response.response.transports ?? [],
        label: input.label || (challenge.label ? String(challenge.label) : undefined)
      });
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.passkey_registered",
      objectType: "attorney",
      objectId: session.attorneyId,
      metadata: {
        credentialId
      }
    });

    return repository.listWebauthnCredentials(session.attorneyId);
  },

  async deletePasskey(session: AuthSession, passkeyId: string) {
    const deleted = await repository.deleteWebauthnCredential(session.attorneyId, passkeyId);
    if (!deleted) {
      throw new Error("Passkey not found.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.passkey_deleted",
      objectType: "attorney",
      objectId: session.attorneyId,
      metadata: {
        passkeyId
      }
    });

    return { ok: true };
  },

  async beginMfaPasskeyAuthentication(input: { challengeToken: string }) {
    const mfaChallenge = await repository.getMfaChallenge(hashApiKey(input.challengeToken));
    if (!mfaChallenge) {
      throw new Error("MFA challenge is invalid or expired.");
    }

    const passkeys = await repository.listWebauthnCredentials(String(mfaChallenge.attorney_id));
    if (passkeys.length === 0) {
      throw new Error("No registered passkeys are available for this account.");
    }

    const credentialRows = await Promise.all(
      passkeys.map((passkey) => repository.getWebauthnCredentialByCredentialId(passkey.credentialId))
    );
    const options = await generateAuthenticationOptions({
      rpID: config.webauthnRpId,
      allowCredentials: credentialRows
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          id: String(row.credential_id),
          transports: Array.isArray(row.transports)
            ? row.transports.map((transport) =>
                String(transport)
              ) as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">
            : undefined
        })),
      userVerification: "required"
    });

    const challenge = await repository.createWebauthnChallenge({
      id: randomUUID(),
      tenantId: String(mfaChallenge.tenant_id),
      attorneyId: String(mfaChallenge.attorney_id),
      challengeValue: options.challenge,
      challengeType: "mfa_authentication",
      linkedMfaChallengeId: String(mfaChallenge.id)
    });

    return {
      challengeId: String(challenge?.id),
      options
    };
  },

  async finishMfaPasskeyAuthentication(input: {
    challengeToken: string;
    challengeId: string;
    response: AuthenticationResponseJSON;
  }) {
    const [mfaChallenge, passkeyChallenge] = await Promise.all([
      repository.getMfaChallenge(hashApiKey(input.challengeToken)),
      repository.getWebauthnChallenge(input.challengeId)
    ]);

    if (!mfaChallenge) {
      throw new Error("MFA challenge is invalid or expired.");
    }

    if (
      !passkeyChallenge ||
      String(passkeyChallenge.attorney_id) !== String(mfaChallenge.attorney_id) ||
      String(passkeyChallenge.linked_mfa_challenge_id ?? "") !== String(mfaChallenge.id)
    ) {
      throw new Error("Passkey authentication challenge is invalid or expired.");
    }

    const credential = await repository.getWebauthnCredentialByCredentialId(input.response.id);
    if (!credential || String(credential.attorney_id) !== String(mfaChallenge.attorney_id)) {
      throw new Error("Passkey credential is not registered for this account.");
    }

    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: String(passkeyChallenge.challenge_value),
      expectedOrigin: config.webAppUrl,
      expectedRPID: config.webauthnRpId,
      credential: {
        id: String(credential.credential_id),
        publicKey: fromBase64Url(String(credential.public_key)),
        counter: Number(credential.counter ?? 0),
        transports: Array.isArray(credential.transports)
          ? credential.transports.map((transport: unknown) =>
              String(transport)
            ) as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">
          : []
      },
      requireUserVerification: true
    });

    if (!verification.verified) {
      throw new Error("Passkey authentication could not be verified.");
    }

    await repository.updateWebauthnCredential({
      credentialId: String(credential.credential_id),
      counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      transports: Array.isArray(credential.transports) ? credential.transports.map(String) : []
    });
    await repository.consumeWebauthnChallenge(input.challengeId);
    await repository.consumeMfaChallenge(String(mfaChallenge.id));

    const session = await repository.getAttorneySession(String(mfaChallenge.attorney_id));
    if (!session) {
      throw new Error("Unable to create session.");
    }

    await repository.markAttorneyLoggedIn(session.attorneyId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.mfa_verified",
      objectType: "attorney",
      objectId: session.attorneyId,
      metadata: {
        method: "webauthn",
        authMethod: String(mfaChallenge.auth_method)
      }
    });

    return buildLoginSuccessResponse(session);
  },

  async beginPasswordlessPasskeyLogin(input: { tenantId: string; email: string }) {
    const attorney = await repository.getAttorneyForPasswordless(input.tenantId, input.email);
    if (!attorney) {
      throw new Error("No active account was found for that tenant and email.");
    }

    const passkeys = await repository.listWebauthnCredentials(String(attorney.id));
    if (passkeys.length === 0) {
      throw new Error("No registered passkeys are available for this account.");
    }

    const options = await generateAuthenticationOptions({
      rpID: config.webauthnRpId,
      allowCredentials: passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as Array<
          "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb"
        >
      })),
      userVerification: "required"
    });

    const challenge = await repository.createWebauthnChallenge({
      id: randomUUID(),
      tenantId: input.tenantId,
      attorneyId: String(attorney.id),
      challengeValue: options.challenge,
      challengeType: "passwordless_authentication"
    });

    return {
      challengeId: String(challenge?.id),
      options
    };
  },

  async finishPasswordlessPasskeyLogin(input: {
    tenantId: string;
    email: string;
    challengeId: string;
    response: AuthenticationResponseJSON;
  }) {
    const [attorney, challenge] = await Promise.all([
      repository.getAttorneyForPasswordless(input.tenantId, input.email),
      repository.getWebauthnChallenge(input.challengeId)
    ]);

    if (!attorney) {
      throw new Error("No active account was found for that tenant and email.");
    }

    if (
      !challenge ||
      String(challenge.attorney_id) !== String(attorney.id) ||
      String(challenge.challenge_type) !== "passwordless_authentication"
    ) {
      throw new Error("Passkey login challenge is invalid or expired.");
    }

    const credential = await repository.getWebauthnCredentialByCredentialId(input.response.id);
    if (!credential || String(credential.attorney_id) !== String(attorney.id)) {
      throw new Error("Passkey credential is not registered for this account.");
    }

    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: String(challenge.challenge_value),
      expectedOrigin: config.webAppUrl,
      expectedRPID: config.webauthnRpId,
      credential: {
        id: String(credential.credential_id),
        publicKey: fromBase64Url(String(credential.public_key)),
        counter: Number(credential.counter ?? 0),
        transports: Array.isArray(credential.transports)
          ? credential.transports.map((transport: unknown) =>
              String(transport)
            ) as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">
          : []
      },
      requireUserVerification: true
    });

    if (!verification.verified) {
      throw new Error("Passkey authentication could not be verified.");
    }

    await repository.updateWebauthnCredential({
      credentialId: String(credential.credential_id),
      counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      transports: Array.isArray(credential.transports) ? credential.transports.map(String) : []
    });
    await repository.consumeWebauthnChallenge(input.challengeId);

    const session = await repository.getAttorneySession(String(attorney.id));
    if (!session) {
      throw new Error("Unable to create session.");
    }

    await repository.markAttorneyLoggedIn(session.attorneyId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.passwordless_passkey_login",
      objectType: "attorney",
      objectId: session.attorneyId
    });

    return buildLoginSuccessResponse(session);
  },

  async forgotPassword(input: { email: string; tenantId?: string }) {
    const attorney = await repository.getAttorneyByEmailForPasswordReset(input.email, input.tenantId);
    if (!attorney) {
      return { ok: true };
    }

    const rawToken = generateOpaqueToken("reset");
    await repository.createPasswordResetToken({
      id: randomUUID(),
      tenantId: String(attorney.tenant_id),
      attorneyId: String(attorney.id),
      tokenHash: hashApiKey(rawToken)
    });

    const resetUrl = buildWebRedirectUrl("/", {
      resetToken: rawToken
    });
    await sendPasswordResetEmail({
      to: String(attorney.email),
      fullName: String(attorney.full_name ?? attorney.email),
      tenantName: "Legal Agent Workspace",
      resetUrl
    });

    return {
      ok: true,
      resetToken: config.nodeEnv === "development" ? rawToken : undefined
    };
  },

  async resetPassword(input: { token: string; password: string }) {
    const tokenRecord = await repository.getPasswordResetToken(hashApiKey(input.token));
    if (!tokenRecord) {
      throw new Error("Password reset token is invalid or expired.");
    }

    const attorneyId = String(tokenRecord.attorney_id);
    await repository.updateAttorneyPassword(attorneyId, await hashPassword(input.password));
    await repository.consumePasswordResetToken(String(tokenRecord.id));

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: String(tokenRecord.tenant_id),
      actorAttorneyId: attorneyId,
      eventType: "auth.password_reset",
      objectType: "attorney",
      objectId: attorneyId
    });

    return { ok: true };
  },

  async acceptInvitation(input: { token: string; password: string; fullName?: string }) {
    const invitation = await repository.getInvitationByTokenHash(hashApiKey(input.token));
    if (!invitation) {
      throw new Error("Invitation token is invalid or expired.");
    }

    const passwordHash = await hashPassword(input.password);

    const attorney = await withTransaction(async () => {
      const created = await repository.createAttorney({
        id: randomUUID(),
        tenantId: String(invitation.tenant_id),
        email: String(invitation.email),
        fullName: input.fullName || String(invitation.full_name ?? invitation.email),
        role: invitation.role as AuthSession["role"],
        practiceArea: String(invitation.practice_area),
        passwordHash,
        isTenantAdmin: Boolean(invitation.is_tenant_admin)
      });

      await repository.markInvitationAccepted(String(invitation.id));
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: String(invitation.tenant_id),
        actorAttorneyId: created.id,
        eventType: "auth.invitation_accepted",
        objectType: "invitation",
        objectId: String(invitation.id),
        metadata: {
          attorneyId: created.id
        }
      });

      return created;
    });

    const session = await repository.getAttorneySession(attorney.id);
    if (!session) {
      throw new Error("Unable to create session for invited user.");
    }

    return buildLoginSuccessResponse(session);
  },

  async getPublicSsoProviders(tenantId: string) {
    return repository.listEnabledSsoProviders(tenantId);
  },

  async getSamlMetadata(tenantId: string, providerName: string) {
    const provider = await repository.getSsoProviderByTenantAndName(tenantId, providerName);
    if (!provider || String(provider.provider_type ?? "oidc") !== "saml") {
      throw new Error("SAML provider not found.");
    }

    return generateSamlMetadata(toSamlProviderConfig(provider));
  },

  async startSsoLogin(input: {
    tenantId: string;
    providerName: string;
    redirectPath?: string;
  }) {
    const provider = await repository.getSsoProviderForTenant(input.tenantId, input.providerName);
    if (!provider) {
      throw new Error("SSO provider not found or not enabled.");
    }

    if (String(provider.provider_type ?? "oidc") === "saml") {
      const rawRelayState = generateOpaqueToken("relay");
      await repository.createSamlRelayState({
        id: randomUUID(),
        tenantId: input.tenantId,
        providerId: String(provider.id),
        relayStateHash: hashApiKey(rawRelayState),
        redirectPath: normalizeRedirectPath(input.redirectPath)
      });

      return {
        authorizationUrl: await buildSamlAuthorizeUrl({
          provider: toSamlProviderConfig(provider),
          relayState: rawRelayState
        })
      };
    }

    const rawState = generateOpaqueToken("state");
    const nonce = generateOpaqueToken("nonce");
    const { codeVerifier, codeChallenge } = generatePkcePair();

    await repository.createSsoAuthState({
      id: randomUUID(),
      tenantId: input.tenantId,
      providerId: String(provider.id),
      stateHash: hashApiKey(rawState),
      nonce,
      codeVerifier,
      redirectPath: normalizeRedirectPath(input.redirectPath)
    });

    const authorizationUrl = await buildAuthorizationUrl({
      provider: toProviderConfig(provider),
      state: rawState,
      nonce,
      codeChallenge
    });

    return { authorizationUrl };
  },

  async handleSsoCallback(input: { state: string; code: string }) {
    const stateRecord = await repository.consumeSsoAuthState(hashApiKey(input.state));
    if (!stateRecord) {
      throw new Error("SSO state is invalid or expired.");
    }

    const providerRecord = await repository.getSsoProviderById(String(stateRecord.provider_id));
    if (!providerRecord || String(providerRecord.tenant_id) !== String(stateRecord.tenant_id)) {
      throw new Error("SSO provider not found for callback.");
    }

    const providerConfig = toProviderConfig(providerRecord);
    const { metadata, tokens } = await exchangeAuthorizationCode({
      provider: providerConfig,
      code: input.code,
      codeVerifier: String(stateRecord.code_verifier)
    });

    const claims =
      tokens.id_token
        ? await verifyIdToken({
            metadata,
            provider: providerConfig,
            idToken: tokens.id_token,
            nonce: String(stateRecord.nonce)
          })
        : null;

    const userInfo =
      claims && claims.email
        ? null
        : tokens.access_token
          ? await fetchUserInfo({
              metadata,
              accessToken: tokens.access_token
            })
          : null;

    const email = String(claims?.email ?? userInfo?.email ?? "");
    const fullName = String(claims?.name ?? userInfo?.name ?? email);

    if (!email) {
      throw new Error("SSO provider did not return an email address.");
    }

    const { attorney, acceptedInvitationId } = await resolveAttorneyForFederatedIdentity({
      tenantId: String(stateRecord.tenant_id),
      email,
      fullName
    });
    if (acceptedInvitationId) {
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: String(stateRecord.tenant_id),
        actorAttorneyId: attorney.id,
        eventType: "auth.invitation_accepted_via_sso",
        objectType: "invitation",
        objectId: acceptedInvitationId,
        metadata: {
          email
        }
      });
    }

    return buildFederatedRedirect({
      tenantId: String(stateRecord.tenant_id),
      attorneyId: attorney.id,
      redirectPath: String(stateRecord.redirect_path ?? "/"),
      providerName: providerConfig.providerName,
      authMethod: "oidc"
    });
  },

  async handleSamlAcs(input: { relayState: string; samlResponse: string }) {
    const relayStateRecord = await repository.consumeSamlRelayState(hashApiKey(input.relayState));
    if (!relayStateRecord) {
      throw new Error("SAML relay state is invalid or expired.");
    }

    const providerRecord = await repository.getSsoProviderById(String(relayStateRecord.provider_id));
    if (!providerRecord || String(providerRecord.tenant_id) !== String(relayStateRecord.tenant_id)) {
      throw new Error("SAML provider not found for callback.");
    }

    const samlValidation = await validateSamlPostResponse({
      provider: toSamlProviderConfig(providerRecord),
      samlResponse: input.samlResponse,
      relayState: input.relayState
    });

    const email = String(
      samlValidation.profile?.email ??
        samlValidation.profile?.mail ??
        samlValidation.profile?.["urn:oid:0.9.2342.19200300.100.1.3"] ??
        ""
    );
    const fullName = String(
      samlValidation.profile?.displayName ??
        samlValidation.profile?.cn ??
        samlValidation.profile?.nameID ??
        email
    );

    if (!email) {
      throw new Error("SAML assertion did not contain an email address.");
    }

    const { attorney, acceptedInvitationId } = await resolveAttorneyForFederatedIdentity({
      tenantId: String(relayStateRecord.tenant_id),
      email,
      fullName
    });
    await repository.upsertSamlLoginSession({
      id: randomUUID(),
      tenantId: String(relayStateRecord.tenant_id),
      providerId: String(providerRecord.id),
      attorneyId: attorney.id,
      nameId: String(samlValidation.profile?.nameID ?? email),
      nameIdFormat: samlValidation.profile?.nameIDFormat
        ? String(samlValidation.profile.nameIDFormat)
        : undefined,
      sessionIndex: samlValidation.profile?.sessionIndex
        ? String(samlValidation.profile.sessionIndex)
        : undefined
    });
    if (acceptedInvitationId) {
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: String(relayStateRecord.tenant_id),
        actorAttorneyId: attorney.id,
        eventType: "auth.invitation_accepted_via_sso",
        objectType: "invitation",
        objectId: acceptedInvitationId,
        metadata: {
          email
        }
      });
    }

    return buildFederatedRedirect({
      tenantId: String(relayStateRecord.tenant_id),
      attorneyId: attorney.id,
      redirectPath: String(relayStateRecord.redirect_path ?? "/"),
      providerName: String(providerRecord.provider_name ?? providerRecord.providerName),
      authMethod: "saml"
    });
  },

  async startSamlLogout(
    session: AuthSession,
    input?: {
      providerName?: string;
      redirectPath?: string;
    }
  ) {
    const providerName = input?.providerName || session.identityProvider;
    if (!providerName) {
      throw new Error("A SAML provider name is required to initiate logout.");
    }

    const providerRecord = await repository.getSsoProviderForTenant(session.tenantId, providerName);
    if (!providerRecord || String(providerRecord.provider_type ?? "oidc") !== "saml") {
      throw new Error("SAML provider not found or not enabled.");
    }

    const samlSession = await repository.getLatestSamlLoginSession(
      session.attorneyId,
      String(providerRecord.id)
    );
    if (!samlSession) {
      throw new Error("No active SAML session was found for this attorney.");
    }

    const rawRelayState = generateOpaqueToken("slo");
    await repository.createSamlLogoutState({
      id: randomUUID(),
      tenantId: session.tenantId,
      providerId: String(providerRecord.id),
      attorneyId: session.attorneyId,
      relayStateHash: hashApiKey(rawRelayState),
      redirectPath: normalizeRedirectPath(input?.redirectPath)
    });

    const logoutUrl = await buildSamlLogoutUrl({
      provider: toSamlProviderConfig(providerRecord),
      relayState: rawRelayState,
      profile: {
        issuer: String(providerRecord.entity_id ?? providerRecord.provider_name ?? providerName),
        nameID: String(samlSession.name_id),
        nameIDFormat: String(
          samlSession.name_id_format ??
            providerRecord.name_id_format ??
            "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
        ),
        sessionIndex: samlSession.session_index ? String(samlSession.session_index) : undefined
      }
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "auth.saml_logout_started",
      objectType: "attorney",
      objectId: session.attorneyId,
      metadata: {
        providerName
      }
    });

    return { logoutUrl };
  },

  async handleSamlLogoutCallback(input: {
    tenantId: string;
    providerName: string;
    relayState?: string;
    query: Record<string, unknown>;
    originalQuery: string;
  }) {
    const providerRecord = await repository.getSsoProviderForTenant(input.tenantId, input.providerName);
    if (!providerRecord || String(providerRecord.provider_type ?? "oidc") !== "saml") {
      throw new Error("SAML provider not found or not enabled.");
    }

    const relayStateRecord = input.relayState
      ? await repository.consumeSamlLogoutState(hashApiKey(input.relayState))
      : null;
    const samlResult = await validateSamlRedirect({
      provider: toSamlProviderConfig(providerRecord),
      query: input.query as Parameters<typeof validateSamlRedirect>[0]["query"],
      originalQuery: input.originalQuery
    });

    const defaultRedirectPath = relayStateRecord?.redirect_path
      ? String(relayStateRecord.redirect_path)
      : "/";
    const queryRecord = input.query as Record<string, unknown>;

    if (typeof queryRecord.SAMLRequest === "string") {
      const logoutResponseUrl = await buildSamlLogoutResponseUrl({
        provider: toSamlProviderConfig(providerRecord),
        relayState: input.relayState ?? "",
        logoutRequest: {
          issuer: String(
            samlResult.profile?.issuer ?? providerRecord.entity_id ?? providerRecord.provider_name
          ),
          nameID: String(samlResult.profile?.nameID ?? ""),
          nameIDFormat: String(
            samlResult.profile?.nameIDFormat ??
              providerRecord.name_id_format ??
              "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
          ),
          sessionIndex: samlResult.profile?.sessionIndex
            ? String(samlResult.profile.sessionIndex)
            : undefined,
          ID: samlResult.profile?.ID ? String(samlResult.profile.ID) : undefined
        },
        success: true
      });

      return { redirectUrl: logoutResponseUrl };
    }

    if (relayStateRecord?.attorney_id) {
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: input.tenantId,
        actorAttorneyId: String(relayStateRecord.attorney_id),
        eventType: "auth.saml_logout_completed",
        objectType: "attorney",
        objectId: String(relayStateRecord.attorney_id),
        metadata: {
          providerName: input.providerName,
          loggedOut: samlResult.loggedOut
        }
      });
    }

    return {
      redirectUrl: buildWebRedirectUrl(defaultRedirectPath, {
        loggedOut: "1"
      })
    };
  },

  async exchangeBrowserAuthCode(input: { code: string }): Promise<LoginResponse> {
    const exchange = await repository.consumeAuthExchange(hashApiKey(input.code));
    if (!exchange) {
      throw new Error("Authentication exchange code is invalid or expired.");
    }

    const baseSession = await repository.getAttorneySession(String(exchange.attorney_id));
    if (!baseSession) {
      throw new Error("Unable to create session.");
    }

    const session: AuthSession = {
      ...baseSession,
      federationProtocol:
        String(exchange.federation_protocol ?? "") === "saml" ||
        String(exchange.federation_protocol ?? "") === "oidc"
          ? (String(exchange.federation_protocol) as AuthSession["federationProtocol"])
          : undefined,
      identityProvider: exchange.identity_provider ? String(exchange.identity_provider) : undefined
    };

    return buildLoginSuccessResponse(session);
  },

  async dashboard(session: AuthSession) {
    return repository.getDashboard(session.tenantId);
  },

  async ingestDocument(
    session: AuthSession,
    input: {
      matterId: string;
      sourceName: string;
      mimeType: string;
      docType: string;
      normalizedText?: string;
      storagePath?: string;
      sha256: string;
    }
  ) {
    const matter = await repository.getMatterForTenant(input.matterId, session.tenantId);
    if (!matter) {
      throw new Error("Matter not found for tenant.");
    }

    const existingDocument = await repository.getDocumentByShaForTenant(session.tenantId, input.sha256);
    if (existingDocument) {
      return existingDocument;
    }

    const document: DocumentRecord = ensureTenant<DocumentRecord>(
      {
        id: randomUUID(),
        matterId: input.matterId,
        sourceName: input.sourceName,
        mimeType: input.mimeType,
        docType: input.docType,
        ingestionStatus: input.normalizedText ? "normalized" : "processing",
        securityStatus: "clean",
        normalizedText: input.normalizedText ?? "",
        privilegeScore: 0.2,
        relevanceScore: 0.75,
        storagePath: input.storagePath,
        createdAt: new Date().toISOString(),
        sha256: input.sha256
      },
      session.tenantId
    );

    if (document.normalizedText) {
      document.embedding = await embedTextWithOpenAI(document.normalizedText.slice(0, 4000));
    }

    await repository.addDocument(document);

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.ingested",
      objectType: "document",
      objectId: document.id,
      metadata: {
        matterId: document.matterId,
        docType: document.docType,
        ingestionStatus: document.ingestionStatus
      }
    });

    if (!document.normalizedText) {
      await repository.createWorkflowJob({
        id: randomUUID(),
        tenantId: session.tenantId,
        jobType: "document.ingest",
        payload: {
          documentId: document.id
        }
      });
    }

    return sanitizeDocumentForResponse(document);
  },

  async queueUploadedDocument(
    session: AuthSession,
    input: {
      matterId: string;
      sourceName: string;
      mimeType: string;
      docType: string;
      storagePath: string;
      sha256: string;
    }
  ) {
    const matter = await repository.getMatterForTenant(input.matterId, session.tenantId);
    if (!matter) {
      throw new Error("Matter not found for tenant.");
    }

    const existingDocument = await repository.getDocumentByShaForTenant(session.tenantId, input.sha256);
    if (existingDocument) {
      return existingDocument;
    }

    const document: DocumentRecord = ensureTenant<DocumentRecord>(
      {
        id: randomUUID(),
        matterId: input.matterId,
        sourceName: input.sourceName,
        mimeType: input.mimeType,
        docType: input.docType,
        ingestionStatus: "uploaded",
        securityStatus: "pending_scan",
        normalizedText: "",
        privilegeScore: 0.2,
        relevanceScore: 0.75,
        storagePath: input.storagePath,
        createdAt: new Date().toISOString(),
        sha256: input.sha256
      },
      session.tenantId
    );

    await repository.addDocument(document);
    await repository.createWorkflowJob({
      id: randomUUID(),
      tenantId: session.tenantId,
      jobType: "document.scan",
      payload: {
        documentId: document.id
      },
      maxAttempts: 3
    });
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.uploaded",
      objectType: "document",
      objectId: document.id,
      metadata: {
        matterId: document.matterId,
        storagePath: document.storagePath,
        securityStatus: document.securityStatus
      }
    });

    return sanitizeDocumentForResponse(document);
  },

  async queueDocumentRescan(session: AuthSession, documentId: string) {
    const document = await repository.getDocumentForTenant(documentId, session.tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    if (!document.storagePath) {
      throw new Error("Document does not have a stored file to rescan.");
    }

    await repository.updateDocument(document.id, session.tenantId, (existing) => ({
      ...existing,
      ingestionStatus: existing.normalizedText ? existing.ingestionStatus : "uploaded",
      securityStatus: "pending_scan",
      securityReason: undefined
    }));
    await repository.createWorkflowJob({
      id: randomUUID(),
      tenantId: session.tenantId,
      jobType: "document.rescan",
      payload: {
        documentId: document.id
      },
      maxAttempts: 3
    });
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.rescan_requested",
      objectType: "document",
      objectId: document.id
    });

    return { ok: true };
  },

  async extractClauses(session: AuthSession, input: ClauseExtractionRequest) {
    const document = await repository.getDocumentForTenant(input.documentId, session.tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    const prompt = `${clauseExtractionSystemPrompt}\n\n${buildClauseExtractionPrompt({
      documentType: input.documentType || document.docType,
      normalizedText: input.normalizedText || document.normalizedText
    })}`;
    const result = await extractClausesWithOpenAI(prompt);

    const clauses: ClauseRecord[] = result.clauses.map((clause) => ({
      id: randomUUID(),
      documentId: input.documentId,
      clauseType: clause.clause_type,
      heading: clause.heading,
      textExcerpt: clause.text_excerpt,
      pageFrom: clause.page_from,
      pageTo: clause.page_to,
      riskLevel: clause.risk_level,
      confidence: clause.confidence,
      reviewerStatus: "pending"
    }));

    await repository.replaceClauses(input.documentId, clauses, session.tenantId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.clauses_extracted",
      objectType: "document",
      objectId: input.documentId,
      metadata: {
        clauseCount: clauses.length
      }
    });
    return clauses;
  },

  async assessRisk(
    session: AuthSession,
    input: RiskAssessmentRequest & { matterId: string; documentId: string; clauseId?: string }
  ) {
    const document = await repository.getDocumentForTenant(input.documentId, session.tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    const prompt = buildRiskPrompt({
      clauseText: input.clauseText,
      playbook: input.playbook.length ? input.playbook : defaultPlaybook
    });
    const result = await assessRiskWithOpenAI(prompt);

    const flags: FlagRecord[] = result.flags.map((flag) => ({
      id: randomUUID(),
      matterId: input.matterId,
      documentId: input.documentId,
      clauseId: input.clauseId,
      flagType: flag.flag_type,
      severity: flag.severity,
      reason: `${flag.issue} Recommended fix: ${flag.recommended_fix}`,
      confidence: flag.confidence,
      status: "open"
    }));

    await repository.addFlags(flags, session.tenantId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.risk_assessed",
      objectType: "document",
      objectId: input.documentId,
      metadata: {
        flagCount: flags.length
      }
    });
    return flags;
  },

  async research(session: AuthSession, question: string): Promise<ResearchResponse> {
    const questionEmbedding = await embedTextWithOpenAI(question);

    const rankedDocuments = (await repository.getDocumentEmbeddings(session.tenantId))
      .map((document) => ({
        document,
        score: cosineSimilarity(questionEmbedding, document.embedding ?? [])
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);

    const corpus = rankedDocuments.map(
      ({ document, score }) =>
        `${document.sourceName} (semantic score ${score.toFixed(2)}): ${document.normalizedText.slice(0, 700)}`
    );
    const sourceDocumentIds = rankedDocuments.map(({ document }) => document.id);

    const prompt = buildResearchPrompt({ question, corpus });
    const result = await answerResearchWithOpenAI(prompt);
    
    // Save research query to history
    await repository.recordResearch({
      tenantId: session.tenantId,
      attorneyId: session.attorneyId,
      question,
      result,
      modelName: config.openAiModel,
      sourceDocumentIds,
      contextUsed: corpus.join("\n\n")
    });
    
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "research.queried",
      objectType: "research",
      objectId: createHash("sha256").update(question).digest("hex"),
      metadata: {
        question
      }
    });
    return result;
  },

  async getResearchHistory(session: AuthSession, opts?: { limit?: number; offset?: number }) {
    return repository.getResearchHistory(session.tenantId, {
      attorneyId: session.attorneyId,
      limit: opts?.limit,
      offset: opts?.offset
    });
  },

  async reviewFeedback(session: AuthSession, input: {
    flagId: string;
    action: "approved" | "rejected" | "resolved";
  }) {
    // Validate flag belongs to tenant before any action
    const flag = await repository.getFlagById(input.flagId, session.tenantId);
    if (!flag) {
      throw new Error("Flag not found or access denied");
    }

    let result;
    if (input.action === "resolved") {
      result = await repository.resolveFlag(input.flagId, session.tenantId);
    } else {
      // approved or rejected - actually persist the status
      result = await repository.updateFlagStatus(input.flagId, session.tenantId, input.action);
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "review.feedback_recorded",
      objectType: "flag",
      objectId: input.flagId,
      metadata: {
        action: input.action,
        reviewerId: session.attorneyId  // Use session instead of untrusted input
      }
    });

    return result ?? { id: input.flagId, stored: true };
  },

  async listMatterDocuments(session: AuthSession, matterId: string) {
    const documents = await repository.getMatterDocuments(matterId, session.tenantId);
    return documents.map(sanitizeDocumentForResponse);
  },

  async getTenantAdminSnapshot(session: AuthSession) {
    const [dashboard, apiKeys, invitations, ssoProviders, scimTokens] = await Promise.all([
      repository.getDashboard(session.tenantId),
      repository.listApiKeys(session.tenantId),
      repository.listInvitations(session.tenantId),
      repository.listSsoProviders(session.tenantId),
      repository.listScimTokens(session.tenantId)
    ]);

    return {
      tenant: dashboard.tenant,
      attorneys: dashboard.attorneys,
      apiKeys,
      invitations,
      ssoProviders,
      scimTokens
    };
  },

  async updateTenant(session: AuthSession, input: { name: string; region: string; plan: string }) {
    const tenant = await repository.updateTenant({
      tenantId: session.tenantId,
      name: input.name,
      region: input.region,
      plan: input.plan
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "tenant.updated",
      objectType: "tenant",
      objectId: session.tenantId,
      metadata: input
    });

    return tenant;
  },

  async createAttorney(
    session: AuthSession,
    input: {
      email: string;
      fullName: string;
      role: AuthSession["role"];
      practiceArea: string;
      password: string;
      isTenantAdmin: boolean;
    }
  ) {
    const attorney = await repository.createAttorney({
      id: randomUUID(),
      tenantId: session.tenantId,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      practiceArea: input.practiceArea,
      passwordHash: await hashPassword(input.password),
      isTenantAdmin: input.isTenantAdmin
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "attorney.created",
      objectType: "attorney",
      objectId: attorney.id,
      metadata: {
        email: attorney.email,
        role: attorney.role
      }
    });

    return attorney;
  },

  async createApiKey(
    session: AuthSession,
    input: { attorneyId: string; name: string; role: AuthSession["role"] }
  ): Promise<ApiKeySummary & { rawKey: string }> {
    // Verify attorney belongs to same tenant
    const attorney = await repository.getAttorneyByIdForTenant(input.attorneyId, session.tenantId);
    if (!attorney) {
      throw new Error("Attorney not found in tenant.");
    }

    const rawKey = generateRawApiKey();
    const apiKey = await repository.createApiKey({
      id: randomUUID(),
      tenantId: session.tenantId,
      attorneyId: input.attorneyId,
      name: input.name,
      keyPrefix: getApiKeyPrefix(rawKey),
      keyHash: hashApiKey(rawKey),
      role: input.role
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "api_key.created",
      objectType: "api_key",
      objectId: apiKey.id,
      metadata: {
        name: apiKey.name,
        role: apiKey.role,
        forAttorneyId: input.attorneyId
      }
    });

    return {
      ...apiKey,
      rawKey
    };
  },

  async createScimToken(
    session: AuthSession,
    input: { name: string }
  ): Promise<ScimTokenSummary & { rawToken: string }> {
    const rawToken = `scim_${generateOpaqueToken("token")}`;
    const token = await repository.createScimToken({
      id: randomUUID(),
      tenantId: session.tenantId,
      createdBy: session.attorneyId,
      name: input.name,
      tokenPrefix: getApiKeyPrefix(rawToken),
      tokenHash: hashApiKey(rawToken)
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "scim_token.created",
      objectType: "scim_token",
      objectId: token.id,
      metadata: {
        name: token.name
      }
    });

    return {
      ...token,
      rawToken
    };
  },

  async createInvitation(
    session: AuthSession,
    input: {
      email: string;
      fullName?: string;
      role: AuthSession["role"];
      practiceArea: string;
      isTenantAdmin: boolean;
    }
  ): Promise<InvitationSummary & { rawToken?: string }> {
    const existingAttorney = await repository.getAttorneyByEmailForTenant(session.tenantId, input.email);
    if (existingAttorney) {
      throw new Error("An attorney with this email already exists for the tenant.");
    }

    const rawToken = generateOpaqueToken("invite");
    const invitation = await repository.createInvitation({
      id: randomUUID(),
      tenantId: session.tenantId,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      practiceArea: input.practiceArea,
      isTenantAdmin: input.isTenantAdmin,
      tokenHash: hashApiKey(rawToken),
      createdBy: session.attorneyId
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "invitation.created",
      objectType: "invitation",
      objectId: invitation.id,
      metadata: {
        email: invitation.email,
        role: invitation.role
      }
    });

    await sendInvitationEmail({
      to: invitation.email,
      fullName: invitation.fullName,
      tenantName: (await repository.getDashboard(session.tenantId)).tenant?.name ?? "Legal Agent",
      inviteUrl: buildWebRedirectUrl("/", { inviteToken: rawToken })
    });

    return {
      ...invitation,
      rawToken: config.nodeEnv === "production" ? undefined : rawToken
    };
  },

  async upsertSsoProvider(
    session: AuthSession,
    input: {
      providerType: SsoProviderSummary["providerType"];
      providerName: string;
      displayName: string;
      clientId?: string;
      clientSecret?: string;
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
    }
  ): Promise<SsoProviderSummary> {
    const existingProvider = await repository.getSsoProviderByTenantAndName(
      session.tenantId,
      input.providerName
    );

    if (input.providerType === "oidc" && !input.clientSecret && !existingProvider?.client_secret) {
      throw new Error("A client secret is required when creating a new OIDC provider.");
    }

    const encryptedClientSecret =
      input.providerType === "oidc"
        ? input.clientSecret
          ? encryptSecret(input.clientSecret)
          : String(existingProvider?.client_secret ?? "")
        : "";

    const provider = await repository.upsertSsoProvider({
      id: randomUUID(),
      tenantId: session.tenantId,
      ...input,
      clientId: input.providerType === "oidc" ? String(input.clientId ?? "") : input.clientId || input.providerName,
      clientSecret: encryptedClientSecret
    });

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "sso_provider.upserted",
      objectType: "sso_provider",
      objectId: provider.id,
      metadata: {
        providerName: provider.providerName,
        enabled: provider.enabled
      }
    });

    return provider;
  },

  async getScimServiceProviderConfig() {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer Token",
          description: "Tenant-scoped SCIM bearer token",
          specUri: "https://datatracker.ietf.org/doc/html/rfc7644"
        }
      ]
    };
  },

  async getScimResourceTypes() {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      Resources: [
        {
          id: "User",
          name: "User",
          endpoint: "/Users",
          description: "Law firm attorney accounts",
          schema: "urn:ietf:params:scim:schemas:core:2.0:User"
        },
        {
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          description: "Practice groups and provisioning groups",
          schema: "urn:ietf:params:scim:schemas:core:2.0:Group"
        }
      ],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2
    };
  },

  async getScimSchemas() {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      Resources: [
        {
          id: "urn:ietf:params:scim:schemas:core:2.0:User",
          name: "User",
          description: "Core SCIM User",
          attributes: [
            { name: "userName", type: "string", multiValued: false, required: true, mutability: "readWrite" },
            { name: "displayName", type: "string", multiValued: false, required: false, mutability: "readWrite" },
            { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite" },
            { name: "emails", type: "complex", multiValued: true, required: false, mutability: "readWrite" }
          ]
        },
        {
          id: "urn:ietf:params:scim:schemas:core:2.0:Group",
          name: "Group",
          description: "Core SCIM Group",
          attributes: [
            { name: "displayName", type: "string", multiValued: false, required: true, mutability: "readWrite" },
            { name: "members", type: "complex", multiValued: true, required: false, mutability: "readWrite" }
          ]
        }
      ],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2
    };
  },

  async listScimUsers(input: {
    tenantId: string;
    startIndex: number;
    count: number;
    filter?: string;
  }) {
    const emailFilterMatch = input.filter?.match(/userName eq "([^"]+)"/i);
    const emailFilter = emailFilterMatch?.[1];
    const result = await repository.listAttorneysForScim({
      tenantId: input.tenantId,
      startIndex: input.startIndex,
      count: input.count,
      email: emailFilter
    });

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: result.totalResults,
      startIndex: input.startIndex,
      itemsPerPage: result.attorneys.length,
      Resources: result.attorneys.map((row) => buildScimUserFromRow(row))
    };
  },

  async getScimUser(tenantId: string, attorneyId: string) {
    const attorney = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!attorney) {
      throw new Error("SCIM user not found.");
    }

    return buildScimUserFromRow(attorney);
  },

  async createScimUser(
    tenantId: string,
    input: {
      userName: string;
      displayName?: string;
      name?: { formatted?: string };
      emails?: Array<{ value?: string; primary?: boolean }>;
      active?: boolean;
      role?: AuthSession["role"];
      practiceArea?: string;
      isTenantAdmin?: boolean;
    }
  ) {
    const email =
      input.userName ||
      input.emails?.find((entry) => entry.primary)?.value ||
      input.emails?.[0]?.value ||
      "";
    if (!email) {
      throw new Error("SCIM userName or email is required.");
    }

    const attorney = await repository.createAttorney({
      id: randomUUID(),
      tenantId,
      email,
      fullName: input.displayName || input.name?.formatted || email,
      role: input.role ?? "associate",
      practiceArea: input.practiceArea ?? "Corporate",
      passwordHash: await hashPassword(generateOpaqueToken("scim")),
      isTenantAdmin: Boolean(input.isTenantAdmin),
      canLogin: Boolean(input.active ?? true),
      isActive: Boolean(input.active ?? true)
    });

    const created = await repository.getAttorneyByIdForTenant(attorney.id, tenantId);
    if (!created) {
      throw new Error("SCIM user could not be created.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_created",
      objectType: "attorney",
      objectId: attorney.id,
      metadata: {
        email
      }
    });

    return buildScimUserFromRow(created);
  },

  async replaceScimUser(
    tenantId: string,
    attorneyId: string,
    input: {
      userName: string;
      displayName?: string;
      name?: { formatted?: string };
      emails?: Array<{ value?: string; primary?: boolean }>;
      active?: boolean;
      role?: AuthSession["role"];
      practiceArea?: string;
      isTenantAdmin?: boolean;
    }
  ) {
    const existing = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!existing) {
      throw new Error("SCIM user not found.");
    }

    const email =
      input.userName ||
      input.emails?.find((entry) => entry.primary)?.value ||
      input.emails?.[0]?.value ||
      String(existing.email);
    const fullName = input.displayName || input.name?.formatted || String(existing.full_name);
    await repository.updateAttorneyIdentity({
      attorneyId,
      tenantId,
      email,
      fullName,
      role: (input.role ?? existing.role) as AuthSession["role"],
      practiceArea: input.practiceArea ?? String(existing.practice_area ?? ""),
      isTenantAdmin: Boolean(input.isTenantAdmin ?? existing.is_tenant_admin),
      canLogin: Boolean(input.active ?? existing.can_login),
      isActive: Boolean(input.active ?? existing.is_active)
    });

    const updated = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!updated) {
      throw new Error("SCIM user could not be updated.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_replaced",
      objectType: "attorney",
      objectId: attorneyId
    });

    return buildScimUserFromRow(updated);
  },

  async patchScimUser(
    tenantId: string,
    attorneyId: string,
    input: {
      Operations: Array<{
        op: string;
        path?: string;
        value?: unknown;
      }>;
    }
  ) {
    const existing = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!existing) {
      throw new Error("SCIM user not found.");
    }

    let nextEmail = String(existing.email);
    let nextFullName = String(existing.full_name);
    let nextRole = String(existing.role) as AuthSession["role"];
    let nextPracticeArea = String(existing.practice_area ?? "");
    let nextIsTenantAdmin = Boolean(existing.is_tenant_admin);
    let nextCanLogin = Boolean(existing.can_login);
    let nextIsActive = Boolean(existing.is_active);

    for (const operation of input.Operations) {
      const op = operation.op.toLowerCase();
      if (!["add", "replace"].includes(op)) {
        continue;
      }

      const path = operation.path?.toLowerCase();
      if (!path) {
        const value = operation.value as Record<string, unknown> | undefined;
        if (!value) {
          continue;
        }
        if (typeof value.active === "boolean") {
          nextCanLogin = value.active;
          nextIsActive = value.active;
        }
        if (typeof value.displayName === "string") {
          nextFullName = value.displayName;
        }
        if (typeof value.userName === "string") {
          nextEmail = value.userName;
        }
        continue;
      }

      if (path === "active" && typeof operation.value === "boolean") {
        nextCanLogin = operation.value;
        nextIsActive = operation.value;
      }

      if ((path === "username" || path === "userName".toLowerCase()) && typeof operation.value === "string") {
        nextEmail = operation.value;
      }

      if ((path === "displayname" || path === "name.formatted") && typeof operation.value === "string") {
        nextFullName = operation.value;
      }
    }

    await repository.updateAttorneyIdentity({
      attorneyId,
      tenantId,
      email: nextEmail,
      fullName: nextFullName,
      role: nextRole,
      practiceArea: nextPracticeArea,
      isTenantAdmin: nextIsTenantAdmin,
      canLogin: nextCanLogin,
      isActive: nextIsActive
    });

    const updated = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!updated) {
      throw new Error("SCIM user could not be updated.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_patched",
      objectType: "attorney",
      objectId: attorneyId
    });

    return buildScimUserFromRow(updated);
  },

  async deactivateScimUser(tenantId: string, attorneyId: string) {
    const existing = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!existing) {
      throw new Error("SCIM user not found.");
    }

    await repository.updateAttorneyIdentity({
      attorneyId,
      tenantId,
      email: String(existing.email),
      fullName: String(existing.full_name),
      role: String(existing.role) as AuthSession["role"],
      practiceArea: String(existing.practice_area ?? ""),
      isTenantAdmin: Boolean(existing.is_tenant_admin),
      canLogin: false,
      isActive: false
    });
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_deactivated",
      objectType: "attorney",
      objectId: attorneyId
    });

    return { ok: true };
  },

  async listScimGroups(input: {
    tenantId: string;
    startIndex: number;
    count: number;
    filter?: string;
  }) {
    const displayNameMatch = input.filter?.match(/displayName eq "([^"]+)"/i);
    const result = await repository.listScimGroups({
      tenantId: input.tenantId,
      startIndex: input.startIndex,
      count: input.count,
      displayName: displayNameMatch?.[1]
    });

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: result.totalResults,
      startIndex: input.startIndex,
      itemsPerPage: result.groups.length,
      Resources: await Promise.all(result.groups.map((row) => buildScimGroupFromRow(row)))
    };
  },

  async getScimGroup(tenantId: string, groupId: string) {
    const group = await repository.getScimGroup(groupId, tenantId);
    if (!group) {
      throw new Error("SCIM group not found.");
    }

    return buildScimGroupFromRow(group);
  },

  async createScimGroup(
    tenantId: string,
    input: {
      displayName: string;
      externalId?: string;
      description?: string;
      members?: Array<{ value: string }>;
    }
  ) {
    const group = await repository.createScimGroup({
      id: randomUUID(),
      tenantId,
      displayName: input.displayName,
      externalId: input.externalId,
      description: input.description
    });
    if (!group) {
      throw new Error("SCIM group could not be created.");
    }

    if (input.members?.length) {
      await repository.replaceScimGroupMembers(
        String(group.id),
        tenantId,
        input.members.map((member) => member.value)
      );
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_created",
      objectType: "group",
      objectId: String(group.id)
    });

    const created = await repository.getScimGroup(String(group.id), tenantId);
    if (!created) {
      throw new Error("SCIM group could not be reloaded.");
    }

    return buildScimGroupFromRow(created);
  },

  async replaceScimGroup(
    tenantId: string,
    groupId: string,
    input: {
      displayName: string;
      externalId?: string;
      description?: string;
      members?: Array<{ value: string }>;
    }
  ) {
    const updated = await repository.updateScimGroup({
      groupId,
      tenantId,
      displayName: input.displayName,
      externalId: input.externalId,
      description: input.description
    });
    if (!updated) {
      throw new Error("SCIM group not found.");
    }

    await repository.replaceScimGroupMembers(
      groupId,
      tenantId,
      input.members?.map((member) => member.value) ?? []
    );
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_replaced",
      objectType: "group",
      objectId: groupId
    });

    return buildScimGroupFromRow(updated);
  },

  async patchScimGroup(
    tenantId: string,
    groupId: string,
    input: {
      Operations: Array<{
        op: string;
        path?: string;
        value?: unknown;
      }>;
    }
  ) {
    const existing = await repository.getScimGroup(groupId, tenantId);
    if (!existing) {
      throw new Error("SCIM group not found.");
    }

    let nextDisplayName = String(existing.display_name);
    let nextExternalId = existing.external_id ? String(existing.external_id) : undefined;
    let nextDescription = existing.description ? String(existing.description) : undefined;
    let replaceMembersWith: string[] | null = null;
    const addMembers: string[] = [];
    const removeMembers: string[] = [];

    for (const operation of input.Operations) {
      const op = operation.op.toLowerCase();
      const path = operation.path?.toLowerCase();

      if ((op === "replace" || op === "add") && (path === "displayname" || !path)) {
        const value = operation.value as string | Record<string, unknown> | undefined;
        if (typeof value === "string") {
          nextDisplayName = value;
        } else if (value && typeof value === "object" && typeof value.displayName === "string") {
          nextDisplayName = value.displayName;
        }
      }

      if ((op === "replace" || op === "add") && path === "externalid" && typeof operation.value === "string") {
        nextExternalId = operation.value;
      }

      if ((op === "replace" || op === "add") && path === "members") {
        const values = Array.isArray(operation.value) ? operation.value : [];
        const memberIds = values
          .map((entry) => (entry && typeof entry === "object" && "value" in entry ? String((entry as { value: unknown }).value) : ""))
          .filter(Boolean);
        if (op === "replace") {
          replaceMembersWith = memberIds;
        } else {
          addMembers.push(...memberIds);
        }
      }

      if (op === "remove" && path === "members") {
        const values = Array.isArray(operation.value) ? operation.value : [];
        removeMembers.push(
          ...values
            .map((entry) =>
              entry && typeof entry === "object" && "value" in entry
                ? String((entry as { value: unknown }).value)
                : ""
            )
            .filter(Boolean)
        );
      }
    }

    const updated = await repository.updateScimGroup({
      groupId,
      tenantId,
      displayName: nextDisplayName,
      externalId: nextExternalId,
      description: nextDescription
    });
    if (!updated) {
      throw new Error("SCIM group not found.");
    }

    if (replaceMembersWith) {
      await repository.replaceScimGroupMembers(groupId, tenantId, replaceMembersWith);
    } else {
      if (addMembers.length > 0) {
        await repository.addScimGroupMembers(groupId, tenantId, addMembers);
      }
      if (removeMembers.length > 0) {
        await repository.removeScimGroupMembers(groupId, removeMembers);
      }
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_patched",
      objectType: "group",
      objectId: groupId
    });

    const reloaded = await repository.getScimGroup(groupId, tenantId);
    if (!reloaded) {
      throw new Error("SCIM group could not be reloaded.");
    }

    return buildScimGroupFromRow(reloaded);
  },

  async deleteScimGroup(tenantId: string, groupId: string) {
    const deleted = await repository.deleteScimGroup(groupId, tenantId);
    if (!deleted) {
      throw new Error("SCIM group not found.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_deleted",
      objectType: "group",
      objectId: groupId
    });

    return { ok: true };
  },

  async listTenants() {
    return repository.listTenants();
  },

  async createTenant(input: {
    name: string;
    region: string;
    plan: string;
    adminEmail: string;
    adminFullName: string;
    adminPassword: string;
  }) {
    const tenantId = randomUUID();
    const attorneyId = randomUUID();
    const passwordHash = await hashPassword(input.adminPassword);
    const rawKey = generateRawApiKey();

    return withTransaction(async () => {
      const tenant = await repository.createTenant({
        id: tenantId,
        name: input.name,
        region: input.region,
        plan: input.plan
      });

      const attorney = await repository.createAttorney({
        id: attorneyId,
        tenantId,
        email: input.adminEmail,
        fullName: input.adminFullName,
        role: "admin",
        practiceArea: "Firm Administration",
        passwordHash,
        isTenantAdmin: true
      });

      const apiKey = await repository.createApiKey({
        id: randomUUID(),
        tenantId,
        attorneyId,
        name: "Initial Tenant Key",
        keyPrefix: getApiKeyPrefix(rawKey),
        keyHash: hashApiKey(rawKey),
        role: "admin"
      });

      return {
        tenant,
        attorney,
        apiKey: {
          ...apiKey,
          rawKey
        }
      };
    });
  }
};
