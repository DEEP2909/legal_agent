import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  return false;
}, z.boolean());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    OPENAI_MODEL: z.string().default("gpt-4.1"),
    OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
    DATA_DIR: z.string().default("./data"),
    FILE_STORAGE_DIR: z.string().default("./storage"),
    DEMO_API_KEY: z.string().min(24, "DEMO_API_KEY must be at least 24 characters"),
    DEMO_USER_EMAIL: z.string().email("DEMO_USER_EMAIL must be a valid email"),
    DEMO_USER_PASSWORD: z
      .string()
      .min(12, "DEMO_USER_PASSWORD must be at least 12 characters")
      .regex(/[A-Z]/, "DEMO_USER_PASSWORD must contain uppercase letter")
      .regex(/[a-z]/, "DEMO_USER_PASSWORD must contain lowercase letter")
      .regex(/[0-9]/, "DEMO_USER_PASSWORD must contain number")
      .regex(/[^A-Za-z0-9]/, "DEMO_USER_PASSWORD must contain special character"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
    S3_REGION: z.string().default("ap-south-1"),
    S3_BUCKET: z.string().default(""),
    S3_ENDPOINT: z.string().default(""),
    S3_ACCESS_KEY: z.string().default(""),
    S3_SECRET_KEY: z.string().default(""),
    OCR_PROVIDER: z.enum(["openai", "azure_document_intelligence", "hybrid"]).default("openai"),
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: z.string().default(""),
    AZURE_DOCUMENT_INTELLIGENCE_KEY: z.string().default(""),
    AZURE_DOCUMENT_INTELLIGENCE_MODEL: z.string().default("prebuilt-layout"),
    AZURE_DOCUMENT_INTELLIGENCE_API_VERSION: z.string().default("2024-11-30"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    MAX_UPLOAD_BYTES: z.coerce.number().default(25 * 1024 * 1024),
    MALWARE_SCANNER: z.enum(["none", "clamav", "eicar"]).default("none"),
    CLAMAV_HOST: z.string().default("127.0.0.1"),
    CLAMAV_PORT: z.coerce.number().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().default(10000),
    EMAIL_DELIVERY_MODE: z.enum(["log", "smtp"]).default("log"),
    MAIL_FROM: z.string().email().default("noreply@legal-agent.local"),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_SECURE: booleanFromString.default(false),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    SAML_SP_PRIVATE_KEY: z.string().default(""),
    SAML_SP_PUBLIC_CERT: z.string().default(""),
    SAML_SIGN_AUTHN_REQUESTS: booleanFromString.default(false),
    SAML_SIGN_METADATA: booleanFromString.default(false),
    SAML_SIGNATURE_ALGORITHM: z.enum(["sha256", "sha512"]).default("sha256"),
    WEBAUTHN_RP_NAME: z.string().default("Legal Agent"),
    WEBAUTHN_RP_ID: z.string().default(""),
    RUN_INLINE_WORKER: booleanFromString.default(false),
    JOB_POLL_INTERVAL_MS: z.coerce.number().default(5000),
    APP_ENCRYPTION_KEY: z.string().min(32, "APP_ENCRYPTION_KEY must be at least 32 characters"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN: z.string().default("2h"),
    PLATFORM_ADMIN_SECRET: z.string().min(32, "PLATFORM_ADMIN_SECRET must be at least 32 characters"),
    WEB_APP_URL: z.string().url().default("http://localhost:3000"),
    PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:4000"),
    ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().default(5),
    ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce.number().default(15)
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_BACKEND === "s3" && !env.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "S3_BUCKET is required when STORAGE_BACKEND=s3",
        path: ["S3_BUCKET"]
      });
    }

    if (env.EMAIL_DELIVERY_MODE === "smtp" && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SMTP_HOST is required when EMAIL_DELIVERY_MODE=smtp",
        path: ["SMTP_HOST"]
      });
    }

    if (
      (env.SAML_SIGN_AUTHN_REQUESTS || env.SAML_SIGN_METADATA) &&
      (!env.SAML_SP_PRIVATE_KEY || !env.SAML_SP_PUBLIC_CERT)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "SAML_SP_PRIVATE_KEY and SAML_SP_PUBLIC_CERT are required when SAML signing is enabled.",
        path: ["SAML_SP_PRIVATE_KEY"]
      });
    }

    if (
      ["azure_document_intelligence", "hybrid"].includes(env.OCR_PROVIDER) &&
      (!env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || !env.AZURE_DOCUMENT_INTELLIGENCE_KEY)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY are required for Azure OCR.",
        path: ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"]
      });
    }
  });

const env = schema.parse(process.env);
const derivedWebauthnRpId = env.WEBAUTHN_RP_ID || new URL(env.WEB_APP_URL).hostname;

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  openAiApiKey: env.OPENAI_API_KEY,
  openAiModel: env.OPENAI_MODEL,
  embeddingModel: env.OPENAI_EMBEDDING_MODEL,
  dataDir: env.DATA_DIR,
  fileStorageDir: env.FILE_STORAGE_DIR,
  demoApiKey: env.DEMO_API_KEY,
  demoUserEmail: env.DEMO_USER_EMAIL,
  demoUserPassword: env.DEMO_USER_PASSWORD,
  databaseUrl: env.DATABASE_URL,
  storageBackend: env.STORAGE_BACKEND,
  s3Region: env.S3_REGION,
  s3Bucket: env.S3_BUCKET,
  s3Endpoint: env.S3_ENDPOINT,
  s3AccessKey: env.S3_ACCESS_KEY,
  s3SecretKey: env.S3_SECRET_KEY,
  ocrProvider: env.OCR_PROVIDER,
  azureDocumentIntelligenceEndpoint: env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
  azureDocumentIntelligenceKey: env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
  azureDocumentIntelligenceModel: env.AZURE_DOCUMENT_INTELLIGENCE_MODEL,
  azureDocumentIntelligenceApiVersion: env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION,
  corsOrigins: env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
  malwareScanner: env.MALWARE_SCANNER,
  clamavHost: env.CLAMAV_HOST,
  clamavPort: env.CLAMAV_PORT,
  clamavTimeoutMs: env.CLAMAV_TIMEOUT_MS,
  emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
  mailFrom: env.MAIL_FROM,
  smtpHost: env.SMTP_HOST,
  smtpPort: env.SMTP_PORT,
  smtpSecure: env.SMTP_SECURE,
  smtpUser: env.SMTP_USER,
  smtpPassword: env.SMTP_PASSWORD,
  samlSpPrivateKey: env.SAML_SP_PRIVATE_KEY,
  samlSpPublicCert: env.SAML_SP_PUBLIC_CERT,
  samlSignAuthnRequests: env.SAML_SIGN_AUTHN_REQUESTS,
  samlSignMetadata: env.SAML_SIGN_METADATA,
  samlSignatureAlgorithm: env.SAML_SIGNATURE_ALGORITHM,
  webauthnRpName: env.WEBAUTHN_RP_NAME,
  webauthnRpId: derivedWebauthnRpId,
  runInlineWorker: env.RUN_INLINE_WORKER,
  jobPollIntervalMs: env.JOB_POLL_INTERVAL_MS,
  appEncryptionKey: env.APP_ENCRYPTION_KEY,
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  platformAdminSecret: env.PLATFORM_ADMIN_SECRET,
  webAppUrl: env.WEB_APP_URL,
  publicApiBaseUrl: env.PUBLIC_API_BASE_URL,
  accountLockoutThreshold: env.ACCOUNT_LOCKOUT_THRESHOLD,
  accountLockoutDurationMinutes: env.ACCOUNT_LOCKOUT_DURATION_MINUTES
} as const;
