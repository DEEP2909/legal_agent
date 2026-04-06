import type { ApiKeySummary, AuthSession, InvitationSummary, ScimTokenSummary, SsoProviderSummary } from "@legal-agent/shared";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { sendInvitationEmail } from "../email.js";
import { repository } from "../repository.js";
import {
  encryptSecret,
  generateOpaqueToken,
  generateRawApiKey,
  getApiKeyPrefix,
  hashApiKey,
  hashPassword
} from "../security.js";
import { authService } from "./auth.service.js";
import { buildWebRedirectUrl } from "./shared.js";

export const adminService = {
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
      apiKeys: apiKeys.items,
      invitations: invitations.items,
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
    // Create attorney with login disabled - they must complete password reset flow
    // This ensures email ownership is verified before account becomes active
    const attorney = await repository.createAttorney({
      id: randomUUID(),
      tenantId: session.tenantId,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      practiceArea: input.practiceArea,
      passwordHash: await hashPassword(input.password),
      isTenantAdmin: input.isTenantAdmin,
      canLogin: false,           // Cannot login until password reset
      mustResetPassword: true    // Must reset password to verify email
    });

    // Send password reset email to verify email ownership
    await authService.forgotPassword({ email: input.email, tenantId: session.tenantId });

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

    // Fire-and-forget email with error logging - API returns success regardless of email delivery
    sendInvitationEmail({
      to: invitation.email,
      fullName: invitation.fullName,
      tenantName: (await repository.getDashboard(session.tenantId)).tenant?.name ?? "Legal Agent",
      inviteUrl: buildWebRedirectUrl("/", { inviteToken: rawToken })
    }).catch((err) => {
      console.error("[email] Failed to send invitation email:", err);
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

};


