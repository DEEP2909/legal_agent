import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import client from "prom-client";
import {
  requireAuth,
  requirePlatformAdmin,
  requireRole,
  requireScimAuth,
  requireTenantAdmin
} from "./auth.js";
import { config } from "./config.js";
import { checkDatabaseConnection } from "./database.js";
import { checkEmailHealth } from "./email.js";
import { legalWorkflowService } from "./services.js";
import { checkMalwareHealth } from "./malware.js";
import { checkStorageHealth, persistUpload } from "./storage.js";
import { repository } from "./repository.js";
import { PASSWORD_RULES, validatePassword as sharedValidatePassword } from "@legal-agent/shared";

// Prometheus metrics registry
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

// Active requests gauge
const activeRequests = new client.Gauge({
  name: "http_requests_active",
  help: "Number of active HTTP requests",
  registers: [register]
});

// Document ingestion counter
const documentsIngested = new client.Counter({
  name: "documents_ingested_total",
  help: "Total number of documents ingested",
  labelNames: ["status"],
  registers: [register]
});

// Export metrics for use in other modules if needed
export { httpRequestDuration, activeRequests, documentsIngested };

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/json",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp"
]);

// Password complexity validation schema (uses centralized rules from shared package)
const passwordSchema = z
  .string()
  .min(PASSWORD_RULES.minLength, `Password must be at least ${PASSWORD_RULES.minLength} characters`)
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

function readFieldValue(field: unknown) {
  if (field && typeof field === "object" && "value" in field) {
    return String((field as { value: unknown }).value ?? "");
  }

  return "";
}

// Stricter rate limiting for auth endpoints
const authRateLimit = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: "1 minute",
      ban: 3
    }
  }
};

// Rate limiting for admin token/key creation endpoints
const adminTokenRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute"
    }
  }
};

// Very strict rate limiting for platform admin
const platformAdminRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "5 minutes"
    }
  }
};

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health/live", async () => ({ ok: true }));
  app.get("/health/ready", async (_request, reply) => {
    // Check each dependency individually and report structured status
    const status: Record<string, "ok" | "fail"> = {
      db: "ok",
      storage: "ok",
      email: "ok",
      malware: "ok"
    };
    let hasFailure = false;

    try {
      await checkDatabaseConnection();
    } catch {
      status.db = "fail";
      hasFailure = true;
    }

    try {
      await checkStorageHealth();
    } catch {
      status.storage = "fail";
      hasFailure = true;
    }

    try {
      await checkEmailHealth();
    } catch {
      status.email = "fail";
      hasFailure = true;
    }

    try {
      await checkMalwareHealth();
    } catch {
      status.malware = "fail";
      hasFailure = true;
    }

    if (hasFailure) {
      reply.code(503);
    }
    return { ok: !hasFailure, ...status };
  });

  // Prometheus metrics endpoint - requires platform admin auth
  app.get("/metrics", { 
    logLevel: "silent",
    preHandler: requirePlatformAdmin
  }, async (_request, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });

  // Instrument all requests with metrics
  app.addHook("onRequest", async () => {
    activeRequests.inc();
  });

  app.addHook("onResponse", async (request, reply) => {
    activeRequests.dec();
    const route = request.routeOptions?.url ?? request.url;
    httpRequestDuration.observe(
      { method: request.method, route, status: reply.statusCode },
      reply.elapsedTime / 1000
    );
  });

  // CSRF token endpoint - client should call this before login
  app.get("/auth/csrf-token", async (request, reply) => {
    const token = await reply.generateCsrf();
    return { csrfToken: token };
  });

  // Login with CSRF protection
  app.post("/auth/login", { 
    ...authRateLimit, 
    preHandler: app.csrfProtection 
  }, async (request, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(12),
        tenantId: z.string().min(1, "Tenant ID is required")
      })
      .parse(request.body);

    const result = await legalWorkflowService.login(body);
    
    // If login successful and we have an access token (not MFA challenge), set it as httpOnly cookie
    if ("accessToken" in result && result.accessToken) {
      const isProduction = config.nodeEnv === "production";
      reply.setCookie("accessToken", result.accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 60 * 60 // 8 hours in seconds
      });
      
      // Issue refresh token for session persistence
      if (result.session) {
        const { createRefreshToken, getRefreshTokenTTLDays } = await import("./auth.js");
        const { hashApiKey: hashToken } = await import("./security.js");
        const refreshToken = createRefreshToken();
        
        reply.setCookie("refreshToken", refreshToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: "strict",
          path: "/auth/refresh",
          maxAge: getRefreshTokenTTLDays() * 24 * 60 * 60
        });
        
        // Store refresh token hash in database
        await repository.createRefreshToken(
          result.session.tenantId,
          result.session.attorneyId,
          hashToken(refreshToken),
          getRefreshTokenTTLDays()
        );
      }
    }
    
    return result;
  });

  app.post("/auth/passkey/options", authRateLimit, async (request) => {
    const body = z
      .object({
        tenantId: z.string().min(2),
        email: z.string().email()
      })
      .parse(request.body);

    return legalWorkflowService.beginPasswordlessPasskeyLogin(body);
  });

  app.post("/auth/passkey/verify", authRateLimit, async (request) => {
    const body = z
      .object({
        tenantId: z.string().min(2),
        email: z.string().email(),
        challengeId: z.string().uuid(),
        response: z.unknown()
      })
      .parse(request.body);

    return legalWorkflowService.finishPasswordlessPasskeyLogin({
      tenantId: body.tenantId,
      email: body.email,
      challengeId: body.challengeId,
      response: body.response as Parameters<typeof legalWorkflowService.finishPasswordlessPasskeyLogin>[0]["response"]
    });
  });

  app.post("/auth/mfa/verify", authRateLimit, async (request) => {
    const body = z
      .object({
        challengeToken: z.string().min(10),
        token: z.string().trim().min(6).optional(),
        recoveryCode: z.string().trim().min(6).optional()
      })
      .superRefine((value, ctx) => {
        if (!value.token && !value.recoveryCode) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Either token or recoveryCode is required."
          });
        }
      })
      .parse(request.body);

    return legalWorkflowService.verifyMfaChallenge(body);
  });

  app.post("/auth/mfa/webauthn/options", authRateLimit, async (request) => {
    const body = z.object({ challengeToken: z.string().min(10) }).parse(request.body);
    return legalWorkflowService.beginMfaPasskeyAuthentication(body);
  });

  app.post("/auth/mfa/webauthn/verify", authRateLimit, async (request) => {
    const body = z
      .object({
        challengeToken: z.string().min(10),
        challengeId: z.string().uuid(),
        response: z.unknown()
      })
      .parse(request.body);

    return legalWorkflowService.finishMfaPasskeyAuthentication({
      challengeToken: body.challengeToken,
      challengeId: body.challengeId,
      response: body.response as Parameters<
        typeof legalWorkflowService.finishMfaPasskeyAuthentication
      >[0]["response"]
    });
  });

  app.post("/auth/forgot-password", authRateLimit, async (request) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);
    return legalWorkflowService.forgotPassword(body);
  });

  app.post("/auth/reset-password", authRateLimit, async (request) => {
    const body = z
      .object({
        token: z.string().min(10),
        password: passwordSchema
      })
      .parse(request.body);

    return legalWorkflowService.resetPassword(body);
  });

  app.post("/auth/invitations/accept", authRateLimit, async (request) => {
    const body = z
      .object({
        token: z.string().min(10),
        password: passwordSchema,
        fullName: z.string().min(2).optional()
      })
      .parse(request.body);

    return legalWorkflowService.acceptInvitation(body);
  });

  app.post("/auth/exchange", authRateLimit, async (request) => {
    const body = z.object({ code: z.string().min(10) }).parse(request.body);
    return legalWorkflowService.exchangeBrowserAuthCode(body);
  });

  // Rate limit SSO provider lookup to prevent tenant enumeration
  app.get("/auth/sso/providers", authRateLimit, async (request) => {
    const query = z.object({ tenantId: z.string() }).parse(request.query);
    return legalWorkflowService.getPublicSsoProviders(query.tenantId);
  });

  app.get("/auth/sso/saml/metadata", authRateLimit, async (request, reply) => {
    const query = z
      .object({
        tenantId: z.string(),
        providerName: z.string()
      })
      .parse(request.query);

    const metadata = await legalWorkflowService.getSamlMetadata(query.tenantId, query.providerName);
    reply.type("text/xml; charset=utf-8");
    return metadata;
  });

  app.get("/auth/sso/start", async (request, reply) => {
    const query = z
      .object({
        tenantId: z.string(),
        providerName: z.string(),
        redirectPath: z.string().optional()
      })
      .parse(request.query);

    const result = await legalWorkflowService.startSsoLogin(query);
    reply.redirect(result.authorizationUrl);
  });

  app.get("/auth/sso/callback", async (request, reply) => {
    const query = z
      .object({
        state: z.string().optional(),
        code: z.string().optional(),
        error: z.string().optional()
      })
      .parse(request.query);

    if (query.error) {
      reply.redirect(`${config.webAppUrl}/?authError=${encodeURIComponent(query.error)}`);
      return;
    }

    if (!query.state || !query.code) {
      reply.code(400);
      return { error: "Missing SSO callback parameters" };
    }

    const result = await legalWorkflowService.handleSsoCallback({
      state: query.state,
      code: query.code
    });
    reply.redirect(result.redirectUrl);
  });

  app.post("/auth/sso/saml/acs", async (request, reply) => {
    const body = z
      .object({
        SAMLResponse: z.string().min(10),
        RelayState: z.string().min(10)
      })
      .parse(request.body);

    const result = await legalWorkflowService.handleSamlAcs({
      samlResponse: body.SAMLResponse,
      relayState: body.RelayState
    });
    reply.redirect(result.redirectUrl);
  });

  app.get("/auth/sso/saml/logout/callback", async (request, reply) => {
    const query = z
      .object({
        tenantId: z.string(),
        providerName: z.string(),
        RelayState: z.string().optional(),
        SAMLRequest: z.string().optional(),
        SAMLResponse: z.string().optional()
      })
      .parse(request.query);

    const originalQuery = request.raw.url?.split("?")[1] ?? "";
    const result = await legalWorkflowService.handleSamlLogoutCallback({
      tenantId: query.tenantId,
      providerName: query.providerName,
      relayState: query.RelayState,
      query,
      originalQuery
    });
    reply.redirect(result.redirectUrl);
  });

  app.register(async (platformApp) => {
    platformApp.addHook("preHandler", requirePlatformAdmin);

    platformApp.get("/api/platform/tenants", platformAdminRateLimit, async (request) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().max(512).optional()
        })
        .parse(request.query);

      return legalWorkflowService.listTenants(query);
    });

    platformApp.post("/api/platform/tenants", platformAdminRateLimit, async (request) => {
      const body = z
        .object({
          name: z.string().min(2),
          region: z.string().min(2),
          plan: z.string().min(2),
          adminEmail: z.string().email(),
          adminFullName: z.string().min(2),
          adminPassword: passwordSchema
        })
        .parse(request.body);

      return legalWorkflowService.createTenant(body);
    });
  });

  app.register(async (scimApp) => {
    scimApp.addHook("preHandler", requireScimAuth);
    
    // Validate SCIM tenant context is present
    scimApp.addHook("preHandler", async (request, reply) => {
      if (!request.scimTenantId) {
        reply
          .code(401)
          .send({ 
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            detail: "Missing tenant context",
            status: "401"
          });
        return;
      }
    });
    
    scimApp.addHook("onSend", async (_request, reply, payload) => {
      reply.type("application/scim+json; charset=utf-8");
      return payload;
    });

    scimApp.get("/scim/v2/ServiceProviderConfig", async () =>
      legalWorkflowService.getScimServiceProviderConfig()
    );

    scimApp.get("/scim/v2/ResourceTypes", async () => legalWorkflowService.getScimResourceTypes());

    scimApp.get("/scim/v2/Schemas", async () => legalWorkflowService.getScimSchemas());

    scimApp.get("/scim/v2/Users", async (request, reply) => {
      if (!request.scimTenantId) {
        reply.code(401).send({ detail: "Missing tenant context" });
        return;
      }
      
      const query = z
        .object({
          startIndex: z.coerce.number().int().min(1).default(1),
          count: z.coerce.number().int().min(1).max(200).default(50),
          filter: z.string().max(200).optional()
        })
        .parse(request.query);

      return legalWorkflowService.listScimUsers({
        tenantId: request.scimTenantId,
        startIndex: query.startIndex,
        count: query.count,
        filter: query.filter
      });
    });

    scimApp.get("/scim/v2/Groups", async (request, reply) => {
      if (!request.scimTenantId) {
        reply.code(401).send({ detail: "Missing tenant context" });
        return;
      }
      
      const query = z
        .object({
          startIndex: z.coerce.number().int().min(1).default(1),
          count: z.coerce.number().int().min(1).max(200).default(50),
          filter: z.string().max(200).optional()
        })
        .parse(request.query);

      return legalWorkflowService.listScimGroups({
        tenantId: request.scimTenantId,
        startIndex: query.startIndex,
        count: query.count,
        filter: query.filter
      });
    });

    scimApp.post("/scim/v2/Groups", async (request, reply) => {
      if (!request.scimTenantId) {
        reply.code(401).send({ detail: "Missing tenant context" });
        return;
      }
      
      const body = z
        .object({
          displayName: z.string().min(1),
          externalId: z.string().optional(),
          description: z.string().optional(),
          members: z.array(z.object({ value: z.string() })).optional()
        })
        .parse(request.body);

      const created = await legalWorkflowService.createScimGroup(request.scimTenantId!, body);
      reply.code(201);
      return created;
    });

    scimApp.post("/scim/v2/Users", async (request, reply) => {
      const body = z
        .object({
          userName: z.string().email(),
          displayName: z.string().optional(),
          name: z.object({ formatted: z.string().optional() }).optional(),
          emails: z.array(z.object({ value: z.string().email().optional(), primary: z.boolean().optional() })).optional(),
          active: z.boolean().optional(),
          role: z.enum(["partner", "associate", "paralegal", "admin"]).optional(),
          practiceArea: z.string().optional(),
          isTenantAdmin: z.boolean().optional()
        })
        .strict()
        .parse(request.body);

      const created = await legalWorkflowService.createScimUser(request.scimTenantId!, body);
      reply.code(201);
      return created;
    });

    scimApp.get("/scim/v2/Users/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      return legalWorkflowService.getScimUser(request.scimTenantId!, params.id);
    });

    scimApp.put("/scim/v2/Users/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          userName: z.string().email(),
          displayName: z.string().optional(),
          name: z.object({ formatted: z.string().optional() }).optional(),
          emails: z.array(z.object({ value: z.string().email().optional(), primary: z.boolean().optional() })).optional(),
          active: z.boolean().optional(),
          role: z.enum(["partner", "associate", "paralegal", "admin"]).optional(),
          practiceArea: z.string().optional(),
          isTenantAdmin: z.boolean().optional()
        })
        .strict()
        .parse(request.body);

      return legalWorkflowService.replaceScimUser(request.scimTenantId!, params.id, body);
    });

    scimApp.patch("/scim/v2/Users/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          Operations: z.array(
            z.object({
              op: z.string().min(2),
              path: z.string().optional(),
              value: z.unknown().optional()
            })
          )
        })
        .parse(request.body);

      return legalWorkflowService.patchScimUser(request.scimTenantId!, params.id, body);
    });

    scimApp.delete("/scim/v2/Users/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      await legalWorkflowService.deactivateScimUser(request.scimTenantId!, params.id);
      return {};
    });

    scimApp.get("/scim/v2/Groups/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      return legalWorkflowService.getScimGroup(request.scimTenantId!, params.id);
    });

    scimApp.put("/scim/v2/Groups/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          displayName: z.string().min(1),
          externalId: z.string().optional(),
          description: z.string().optional(),
          members: z.array(z.object({ value: z.string() })).optional()
        })
        .strict()
        .parse(request.body);

      return legalWorkflowService.replaceScimGroup(request.scimTenantId!, params.id, body);
    });

    scimApp.patch("/scim/v2/Groups/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          Operations: z.array(
            z.object({
              op: z.string().min(2),
              path: z.string().optional(),
              value: z.unknown().optional()
            })
          )
        })
        .parse(request.body);

      return legalWorkflowService.patchScimGroup(request.scimTenantId!, params.id, body);
    });

    scimApp.delete("/scim/v2/Groups/:id", async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      await legalWorkflowService.deleteScimGroup(request.scimTenantId!, params.id);
      return {};
    });
  });

  // Token refresh endpoint - uses refresh cookie, not access token
  app.post("/auth/refresh", authRateLimit, async (request, reply) => {
    const raw = request.cookies.refreshToken;
    if (!raw) {
      return reply.code(401).send({ error: "No refresh token" });
    }

    const { hashApiKey: hashToken } = await import("./security.js");
    const tokenHash = hashToken(raw);
    const session = await repository.validateAndRotateRefreshToken(tokenHash);
    
    if (!session) {
      // Clear invalid refresh cookie
      reply.clearCookie("refreshToken", {
        httpOnly: true,
        secure: config.nodeEnv === "production",
        sameSite: "strict",
        path: "/auth/refresh"
      });
      return reply.code(401).send({ error: "Invalid or expired refresh token" });
    }

    // Get full session data
    const fullSession = await repository.getAttorneySession(session.attorneyId);
    if (!fullSession) {
      return reply.code(401).send({ error: "Session no longer valid" });
    }

    // Issue new tokens
    const { issueTokens, getRefreshTokenTTLDays } = await import("./auth.js");
    const { refreshToken: newRefreshToken } = issueTokens(reply, fullSession);
    
    // Store new refresh token
    await repository.createRefreshToken(
      session.tenantId,
      session.attorneyId,
      hashToken(newRefreshToken),
      getRefreshTokenTTLDays()
    );

    return { ok: true };
  });

  app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", requireAuth);

    protectedApp.get("/auth/me", async (request) => legalWorkflowService.me(request.authSession));

    // Logout endpoint - clears httpOnly cookie and revokes refresh tokens
    protectedApp.post("/auth/logout", async (request, reply) => {
      const isProduction = config.nodeEnv === "production";
      
      // Clear access token cookie
      reply.clearCookie("accessToken", {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        path: "/"
      });
      
      // Clear refresh token cookie
      reply.clearCookie("refreshToken", {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        path: "/auth/refresh"
      });
      
      // Revoke all refresh tokens for this user
      await repository.revokeAllRefreshTokens(request.authSession.attorneyId);
      
      await repository.recordAuditEvent({
        id: randomUUID(),
        tenantId: request.authSession.tenantId,
        actorAttorneyId: request.authSession.attorneyId,
        eventType: "auth.logout",
        objectType: "attorney",
        objectId: request.authSession.attorneyId
      });
      
      return { ok: true };
    });

    protectedApp.post("/auth/sso/saml/logout", async (request) => {
      const body = z
        .object({
          providerName: z.string().optional(),
          redirectPath: z.string().optional()
        })
        .parse(request.body);

      return legalWorkflowService.startSamlLogout(request.authSession, body);
    });

    protectedApp.get("/api/security/mfa", async (request) =>
      legalWorkflowService.getMfaStatus(request.authSession)
    );

    protectedApp.post("/api/security/mfa/setup", async (request) =>
      legalWorkflowService.beginMfaEnrollment(request.authSession)
    );

    protectedApp.post("/api/security/mfa/confirm", async (request) => {
      const body = z.object({ token: z.string().trim().min(6) }).parse(request.body);
      return legalWorkflowService.confirmMfaEnrollment(request.authSession, body);
    });

    protectedApp.post("/api/security/mfa/disable", async (request) => {
      const body = z
        .object({
          token: z.string().trim().min(6).optional(),
          recoveryCode: z.string().trim().min(6).optional()
        })
        .superRefine((value, ctx) => {
          if (!value.token && !value.recoveryCode) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Either token or recoveryCode is required."
            });
          }
        })
        .parse(request.body);

      return legalWorkflowService.disableMfa(request.authSession, body);
    });

    protectedApp.get("/api/security/passkeys", async (request) =>
      legalWorkflowService.listPasskeys(request.authSession)
    );

    protectedApp.post("/api/security/passkeys/register/options", async (request) => {
      const body = z.object({ label: z.string().trim().min(1).max(120).optional() }).parse(request.body);
      return legalWorkflowService.beginPasskeyRegistration(request.authSession, body);
    });

    protectedApp.post("/api/security/passkeys/register/verify", async (request) => {
      const body = z
        .object({
          challengeId: z.string().uuid(),
          label: z.string().trim().min(1).max(120).optional(),
          response: z.unknown()
        })
        .parse(request.body);

      return legalWorkflowService.finishPasskeyRegistration(request.authSession, {
        challengeId: body.challengeId,
        label: body.label,
        response: body.response as Parameters<typeof legalWorkflowService.finishPasskeyRegistration>[1]["response"]
      });
    });

    protectedApp.delete("/api/security/passkeys/:passkeyId", async (request) => {
      const params = z.object({ passkeyId: z.string().uuid() }).parse(request.params);
      return legalWorkflowService.deletePasskey(request.authSession, params.passkeyId);
    });

    protectedApp.get("/api/dashboard", async (request) =>
      legalWorkflowService.dashboard(request.authSession)
    );

    protectedApp.get("/api/matters/:matterId/documents", async (request) => {
      const params = z.object({ matterId: z.string().uuid() }).parse(request.params);
      return legalWorkflowService.listMatterDocuments(request.authSession, params.matterId);
    });

    protectedApp.get("/api/admin/tenant", { preHandler: requireTenantAdmin }, async (request) =>
      legalWorkflowService.getTenantAdminSnapshot(request.authSession)
    );

    protectedApp.patch("/api/admin/tenant", { preHandler: requireTenantAdmin }, async (request) => {
      const body = z
        .object({
          name: z.string().min(2),
          region: z.string().min(2),
          plan: z.string().min(2)
        })
        .parse(request.body);

      return legalWorkflowService.updateTenant(request.authSession, body);
    });

    protectedApp.post("/api/admin/attorneys", { preHandler: requireTenantAdmin }, async (request) => {
      const body = z
        .object({
          email: z.string().email(),
          fullName: z.string().min(2).max(200),
          role: z.enum(["partner", "associate", "paralegal", "admin"]),
          practiceArea: z.string().min(2).max(100),
          password: passwordSchema,
          isTenantAdmin: z.boolean().default(false)
        })
        .parse(request.body);

      return legalWorkflowService.createAttorney(request.authSession, body);
    });

    protectedApp.post(
      "/api/admin/api-keys",
      { preHandler: requireTenantAdmin, ...adminTokenRateLimit },
      async (request) => {
        const body = z
          .object({
            attorneyId: z.string().uuid(),
            name: z.string().min(2).max(100),
            role: z.enum(["partner", "associate", "paralegal", "admin"])
          })
          .parse(request.body);

        return legalWorkflowService.createApiKey(request.authSession, body);
      }
    );

    protectedApp.post(
      "/api/admin/scim/tokens",
      { preHandler: requireTenantAdmin, ...adminTokenRateLimit },
      async (request) => {
        const body = z.object({ name: z.string().min(2).max(100) }).parse(request.body);
        return legalWorkflowService.createScimToken(request.authSession, body);
      }
    );

    protectedApp.post(
      "/api/admin/invitations",
      { preHandler: requireTenantAdmin },
      async (request) => {
        const body = z
          .object({
            email: z.string().email(),
            fullName: z.string().min(2).optional(),
            role: z.enum(["partner", "associate", "paralegal", "admin"]),
            practiceArea: z.string().min(2),
            isTenantAdmin: z.boolean().default(false)
          })
          .parse(request.body);

        return legalWorkflowService.createInvitation(request.authSession, body);
      }
    );

    protectedApp.put(
      "/api/admin/sso-providers",
      { preHandler: requireTenantAdmin },
      async (request) => {
        const body = z
          .object({
            providerType: z.enum(["oidc", "saml"]).default("oidc"),
            providerName: z.string().min(2),
            displayName: z.string().min(2),
            clientId: z.string().optional().or(z.literal("")),
            clientSecret: z.string().optional().or(z.literal("")),
            issuerUrl: z.string().url().optional().or(z.literal("")),
            jwksUri: z.string().url().optional().or(z.literal("")),
            authorizationEndpoint: z.string().url().optional().or(z.literal("")),
            tokenEndpoint: z.string().url().optional().or(z.literal("")),
            userinfoEndpoint: z.string().url().optional().or(z.literal("")),
            entityId: z.string().optional().or(z.literal("")),
            ssoUrl: z.string().url().optional().or(z.literal("")),
            sloUrl: z.string().url().optional().or(z.literal("")),
            x509Cert: z.string().optional().or(z.literal("")),
            nameIdFormat: z.string().optional().or(z.literal("")),
            scopes: z.string().min(2).default("openid profile email"),
            enabled: z.boolean()
          })
          .superRefine((value, ctx) => {
            if (value.providerType === "oidc") {
              if (!value.clientId) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: "clientId is required for OIDC providers.",
                  path: ["clientId"]
                });
              }
            }

            if (value.providerType === "saml") {
              if (!value.ssoUrl) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: "ssoUrl is required for SAML providers.",
                  path: ["ssoUrl"]
                });
              }
              if (!value.x509Cert) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: "x509Cert is required for SAML providers.",
                  path: ["x509Cert"]
                });
              }
            }
          })
          .transform((value) => ({
            ...value,
            clientId: value.clientId || undefined,
            clientSecret: value.clientSecret || undefined,
            issuerUrl: value.issuerUrl || undefined,
            jwksUri: value.jwksUri || undefined,
            authorizationEndpoint: value.authorizationEndpoint || undefined,
            tokenEndpoint: value.tokenEndpoint || undefined,
            userinfoEndpoint: value.userinfoEndpoint || undefined,
            entityId: value.entityId || undefined,
            ssoUrl: value.ssoUrl || undefined,
            sloUrl: value.sloUrl || undefined,
            x509Cert: value.x509Cert || undefined,
            nameIdFormat: value.nameIdFormat || undefined
          }))
          .parse(request.body);

        return legalWorkflowService.upsertSsoProvider(request.authSession, body);
      }
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Playbook Management Routes
    // ──────────────────────────────────────────────────────────────────────────

    protectedApp.get(
      "/api/admin/playbooks",
      { preHandler: requireTenantAdmin },
      async (request) => {
        return repository.getPlaybooks(request.authSession.tenantId);
      }
    );

    protectedApp.get(
      "/api/admin/playbooks/:id",
      { preHandler: requireTenantAdmin },
      async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const playbook = await repository.getPlaybookById(id, request.authSession.tenantId);
        if (!playbook) {
          reply.code(404);
          return { error: "Playbook not found" };
        }
        return playbook;
      }
    );

    protectedApp.post(
      "/api/admin/playbooks",
      { preHandler: requireTenantAdmin },
      async (request, reply) => {
        const body = z.object({
          name: z.string().min(2, "Name must be at least 2 characters"),
          description: z.string().optional(),
          rules: z.array(z.string().min(5, "Each rule must be at least 5 characters"))
            .min(1, "At least one rule is required")
            .max(50, "Maximum 50 rules allowed"),
          isActive: z.boolean().default(false)
        }).parse(request.body);

        const id = randomUUID();
        await repository.createPlaybook({
          id,
          tenantId: request.authSession.tenantId,
          name: body.name,
          description: body.description,
          rules: body.rules,
          isActive: body.isActive,
          createdBy: request.authSession.attorneyId
        });

        await repository.recordAuditEvent({
          id: randomUUID(),
          tenantId: request.authSession.tenantId,
          actorAttorneyId: request.authSession.attorneyId,
          eventType: "playbook.created",
          objectType: "playbook",
          objectId: id,
          metadata: { name: body.name, ruleCount: body.rules.length, isActive: body.isActive }
        });

        reply.code(201);
        return repository.getPlaybookById(id, request.authSession.tenantId);
      }
    );

    protectedApp.patch(
      "/api/admin/playbooks/:id",
      { preHandler: requireTenantAdmin },
      async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z.object({
          name: z.string().min(2).optional(),
          description: z.string().optional(),
          rules: z.array(z.string().min(5))
            .min(1)
            .max(50)
            .optional(),
          isActive: z.boolean().optional()
        }).parse(request.body);

        const existing = await repository.getPlaybookById(id, request.authSession.tenantId);
        if (!existing) {
          reply.code(404);
          return { error: "Playbook not found" };
        }

        const updated = await repository.updatePlaybook({
          id,
          tenantId: request.authSession.tenantId,
          ...body
        });

        if (updated) {
          await repository.recordAuditEvent({
            id: randomUUID(),
            tenantId: request.authSession.tenantId,
            actorAttorneyId: request.authSession.attorneyId,
            eventType: "playbook.updated",
            objectType: "playbook",
            objectId: id,
            metadata: { changes: Object.keys(body) }
          });
        }

        return repository.getPlaybookById(id, request.authSession.tenantId);
      }
    );

    protectedApp.delete(
      "/api/admin/playbooks/:id",
      { preHandler: requireTenantAdmin },
      async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

        const existing = await repository.getPlaybookById(id, request.authSession.tenantId);
        if (!existing) {
          reply.code(404);
          return { error: "Playbook not found" };
        }

        await repository.deletePlaybook(id, request.authSession.tenantId);

        await repository.recordAuditEvent({
          id: randomUUID(),
          tenantId: request.authSession.tenantId,
          actorAttorneyId: request.authSession.attorneyId,
          eventType: "playbook.deleted",
          objectType: "playbook",
          objectId: id,
          metadata: { name: existing.name }
        });

        return { success: true };
      }
    );

    // Upload/ingest endpoints rate-limited to prevent abuse and quota exhaustion
    const uploadRateLimitConfig = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

    protectedApp.post(
      "/api/documents/ingest",
      {
        ...uploadRateLimitConfig,
        preHandler: requireRole(["partner", "associate", "paralegal", "admin"])
      },
      async (request, reply) => {
        const body = z
          .object({
            matterId: z.string().uuid(),
            sourceName: z.string(),
            mimeType: z.string(),
            docType: z.string(),
            normalizedText: z.string().min(1)
          })
          .parse(request.body);

        const sha256 = createHash("sha256").update(body.normalizedText).digest("hex");
        const document = await legalWorkflowService.ingestDocument(request.authSession, {
          ...body,
          sha256
        });
        reply.code(201);
        return document;
      }
    );

    protectedApp.post(
      "/api/documents/upload",
      {
        ...uploadRateLimitConfig,
        preHandler: requireRole(["partner", "associate", "paralegal", "admin"])
      },
      async (request, reply) => {
        const file = await request.file();
        if (!file) {
          reply.code(400);
          return { error: "File is required" };
        }

        // Buffer the file to validate magic bytes (actual content, not just header)
        const buffer = await file.toBuffer();
        const detected = await fileTypeFromBuffer(buffer);
        // For text files that have no magic bytes, fall back to declared MIME type
        const detectedMime = detected?.mime ?? (file.mimetype === "text/plain" ? "text/plain" : "application/octet-stream");

        if (!allowedMimeTypes.has(detectedMime)) {
          reply.code(400);
          return { error: "Unsupported or mismatched file type" };
        }

        const fields = {
          matterId: readFieldValue(file.fields.matterId),
          docType: readFieldValue(file.fields.docType) || "Uploaded Document",
          normalizedText: readFieldValue(file.fields.normalizedText)
        };

        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const { storagePath } = await persistUpload({
          originalName: file.filename || `${randomUUID()}.bin`,
          buffer,
          mimeType: detectedMime, // Use detected MIME type
          prefix: "quarantine"
        });

        const document = await legalWorkflowService.queueUploadedDocument(request.authSession, {
          matterId: fields.matterId,
          sourceName: file.filename || "uploaded-file",
          mimeType: detectedMime,
          docType: fields.docType,
          storagePath,
          sha256
        });

        reply.code(201);
        return document;
      }
    );

    protectedApp.post(
      "/api/documents/:documentId/rescan",
      { preHandler: requireRole(["partner", "admin"]) },
      async (request) => {
        const params = z.object({ documentId: z.string().uuid() }).parse(request.params);
        return legalWorkflowService.queueDocumentRescan(request.authSession, params.documentId);
      }
    );

    // AI endpoints have stricter rate limits to protect OpenAI budget
    const aiRateLimitConfig = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

    protectedApp.post("/api/documents/extract", aiRateLimitConfig, async (request) => {
      const body = z
        .object({
          documentId: z.string().uuid(),
          documentType: z.string(),
          normalizedText: z.string().optional()
        })
        .parse(request.body);

      return legalWorkflowService.extractClauses(request.authSession, body);
    });

    protectedApp.post("/api/flags/assess", aiRateLimitConfig, async (request) => {
      const body = z
        .object({
          matterId: z.string().uuid(),
          documentId: z.string().uuid(),
          clauseId: z.string().uuid().optional(),
          clauseText: z.string().min(10).max(8000),
          playbook: z.array(z.string()).default([])
        })
        .parse(request.body);

      return legalWorkflowService.assessRisk(request.authSession, body);
    });

    protectedApp.post("/api/research/query", aiRateLimitConfig, async (request) => {
      const body = z.object({ question: z.string().min(5).max(2000) }).parse(request.body);
      return legalWorkflowService.research(request.authSession, body.question);
    });

    protectedApp.get("/api/research/history", async (request) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().max(512).optional()
        })
        .parse(request.query);
      return legalWorkflowService.getResearchHistory(request.authSession, query);
    });

    protectedApp.post("/api/review/feedback", async (request) => {
      const body = z
        .object({
          flagId: z.string().uuid(),
          action: z.enum(["approved", "rejected", "resolved"])
          // reviewerId removed - always use session.attorneyId for security
        })
        .parse(request.body);

      return legalWorkflowService.reviewFeedback(request.authSession, body);
    });
  });
}
