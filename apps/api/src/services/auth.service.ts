import type { AuthSession, LoginResponse, MfaMethod, MfaSetupResponse, MfaStatus, PasskeySummary } from "@legal-agent/shared";
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
import { config } from "../config.js";
import { sendPasswordResetEmail } from "../email.js";
import { repository } from "../repository.js";
import {
  buildSamlAuthorizeUrl,
  buildSamlLogoutResponseUrl,
  buildSamlLogoutUrl,
  generateSamlMetadata,
  validateSamlPostResponse,
  validateSamlRedirect
} from "../saml.js";
import { buildAuthorizationUrl, exchangeAuthorizationCode, fetchUserInfo, verifyIdToken } from "../sso.js";
import {
  decryptSecret,
  encryptSecret,
  fromBase64Url,
  generateOpaqueToken,
  generatePkcePair,
  generateRecoveryCodes,
  hashApiKey,
  hashRecoveryCode,
  hashPassword,
  toBase64Url,
  verifyPassword
} from "../security.js";
import { withTransaction } from "../transaction.js";
import {
  buildFederatedRedirect,
  buildLoginSuccessResponse,
  buildMfaChallengeResponse,
  buildWebRedirectUrl,
  getAvailableMfaMethods,
  getRecoveryCodeHashes,
  getTotpForAttorney,
  normalizeRedirectPath,
  resolveAttorneyForFederatedIdentity,
  toProviderConfig,
  toSamlProviderConfig
} from "./shared.js";

export const authService = {
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
    // Fire-and-forget email with error logging - API returns success regardless of email delivery
    sendPasswordResetEmail({
      to: String(attorney.email),
      fullName: String(attorney.full_name ?? attorney.email),
      tenantName: "Legal Agent Workspace",
      resetUrl
    }).catch((err) => {
      console.error("[email] Failed to send password reset email:", err);
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

    const providerRecord = await repository.getSsoProviderById(
      String(stateRecord.provider_id),
      String(stateRecord.tenant_id)
    );
    if (!providerRecord) {
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

    const providerRecord = await repository.getSsoProviderById(
      String(relayStateRecord.provider_id),
      String(relayStateRecord.tenant_id)
    );
    if (!providerRecord) {
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
};


