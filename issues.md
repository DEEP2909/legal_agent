Legal Agent Platform
Production Readiness Report

Scope: Full codebase audit against production deployment, multi-tenant SaaS requirements, and commercial sale readiness.
Verdict: 4 Critical issues must be resolved before any production deployment. 5 additional issues must be resolved before onboarding paying tenants.

Severity Legend
🔴 CRITICAL	Will cause data loss, service crash, or security breach in production
🟠 MAJOR	Degrades reliability, enables abuse, or exposes data under real load
🟡 MODERATE	Creates friction or risk before first paying client
🔵 MINOR	Should be fixed before GA; low immediate risk

Quick Reference — All Issues
#	Issue	File(s)	Severity	Category
1	Seed inserts embedding as ::float8[] — column is halfvec	database.ts	🔴 CRITICAL	Data / Bug
2	OpenAI client has zero error handling (no retries, no timeout)	openaiClient.ts	🔴 CRITICAL	Reliability
3	No input length cap on AI text fields — token bomb	routes.ts, prompts.ts	🔴 CRITICAL	Cost / Reliability
4	No rate limit on document upload / ingest endpoints	routes.ts	🔴 CRITICAL	Cost / Abuse
5	File type validated by MIME header only — magic bytes ignored	routes.ts, storage.ts	🟠 MAJOR	Security
6	Worker Dockerfile health check is a no-op	Dockerfile.worker	🟠 MAJOR	Reliability
7	getSsoProviderById() has no tenant scoping	repository.ts	🟠 MAJOR	Security
8	Dashboard loads up to 1 000 rows per request — no pagination	repository.ts	🟠 MAJOR	Performance
9	No per-tenant OpenAI spend tracking or budget guard	openaiClient.ts	🟠 MAJOR	Cost / SaaS
10	CSP includes unsafe-eval + unsafe-inline — XSS protection nullified	next.config.ts	🟡 MODERATE	Security
11	minio:latest tag in docker-compose — silent breaking changes	docker-compose.yml	🟡 MODERATE	Reliability
12	No email verification on directly created attorneys	services.ts	🟡 MODERATE	Security
13	/health/ready exposes internal service topology	routes.ts	🟡 MODERATE	Security
14	Several list endpoints lack pagination	repository.ts	🟡 MODERATE	Performance
15	Dockerfile base images not pinned to digest	Dockerfile.*	🔵 MINOR	Security

🔴 Critical Issues

Issue 1 — Seed inserts embedding as ::float8[] — column is halfvec  [CRITICAL]
Files: apps/api/src/database.ts  (line 108)
Problem
The seedDatabase() function inserts document chunk embeddings with a $9::float8[] cast. The column was changed to halfvec(3072) to fix the pgvector HNSW dimension limit, but the seed was never updated to match.
When SEED_DEMO_DATA=true the server will crash at startup with: 'ERROR: column "embedding" is of type halfvec but expression is of type float8[]'. This means no demo environment can be initialised, blocking onboarding and sales demos.
Broken code:
(id, tenant_id, document_id, ..., embedding)
values ($1, $2, $3, ..., $9::float8[])     -- ❌ wrong type
Fix
Change the type cast in the INSERT for document_chunks. One character change, but it prevents every demo/staging deployment from starting.
Fixed code:
(id, tenant_id, document_id, ..., embedding)
values ($1, $2, $3, ..., $9::halfvec)       -- ✅ matches column type

Issue 2 — OpenAI client has zero error handling — no retries, no timeout  [CRITICAL]
Files: apps/api/src/openaiClient.ts  (runJsonPrompt, embedTextWithOpenAI)
Problem
Every OpenAI call in openaiClient.ts is a raw await with no try/catch, no timeout, and no retry logic. The OpenAI API regularly returns HTTP 429 (rate limit), 503 (overload), or 524 (timeout) in production.
When any of these occur: (a) the worker job throws an uncaught rejection, (b) the document is left in 'processing' status forever, and (c) a Node.js UnhandledPromiseRejection may crash the worker process. Under load from paying tenants this will happen daily.
The OpenAI SDK exposes APIError with a status property. A simple wrapper with exponential backoff on 429/5xx is all that is needed.
Broken code:
const client = new OpenAI({ apiKey: config.openAiApiKey }); // ❌ no retries, no timeout
Fix
Wrap every OpenAI call in a retry helper. The SDK's built-in maxRetries option handles 429s automatically — set it at client construction time.
Fixed code:
const client = new OpenAI({
  apiKey: config.openAiApiKey,
  maxRetries: 3,        // retries 429 / 5xx with backoff
  timeout: 120_000,     // 2 min hard timeout per call
});

Issue 3 — No input length cap on AI text fields — token bomb risk  [CRITICAL]
Files: apps/api/src/routes.ts, apps/api/src/prompts.ts, apps/api/src/services.ts
Problem
Three AI-facing endpoints pass user-controlled text directly to OpenAI with no upper length limit:
  • /api/documents/extract — passes document.normalizedText raw. A 500 KB contract exceeds gpt-4.1's context window, causing a 400 from OpenAI that the worker cannot recover from. The job will hit max_attempts and be abandoned.
  • /api/flags/assess — clauseText has no max() validator. An attacker can submit a 1 MB string in a single request, costing ~$1 per call.
  • /api/research/query — question only has .min(5), no .max(). A 50 KB question wastes embedding tokens and research budget.
For clause extraction the correct fix is to chunk the document and extract per-chunk, not send the whole thing at once.
Fix
Add server-side length caps on all AI text inputs and truncate document text to a safe token budget before building the prompt. As a rule of thumb, 1 token ≈ 4 characters; gpt-4.1 has a ~1M token context but cost grows linearly.
Fixed code:
// routes.ts — research endpoint
z.object({ question: z.string().min(5).max(2000) })

// routes.ts — risk/flags endpoint
z.object({ clauseText: z.string().min(10).max(8000) })

// services.ts — extractClauses, before building prompt
const MAX_CHARS = 60_000; // ~15 000 tokens
const safeText = (input.normalizedText || document.normalizedText)
  .slice(0, MAX_CHARS);

Issue 4 — No rate limit on document upload and ingest endpoints  [CRITICAL]
Files: apps/api/src/routes.ts  (lines 1023, 1047)
Problem
The global rate limit is 100 req/min. The AI endpoints (/api/documents/extract, /api/flags/assess, /api/research/query) are further capped at 20 req/min. However, /api/documents/upload and /api/documents/ingest have no rate limit at all.
Each upload queues an OCR job + embedding job that: reads the file, calls Azure/OpenAI for OCR, calls OpenAI for 3072-dim embeddings per chunk, and writes to the DB. A single authenticated user can upload 100 files/min, saturating the worker queue, exhausting OpenAI quota, and costing real money for every request.
For a SaaS product you are selling, this is also the primary vector for quota abuse by low-tier tenants affecting high-tier tenants.
Fix
Add a dedicated rate limit to both upload and ingest routes. The threshold depends on your pricing tiers but start conservatively.
Fixed code:
const uploadRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
};

protectedApp.post('/api/documents/upload', {
  ...uploadRateLimit,
  preHandler: requireRole(['partner', 'associate', 'paralegal', 'admin'])
}, async (request, reply) => { ... });
🟠 Major Issues

Issue 5 — File type validated by MIME header only — magic bytes never checked  [MAJOR]
Files: apps/api/src/routes.ts  (line 1055)
Problem
The upload endpoint checks allowedMimeTypes.has(file.mimetype), but file.mimetype comes from the multipart Content-Type header — a value the client sets. Any attacker can upload a .exe, .js, or a malicious PDF with embedded JavaScript by simply setting Content-Type: application/pdf in the request.
For a legal platform handling confidential court documents, this is particularly dangerous. The file will be OCR'd and potentially served back to other attorneys in the firm.
The fix is to inspect the actual file bytes (magic bytes) after buffering, before processing. The file-type npm package does this in two lines.
Fix
Install file-type and validate the actual buffer signature before accepting the upload:
Fixed code:
import { fileTypeFromBuffer } from 'file-type';

const buffer = await file.toBuffer();
const detected = await fileTypeFromBuffer(buffer);
const detectedMime = detected?.mime ?? 'application/octet-stream';

if (!allowedMimeTypes.has(detectedMime)) {
  reply.code(400);
  return { error: 'Unsupported or mismatched file type' };
}

Issue 6 — Worker Dockerfile health check is a no-op  [MAJOR]
Files: Dockerfile.worker  (line 29)
Problem
The worker container health check runs: node -e "process.exit(0)". This always exits 0 regardless of whether the worker is actually running, has deadlocked, or has silently stopped processing jobs.
On ECS or Kubernetes, a health check that always passes means a stuck worker is never restarted. Documents will silently queue up and never be processed. Your paying tenants will see documents stuck in 'processing' indefinitely with no alert.
Broken code:
HEALTHCHECK CMD node -e "process.exit(0)" || exit 1  # ❌ always healthy
Fix
Replace the no-op with a real liveness check. The simplest approach is to write a heartbeat timestamp to a temp file inside the worker loop and check the age in the health check.
Fixed code:
# In worker.ts — write heartbeat in the poll loop:
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/worker-heartbeat', Date.now().toString());

# Dockerfile.worker:
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "
    const t = require('fs').readFileSync('/tmp/worker-heartbeat','utf8');
    if (Date.now() - Number(t) > 120000) process.exit(1);
  " || exit 1

Issue 7 — getSsoProviderById() has no tenant scoping  [MAJOR]
Files: apps/api/src/repository.ts  (line 906), apps/api/src/services.ts  (lines 1181, 1254)
Problem
getSsoProviderById() fetches an SSO provider using only its UUID, with no tenant_id check in the WHERE clause. It is called in two places: handleSsoCallback (OIDC) and handleSamlAcs (SAML), both of which read the provider_id from an untrusted state/relayState record.
If an attacker can forge or tamper with a state token (e.g., by replaying an expired state from a different tenant), they can cause the auth flow to load an SSO provider from any tenant in the system, potentially redirecting the login flow to a different tenant's IdP.
This is a defence-in-depth concern — the state tokens are opaque and validated — but the repository layer should enforce tenant isolation unconditionally.
Broken code:
async getSsoProviderById(providerId: string) {
  return pool.query(`SELECT ... FROM sso_providers WHERE id = $1`, [providerId]);
}  // ❌ no tenant check
Fix
Add a tenant_id parameter to getSsoProviderById and pass the tenant from the validated state record, so the DB query enforces isolation regardless of how the ID was obtained.
Fixed code:
async getSsoProviderById(providerId: string, tenantId: string) {
  return pool.query(
    `SELECT ... FROM sso_providers WHERE id = $1 AND tenant_id = $2`,
    [providerId, tenantId]
  );
}  // ✅ tenant-scoped

Issue 8 — Dashboard loads up to 1 000 rows per request — no pagination  [MAJOR]
Files: apps/api/src/repository.ts  (lines 465–469)
Problem
The dashboard query fires 6 parallel SELECT statements loading: 100 attorneys, 100 matters, 200 documents, 500 clauses, 200 flags — all in a single response. That is up to 1 100 rows of data serialised to JSON on every dashboard page load.
For a law firm actively using the platform (500+ documents, thousands of clauses and flags), this will: (a) take 2–5 seconds, (b) return megabytes of JSON, (c) consume significant Postgres CPU, and (d) cause the browser to freeze while parsing the response.
The /api/matters/:matterId/documents endpoint also has limit 500 with no pagination.
Fix
Replace the flat dashboard query with a lightweight summary endpoint that returns only counts and recent items, and paginate all list endpoints.
Fixed code:
// Replace the 6-query dashboard with summary counts + recent 10:
const [counts, recentDocs, openFlags] = await Promise.all([
  pool.query(`SELECT
    (SELECT count(*) FROM documents WHERE tenant_id=$1) AS doc_count,
    (SELECT count(*) FROM flags WHERE tenant_id=$1 AND status='open') AS open_flags,
    (SELECT count(*) FROM matters WHERE tenant_id=$1) AS matter_count`,
    [tenantId]),
  pool.query(`SELECT ... FROM documents WHERE tenant_id=$1
    ORDER BY created_at DESC LIMIT 10`, [tenantId]),
  pool.query(`SELECT ... FROM flags WHERE tenant_id=$1 AND status='open'
    ORDER BY created_at DESC LIMIT 20`, [tenantId])
]);

Issue 9 — No per-tenant OpenAI spend tracking or budget guard  [MAJOR]
Files: apps/api/src/openaiClient.ts, apps/api/src/services.ts
Problem
This is a multi-tenant SaaS product you plan to sell. Every AI call costs real money. There is currently no mechanism to: (a) track how many tokens each tenant has consumed, (b) enforce per-tenant monthly limits, or (c) alert when a tenant is about to exceed their plan quota.
On a growth plan, one tenant could run 1 000 research queries/month (20 req/min × working hours), embedding thousands of document chunks. At GPT-4.1 pricing this can run into thousands of dollars from a single tenant on a plan you may be charging ₹5 000/month for.
You also have no visibility into which AI operation is the most expensive, making it impossible to price plans correctly.
Fix
Add a usage_events table and record token counts after every OpenAI response. The OpenAI SDK returns usage.total_tokens on every completion. Block requests when a tenant has exceeded their plan limit.
Fixed code:
// After every runJsonPrompt call:
await repository.recordUsageEvent({
  tenantId,
  operation: 'clause_extraction',
  model: config.openAiModel,
  promptTokens: response.usage.input_tokens,
  completionTokens: response.usage.output_tokens,
  totalTokens: response.usage.total_tokens
});

// At the start of each AI call, check plan limit:
const usage = await repository.getMonthlyTokenUsage(tenantId);
if (usage.totalTokens > plan.monthlyTokenLimit) {
  throw new Error('Monthly AI quota exceeded. Please upgrade your plan.');
}
🟡 Moderate Issues

Issue 10 — CSP includes unsafe-eval + unsafe-inline — XSS protection nullified  [MODERATE]
Files: apps/web/next.config.ts  (line ~42)
Problem
The Content-Security-Policy in next.config.ts includes script-src 'self' 'unsafe-eval' 'unsafe-inline'. Both directives completely negate the XSS-prevention value of a CSP — any injected script can execute. For a legal platform handling confidential client data and attorney credentials, this is a significant exposure.
Next.js 13+ supports nonce-based CSP in middleware, which removes the need for unsafe-eval and unsafe-inline in production. This is the recommended approach for production Next.js apps.
Fix
Use Next.js middleware to inject a per-request nonce and apply a strict CSP. Remove unsafe-eval and unsafe-inline.
Fixed code:
// middleware.ts (new file at apps/web root)
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
export function middleware(request) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,  // no unsafe-eval
    `style-src 'self' 'unsafe-inline'`,
    `connect-src 'self' ${process.env.NEXT_PUBLIC_API_BASE_URL}`,
  ].join('; ');
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
}

Issue 11 — minio:latest in docker-compose — silent breaking changes on rebuild  [MODERATE]
Files: docker-compose.yml
Problem
The MinIO service uses image: minio/minio:latest. Every docker-compose pull or fresh CI build will resolve to a different version. MinIO has had breaking API changes between releases (notably the S3 gateway removal). A routine infrastructure rebuild can silently break document storage for all tenants.
This also makes production and local environments diverge over time, making bugs impossible to reproduce.
Broken code:
image: minio/minio:latest   # ❌ unpinned
Fix
Pin to a specific MinIO release. Check the MinIO GitHub releases page for the current stable tag and update it intentionally when you want to upgrade.
Fixed code:
image: minio/minio:RELEASE.2025-01-20T14-49-07Z   # ✅ pinned

Issue 12 — No email verification on directly created attorneys  [MODERATE]
Files: apps/api/src/services.ts  (createAttorney)
Problem
When a tenant admin creates an attorney directly via POST /api/admin/attorneys, the attorney receives an immediate password and can log in without confirming they own the email address. An admin who typos the email creates an unverifiable account.
More seriously, an attacker who gains temporary admin access can create a backdoor account with any email address that is immediately active.
Invitation flow (createInvitation) handles this correctly — the invitee sets their own password. The direct createAttorney path should follow the same pattern: create the account in a must_reset_password=true state and send a set-password email.
Fix
Change createAttorney to use the invitation flow under the hood, or at minimum set must_reset_password=true and send a password setup email before the account is usable.
Fixed code:
// services.ts — createAttorney
await pool.query(`INSERT INTO attorneys
  (..., password_hash, can_login, must_reset_password)
  VALUES (..., NULL, false, true)  -- cannot login until email confirmed
`);
await sendWelcomeEmail({ email, setupToken }); // must set password first

Issue 13 — /health/ready exposes internal service topology  [MODERATE]
Files: apps/api/src/routes.ts  (line 79)
Problem
The /health/ready endpoint returns { ok, storage, email, malware } including details like { backend: 's3', bucket: 'legal-agent-prod' } or { backend: 'local', path: '/app/storage' }. If this endpoint is accidentally exposed to the public internet (misconfigured load balancer, pentest, automated scan), it reveals your storage backend type, bucket name, email provider, and malware scanner configuration.
Load balancers only need a 200/non-200 status, not the response body.
Fix
Return only the HTTP status code from the ready endpoint, or gate the detailed response behind internal network access or a secret header.
Fixed code:
app.get('/health/ready', async (request, reply) => {
  await checkDatabaseConnection();
  await Promise.all([checkStorageHealth(), checkEmailHealth(), checkMalwareHealth()]);
  // Return 200 with minimal body — no topology details
  return { ok: true };
});

Issue 14 — Several list endpoints lack pagination  [MODERATE]
Files: apps/api/src/repository.ts
Problem
Beyond the dashboard (Issue 8), the following endpoints have hardcoded LIMIT clauses with no pagination or cursor support:
  • listMatterDocuments — LIMIT 500 (one matter with 500 docs returns everything)
  • listScimUsers — count cap 200, but no cursor for large IdP directories
  • getDocumentEmbeddings — LIMIT 100-500 for in-memory fallback (still in code)
As tenants accumulate data over months, any of these can become slow and memory-intensive.
Fix
Add limit + offset (or cursor-based) pagination to all list endpoints. Expose limit and offset as validated query parameters with a hard ceiling (e.g. max 100 per page).
Fixed code:
// repository.ts — listMatterDocuments
async listMatterDocuments(matterId, tenantId, { limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(limit, 100);
  return pool.query(
    `SELECT ... FROM documents
     WHERE matter_id=$1 AND tenant_id=$2
     ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [matterId, tenantId, safeLimit, offset]
  );
}
🔵 Minor Issues

Issue 15 — Dockerfile base images not pinned to a digest  [MINOR]
Files: Dockerfile.api, Dockerfile.worker, Dockerfile.web
Problem
All three Dockerfiles use FROM node:20-alpine without a SHA256 digest. The node:20-alpine tag can resolve to a different image layer on every build if a new Alpine or Node.js patch is published. While unlikely to cause breakage, a supply chain compromise of a popular base image tag is a real threat vector that is trivially mitigated.
Broken code:
FROM node:20-alpine   # ❌ floating tag
Fix
Pin to a specific digest. Use docker inspect node:20-alpine --format '{{index .RepoDigests 0}}' to get the current value, then add Dependabot Docker digest updates to keep it fresh automatically.
Fixed code:
FROM node:20-alpine@sha256:<digest>   # ✅ pinned — update via Dependabot
What Is Already Production-Grade
The codebase has a strong foundation in several areas:
•	Auth & Identity — httpOnly cookies, refresh token rotation, CSRF protection, timing-safe comparisons, TOTP MFA, passkeys (WebAuthn), SAML/OIDC SSO, and SCIM provisioning are all implemented correctly.
•	Tenant Isolation — all queries are tenant-scoped. The repository layer consistently passes tenantId to every query. No global selects without tenant predicates were found.
•	Encryption — AES-256-GCM for secrets at rest, scrypt for password hashing, HMAC-SHA256 for API key hashing. All correct choices with proper IV/tag handling.
•	Schema & Migrations — node-pg-migrate is integrated, halfvec fix is in place, and schema.sql stays in sync with migrations.
•	Graceful Shutdown — both the API (index.ts) and worker (worker-main.ts) have SIGTERM/SIGINT handlers that drain in-flight work before exiting.
•	Database Pool — explicit pool config with max, idleTimeoutMillis, connectionTimeoutMillis and SSL enforcement in production.
•	OpenTelemetry — tracing is wired up and gated on OTEL_EXPORTER_OTLP_ENDPOINT, so it does not run unless configured.
•	Security Headers — Fastify Helmet with strict CSP on the API, and Next.js security headers including HSTS, X-Frame-Options, and Referrer-Policy on the frontend.
•	Input Validation — Zod schemas on every route with meaningful error messages and cross-field validation (OIDC vs SAML provider requirements, SMTP/S3 conditionals).
•	Audit Trail — recordAuditEvent is called on 30+ operations covering login, MFA changes, SSO config, document ingestion, and flag review. Good coverage for compliance.

Pre-Launch Checklist
Resolve in this order before accepting the first paying tenant.

Before Any Production Deployment
•	Fix Issue 1 — seed ::float8[] cast → ::halfvec
•	Fix Issue 2 — add maxRetries: 3, timeout: 120_000 to OpenAI client
•	Fix Issue 3 — add .max() validators on all AI text inputs + truncate normalizedText
•	Fix Issue 4 — add uploadRateLimit to /api/documents/upload and /api/documents/ingest
•	Fix Issue 5 — validate magic bytes with file-type after buffering
•	Fix Issue 6 — replace worker health check no-op with heartbeat-based check
•	Fix Issue 7 — add tenantId to getSsoProviderById query

Before Onboarding Paying Tenants
•	Fix Issue 8 — replace dashboard mega-query with summary + paginated endpoints
•	Fix Issue 9 — add usage_events table and per-tenant token quota enforcement
•	Fix Issue 10 — replace unsafe-eval/unsafe-inline CSP with nonce-based CSP
•	Fix Issue 12 — require email verification for directly created attorneys
•	Fix Issue 13 — strip service details from /health/ready response body
•	Fix Issue 14 — add pagination to all list endpoints

Before General Availability
•	Fix Issue 11 — pin minio:latest to a specific release tag
•	Fix Issue 15 — pin Dockerfile base images to SHA256 digests, add Dependabot
•	Configure MALWARE_SCANNER=clamav in all production environments
•	Set SEED_DEMO_DATA=false and remove demo credentials from all production configs
•	Generate unique APP_ENCRYPTION_KEY, JWT_SECRET, PLATFORM_ADMIN_SECRET per environment
•	Enable OTEL tracing and wire up alerting on 5xx rate, job failure rate, and DB pool exhaustion
