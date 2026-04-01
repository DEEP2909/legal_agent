import type { AuthSession } from "@legal-agent/shared";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { repository } from "./repository.js";
import { hashApiKey } from "./security.js";

type JwtClaims = {
  sub: string;
  tenantId: string;
  role: AuthSession["role"];
  federationProtocol?: AuthSession["federationProtocol"];
  identityProvider?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    authSession: AuthSession;
    scimTenantId?: string;
  }
}

const REFRESH_TOKEN_TTL_DAYS = 30;

export function createAccessToken(session: AuthSession) {
  const options: jwt.SignOptions = {
    subject: session.attorneyId,
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"]
  };

  return jwt.sign(
    {
      tenantId: session.tenantId,
      role: session.role,
      federationProtocol: session.federationProtocol,
      identityProvider: session.identityProvider
    },
    config.jwtSecret,
    options
  );
}

export function createRefreshToken(): string {
  return `rt_${randomBytes(32).toString("hex")}`;
}

export function issueTokens(
  reply: FastifyReply,
  session: AuthSession
): { accessToken: string; refreshToken: string } {
  const accessToken = createAccessToken(session);
  const refreshToken = createRefreshToken();

  reply.setCookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 2 * 60 * 60, // 2 hours in seconds
  });

  reply.setCookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    path: "/auth/refresh", // scope to refresh endpoint only
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60, // 30 days in seconds
  });

  return { accessToken, refreshToken };
}

export function getRefreshTokenTTLDays(): number {
  return REFRESH_TOKEN_TTL_DAYS;
}

async function authenticateBearerToken(token: string) {
  const decoded = jwt.verify(token, config.jwtSecret) as JwtClaims;
  const session = await repository.getAttorneySession(decoded.sub);
  if (!session) {
    return null;
  }

  // Validate that the session's tenant matches the JWT claim
  if (session.tenantId !== decoded.tenantId) {
    throw new Error("Token tenant mismatch - session may be compromised");
  }

  return {
    ...session,
    federationProtocol: decoded.federationProtocol,
    identityProvider: decoded.identityProvider
  };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  // Check Authorization header first (Bearer token)
  const authorization = request.headers.authorization;
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  
  // Also check for httpOnly cookie as fallback (more secure for browser clients)
  const cookieToken = request.cookies?.accessToken;
  
  const jwtToken = bearerToken || cookieToken;

  if (jwtToken) {
    try {
      const session = await authenticateBearerToken(jwtToken);
      if (session) {
        request.authSession = session;
        return;
      }
    } catch {
      // Generic error message to avoid leaking token validation details
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }
  }

  const incomingKey = request.headers["x-api-key"];
  const apiKey = Array.isArray(incomingKey) ? incomingKey[0] : incomingKey;

  if (!apiKey) {
    reply.code(401).send({ error: "Missing credentials" });
    return;
  }

  const session = await repository.authenticateApiKey(hashApiKey(apiKey));
  if (!session) {
    reply.code(401).send({ error: "Invalid credentials" });
    return;
  }

  request.authSession = {
    ...session,
    apiKeyId: session.apiKeyId
  };
}

export function requireRole(roles: AuthSession["role"][]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.authSession.role)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }
  };
}

export async function requireTenantAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authSession.isTenantAdmin && request.authSession.role !== "admin") {
    reply.code(403).send({ error: "Tenant admin required" });
    return;
  }
}

import { timingSafeEqual } from "node:crypto";

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
  // Support both Authorization header (preferred) and legacy x-platform-admin-secret header
  const authorization = request.headers.authorization;
  const legacySecret = request.headers["x-platform-admin-secret"];
  
  let secret: string | null = null;
  
  // Prefer Authorization header with Bearer scheme
  if (authorization?.startsWith("Bearer ")) {
    secret = authorization.slice(7);
  } else if (legacySecret && typeof legacySecret === "string") {
    // Fallback to legacy header (will be deprecated)
    secret = legacySecret;
  }
  
  if (!secret) {
    reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="platform-admin"')
      .send({ error: "Platform admin authentication required" });
    return;
  }

  // Use timing-safe comparison to prevent timing attacks
  const secretBuffer = Buffer.from(secret);
  const expectedBuffer = Buffer.from(config.platformAdminSecret);
  
  if (secretBuffer.length !== expectedBuffer.length || !timingSafeEqual(secretBuffer, expectedBuffer)) {
    reply.code(403).send({ error: "Invalid platform admin credentials" });
    return;
  }
}

export async function requireScimAuth(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization;
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;

  if (!bearerToken) {
    reply
      .header("WWW-Authenticate", 'Bearer realm="scim"')
      .code(401)
      .send({ detail: "Missing SCIM bearer token." });
    return;
  }

  const scimToken = await repository.authenticateScimToken(hashApiKey(bearerToken));
  if (!scimToken) {
    reply
      .header("WWW-Authenticate", 'Bearer realm="scim"')
      .code(401)
      .send({ detail: "Invalid SCIM bearer token." });
    return;
  }

  request.scimTenantId = scimToken.tenantId;
}
