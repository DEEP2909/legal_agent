// OpenTelemetry must be initialized before any other imports
import "./tracing.js";

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrf from "@fastify/csrf-protection";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { closeDatabase, initializeDatabase } from "./database.js";
import { registerRoutes } from "./routes.js";
import { ensureDirectories } from "./storage.js";
import { startWorker } from "./worker.js";

const app = Fastify({ logger: true });

// Security headers
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

await app.register(cors, {
  origin: config.corsOrigins.length === 1 ? config.corsOrigins[0] : config.corsOrigins,
  credentials: true
});

// Cookie and CSRF protection
await app.register(cookie, {
  secret: config.jwtSecret,
  parseOptions: {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict"
  }
});

await app.register(csrf, {
  sessionPlugin: "@fastify/cookie",
  cookieOpts: {
    httpOnly: true,
    sameSite: "strict",
    secure: config.nodeEnv === "production"
  }
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute"
});
await app.register(formbody);
await app.register(multipart, {
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1
  }
});
await initializeDatabase();
await ensureDirectories();

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  const pgError = error as { code?: string };
  if (pgError.code === "23505") {
    reply.code(409).send({ error: "A record with the same unique value already exists." });
    return;
  }

  const statusCode =
    (error as { statusCode?: number }).statusCode &&
    ((error as { statusCode?: number }).statusCode as number) >= 400
      ? ((error as { statusCode?: number }).statusCode as number)
      : 500;
  
  const isProduction = config.nodeEnv === "production";
  const isTest = config.nodeEnv === "test";
  
  // In production and staging, return generic messages to avoid leaking system details
  // In test mode, return actual messages for debugging
  // For validation errors (400), return the message for usability (but sanitize)
  // For auth errors (401/403), return generic message to avoid user enumeration
  // For all server errors (5xx), return generic message
  let safeMessage: string;
  
  if (isTest) {
    // Test mode - return actual error for debugging
    safeMessage = (error as { message?: string }).message || "Internal server error";
  } else if (statusCode === 400) {
    // Validation errors - safe to expose but sanitize to avoid injection
    const rawMessage = (error as { message?: string }).message || "Invalid request";
    // Remove any potential sensitive data patterns from the message
    safeMessage = rawMessage.replace(/password|secret|key|token/gi, "[REDACTED]");
  } else if (statusCode === 401 || statusCode === 403) {
    // Auth errors - generic to prevent enumeration
    safeMessage = statusCode === 401 ? "Invalid credentials" : "Access denied";
  } else if (statusCode >= 500) {
    safeMessage = "Internal server error";
  } else {
    safeMessage = isProduction ? "Request failed" : ((error as { message?: string }).message || "Request failed");
  }
  
  reply.code(statusCode).send({ error: safeMessage });
});

await registerRoutes(app);
if (config.runInlineWorker) {
  startWorker();
}

const shutdown = async () => {
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
