# Legal Agent Platform — Production Readiness Report

> **Audit scope:** Full codebase review of `legal_agent-main` against a real cloud deployment target.
> Issues are drawn both from the in-repo `issues_detailed.md` (verified against actual source) and from
> a fresh production-readiness pass. All code snippets reference real files and real line ranges.

---

## Quick-Reference Table

| # | Issue | File(s) | Severity | Category |
|---|-------|---------|----------|----------|
| 1 | Vector search uses in-memory cosine similarity instead of `pgvector` | `repository.ts`, `schema.sql` | 🔴 Critical | Performance / Correctness |
| 2 | Worker process has no graceful shutdown handler | `worker-main.ts`, `worker.ts` | 🟠 Major | Reliability |
| 3 | Database pool has no connection limits | `database.ts` | 🟠 Major | Reliability |
| 4 | `database.ts` always re-seeds demo data on startup | `database.ts` | 🟠 Major | Security / Data |
| 5 | No database migration strategy — schema runs raw on every boot | `database.ts`, `db/schema.sql` | 🟠 Major | Operations |
| 6 | Test suite simulates logic instead of testing real service functions | `__tests__/` | 🟡 Moderate | Quality |
| 7 | Dockerfiles run as `root` with no non-root user | `Dockerfile.*` | 🟡 Moderate | Security |
| 8 | `docker-compose.yml` has no health checks | `docker-compose.yml` | 🟡 Moderate | Operations |
| 9 | `MALWARE_SCANNER=none` in default config — legal docs need real scanning | `config.ts`, `.env.example` | 🟡 Moderate | Compliance |
| 10 | JWT access tokens have no refresh mechanism | `auth.ts`, `routes.ts` | 🟡 Moderate | UX / Security |
| 11 | No CI/CD pipeline | repo root | 🟡 Moderate | Operations |
| 12 | `DEPLOYMENT.md` still contains hardcoded Windows local paths | `DEPLOYMENT.md` | 🔵 Minor | Documentation |
| 13 | No OpenTelemetry / observability setup | `index.ts`, `worker-main.ts` | 🔵 Minor | Operations |
| 14 | Dockerfile base image not pinned to a digest | `Dockerfile.*` | 🔵 Minor | Security |

---

## Severity Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 Critical | Will cause data loss, outage, or serious security breach in production |
| 🟠 Major | Will degrade reliability, cause data inconsistency, or expose data in production |
| 🟡 Moderate | Will cause friction or risk under real load — fix before first paying tenant |
| 🔵 Minor | Should be fixed before GA; low immediate risk |

---

---

## 🔴 Critical

---

### Issue 1 — Vector search runs in-memory cosine similarity instead of `pgvector`

**Files:** `apps/api/src/repository.ts` ~line 1800, `db/schema.sql`
**Impact:** Research queries load **every chunk for every document in the tenant** into Node.js memory and compute cosine similarity in JavaScript. With 50 documents × 20 chunks each = 1,000 embeddings × 3,072 floats (`text-embedding-3-large`) = **~24 MB per query**, held in process RAM. Under any real load this will OOM-crash the API and/or return stale results.

**Root cause:** The `pgvector` PostgreSQL extension is not installed or declared in the schema, so the `<=>` vector operator is unavailable and the code falls back to in-memory comparison.

There is already a `TODO` comment in the codebase acknowledging this:

```ts
// repository.ts ~line 1801
// TODO: Issue #10 — When pgvector extension is available, replace this with a
// proper vector similarity search using the <=> operator:
//   SELECT d.*, c.embedding <=> $2::vector AS distance
```

**Fix — Step 1: Enable `pgvector` on your database**

For **AWS RDS (PostgreSQL 15/16)**:
```sql
-- Run once as superuser after provisioning the RDS instance
CREATE EXTENSION IF NOT EXISTS vector;
```

For **Neon / Supabase / Render managed Postgres** — `pgvector` is pre-installed;
just run the `CREATE EXTENSION` statement above in a migration.

For **self-hosted Postgres in Docker**, update `docker-compose.yml`:
```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16   # official pgvector image — replaces postgres:16
    environment:
      POSTGRES_DB: legal_agent
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres   # change this in production
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

**Fix — Step 2: Add extension and index to `schema.sql`**

```sql
-- db/schema.sql — add at the very top, before CREATE TABLE statements
CREATE EXTENSION IF NOT EXISTS vector;

-- At the bottom, after document_chunks table definition:
-- IVFFlat index for approximate nearest-neighbour search
-- lists = sqrt(number of expected rows). Start with 100, tune later.
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Fix — Step 3: Update `document_chunks` column type in `schema.sql`**

```sql
-- db/schema.sql — document_chunks table
-- Change the embedding column from float8[] to the native vector type:
embedding vector(3072),   -- 3072 = text-embedding-3-large dimensions
-- was: embedding float8[]
```

**Fix — Step 4: Replace in-memory search in `repository.ts`**

```ts
// apps/api/src/repository.ts — replace the in-memory cosine similarity block

async searchSimilarChunks(
  tenantId: string,
  queryEmbedding: number[],
  limit = 10
): Promise<DocumentChunk[]> {
  // Cast JS array to pgvector literal: '[0.1,0.2,...]'
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${COLS.documentChunks},
            1 - (embedding <=> $1::vector) AS score
     FROM document_chunks
     WHERE tenant_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorLiteral, tenantId, limit]
  );

  return result.rows.map(mapDocumentChunk);
}
```

**Why this matters in production:** A law firm ingesting 200+ contracts per matter will hit the in-memory path within days of launch. The `pgvector` IVFFlat index keeps query time at ~10–50 ms regardless of corpus size.

---

---

## 🟠 Major

---

### Issue 2 — Worker process has no graceful shutdown handler

**Files:** `apps/api/src/worker-main.ts`, `apps/api/src/worker.ts`
**Impact:** When Kubernetes or ECS sends `SIGTERM` to roll out a new worker version, the Node.js process exits mid-job. The PostgreSQL row for that job stays `processing` indefinitely (until the stuck-job recovery runs), and the partially ingested document is left in `ingestion_status = 'processing'` with no `normalized_text` or embeddings. The document is silently unusable until a manual requeue.

**Current `worker-main.ts`:**
```ts
// apps/api/src/worker-main.ts — current state
await initializeDatabase();
await ensureDirectories();
startWorker();
// No SIGTERM / SIGINT handlers — process exits immediately on signal
```

**Fix:**
```ts
// apps/api/src/worker-main.ts — replace with:
import { closeDatabase, initializeDatabase } from "./database.js";
import { ensureDirectories } from "./storage.js";
import { startWorker, stopWorker } from "./worker.js";

await initializeDatabase();
await ensureDirectories();
startWorker();

async function shutdown(signal: string) {
  console.log(`[worker] Received ${signal}, draining in-flight jobs…`);
  await stopWorker();          // see worker.ts fix below
  await closeDatabase();
  console.log("[worker] Clean shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
```

Add a `stopWorker()` export to `worker.ts`:
```ts
// apps/api/src/worker.ts — add near startWorker()

let shouldStop = false;

export function stopWorker() {
  shouldStop = true;
  // Give in-flight poll up to 30 s to finish the current job iteration
  return new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!isRunning) {
        clearInterval(check);
        resolve();
      }
    }, 500);
    setTimeout(() => { clearInterval(check); resolve(); }, 30_000);
  });
}

// Inside processPendingDocuments(), add at the top of the while loop:
while (true) {
  if (shouldStop) break;   // ← add this check
  // ... rest of poll loop
}
```

---

### Issue 3 — Database pool has no connection limits

**File:** `apps/api/src/database.ts`
**Impact:** `new Pool({ connectionString })` uses `pg`'s default of `max: 10` connections. With three services (API, worker, inline worker) all connecting to the same Postgres instance, you can silently exhaust the `max_connections` on a small RDS instance (default 100 for `db.t3.micro`). Excess connection attempts queue silently, causing slow requests and eventually timeouts with no useful error messages.

**Current:**
```ts
// database.ts
export const pool = new Pool({
  connectionString: config.databaseUrl
});
```

**Fix — Add explicit pool config and expose it via `config.ts`:**

```ts
// apps/api/src/config.ts — add to schema:
DB_POOL_MAX: z.coerce.number().default(10),
DB_IDLE_TIMEOUT_MS: z.coerce.number().default(30_000),
DB_CONNECT_TIMEOUT_MS: z.coerce.number().default(10_000),

// And in the exported config object:
dbPoolMax: env.DB_POOL_MAX,
dbIdleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
dbConnectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
```

```ts
// apps/api/src/database.ts — replace pool construction:
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: config.dbIdleTimeoutMs,
  connectionTimeoutMillis: config.dbConnectTimeoutMs,
  ssl: config.nodeEnv === "production"
    ? { rejectUnauthorized: true }   // enforce TLS to RDS
    : false,
});

pool.on("error", (err) => {
  // Log pool-level errors (e.g. idle client disconnected by DB) without crashing
  console.error("[pg pool] Unexpected idle client error:", err.message);
});
```

```env
# .env.example — add:
# Tune based on your RDS instance's max_connections and number of service replicas.
# Rule of thumb: DB_POOL_MAX per instance = (max_connections - 5) / (api_replicas + worker_replicas)
DB_POOL_MAX=10
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECT_TIMEOUT_MS=10000
```

**Recommended pool sizing for production (AWS RDS `db.t3.small`, `max_connections=200`):**
- 2× API replicas × 10 = 20 connections
- 1× Worker replica × 5 = 5 connections
- Reserve 5 for admin / migrations
- Total: 30 out of 200 → comfortable headroom

---

### Issue 4 — `database.ts` re-seeds demo data on every fresh startup

**File:** `apps/api/src/database.ts`
**Impact:** The `seedDatabase()` function is called every time `initializeDatabase()` runs. It only skips seeding if `count(tenants) > 0`. On a clean production database, it unconditionally creates:
- A `tenant-demo` tenant
- Demo attorneys with your personal email and a password set to `config.demoUserPassword`
- A demo API key whose hash comes from `config.demoApiKey`

If the ops team forgets to remove the demo credentials from environment variables (which `.env.example` prominently sets), attackers who discover the demo API key or the `demo@example.com` account gain immediate authenticated access to the production platform.

**Fix — Separate seeding from schema application, and gate it with an explicit env flag:**

```ts
// apps/api/src/config.ts — add:
SEED_DEMO_DATA: booleanFromString.default(false),   // must be explicitly opted-in

// In config export:
seedDemoData: env.SEED_DEMO_DATA,
```

```ts
// apps/api/src/database.ts — update initializeDatabase():
export async function initializeDatabase() {
  const schema = await readFile(schemaPath, "utf8");
  await pool.query(schema);

  if (config.seedDemoData) {
    // Only seed when explicitly requested — never in production
    if (config.nodeEnv === "production") {
      console.warn(
        "[database] SEED_DEMO_DATA=true in production — skipping demo seed for safety. " +
        "Set SEED_DEMO_DATA=true only in development."
      );
      return;
    }
    await seedDatabase();
  }
}
```

```env
# .env.example — add a clear comment near DEMO_ variables:
# ⚠️  DEMO DATA — never set SEED_DEMO_DATA=true in production.
# Demo credentials are for local development only.
SEED_DEMO_DATA=false
```

---

### Issue 5 — No database migration strategy — schema runs raw SQL on every boot

**File:** `apps/api/src/database.ts`, `db/schema.sql`, `db/migrations/`
**Impact:** `initializeDatabase()` runs the full `schema.sql` with `CREATE TABLE IF NOT EXISTS` on every startup. This works fine for a greenfield deploy, but is **unsafe for production schema changes**:
- Adding a column requires editing `schema.sql`, but `IF NOT EXISTS` means the existing table won't gain the new column on a running instance.
- There is one manually-written migration file (`001_add_account_lockout.sql`) with no tooling to track which migrations have been run.
- Deploying a new API version with a schema change will silently fail if the migration is not applied first — the app starts, the query fails, but there is no clear error at startup.

**Fix — Adopt a lightweight migration runner (`node-pg-migrate` or `dbmate`):**

**Option A — `node-pg-migrate` (pure Node.js, no extra binary):**

```bash
# Install
npm install node-pg-migrate --save-dev -w @legal-agent/api

# Create migrations directory structure
mkdir -p db/migrations
```

```json
// apps/api/package.json — add script:
{
  "scripts": {
    "migrate": "node-pg-migrate up",
    "migrate:down": "node-pg-migrate down",
    "migrate:create": "node-pg-migrate create"
  }
}
```

```ts
// apps/api/src/database.ts — remove the raw schema.sql execution and replace with:
export async function initializeDatabase() {
  // Migrations are run via `npm run migrate` before the service starts.
  // This function only checks connectivity on startup.
  await pool.query("SELECT 1");
  console.log("[database] Connection verified.");

  if (config.seedDemoData && config.nodeEnv !== "production") {
    await seedDatabase();
  }
}
```

**DEPLOYMENT.md — update deployment sequence:**
```markdown
## Deployment sequence (updated)

1. Provision PostgreSQL with `pgvector` extension.
2. Run database migrations:
   DATABASE_URL=<prod_url> npm run migrate -w @legal-agent/api
3. Deploy the `api` service.
4. Deploy the `worker` service.
5. Deploy the `web` service.
```

**Option B — `dbmate` (single binary, language-agnostic, popular with Postgres on Fly.io/Render):**

```dockerfile
# Dockerfile.api — add dbmate to the runtime image:
RUN apk add --no-cache curl && \
    curl -fsSL https://github.com/amacneil/dbmate/releases/latest/download/dbmate-linux-amd64 \
    -o /usr/local/bin/dbmate && chmod +x /usr/local/bin/dbmate
```

```bash
# In your CI/CD deploy step, before starting the container:
dbmate --url "$DATABASE_URL" up
```

**Migrate the existing `schema.sql` and single migration into `dbmate`-style files:**

```
db/
  migrations/
    20260101000000_initial_schema.sql      ← contents of db/schema.sql
    20260330000000_add_account_lockout.sql ← contents of existing migration
    20260401000000_add_pgvector.sql        ← new: CREATE EXTENSION + vector column
```

---

---

## 🟡 Moderate

---

### Issue 6 — Test suite simulates logic instead of testing real service functions

**Files:** `apps/api/src/__tests__/tenant-isolation.test.ts`, `services.test.ts`, `worker.test.ts`
**Impact:** The three new test files all re-implement simplified versions of the logic they claim to test (e.g., `tenant-isolation.test.ts` defines its own `getEntityForTenant` helper function, not the real repository). These tests will pass even if the actual service code is completely broken. The highest-risk paths — document ingestion pipeline, clause extraction, OpenAI response parsing, tenant data isolation at the SQL level — remain completely untested.

**Fix — Replace simulated tests with tests against the real module code, using mocks only at I/O boundaries:**

**Example: services.test.ts (clause extraction with mocked OpenAI)**

```ts
// apps/api/src/__tests__/services.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
// Import the REAL service function, not a re-implementation
import { extractClauses } from "../services.js";
import * as openaiClient from "../openaiClient.js";

// Mock only the I/O boundary (OpenAI API) — not the service logic
vi.mock("../openaiClient.js");

describe("extractClauses", () => {
  it("parses a valid JSON response from OpenAI", async () => {
    const mockResponse = JSON.stringify([
      {
        clauseType: "limitation_of_liability",
        text: "Liability shall not exceed INR 50,00,000 in aggregate.",
        riskLevel: "high",
        explanation: "Cap is below contract value."
      }
    ]);
    vi.spyOn(openaiClient, "callOpenAI").mockResolvedValueOnce(mockResponse);

    const result = await extractClauses("doc-1", "tenant-1", "...document text...");

    expect(result).toHaveLength(1);
    expect(result[0].clauseType).toBe("limitation_of_liability");
    expect(result[0].riskLevel).toBe("high");
  });

  it("returns empty array when OpenAI returns malformed JSON", async () => {
    vi.spyOn(openaiClient, "callOpenAI").mockResolvedValueOnce("not json at all");
    const result = await extractClauses("doc-1", "tenant-1", "...document text...");
    expect(result).toEqual([]);
  });
});
```

**Example: tenant-isolation.test.ts (real SQL-level test with a test database)**

```ts
// apps/api/src/__tests__/tenant-isolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, initializeDatabase, closeDatabase } from "../database.js";
import * as repo from "../repository.js";

// Use a real test DB — set DATABASE_URL=<test_db_url> in vitest env
beforeAll(async () => {
  await initializeDatabase();
  // Seed two isolated tenants
  await pool.query("INSERT INTO tenants (id, name, region, plan) VALUES ($1, $2, $3, $4)", ["tenant-a", "Firm A", "IN", "growth"]);
  await pool.query("INSERT INTO tenants (id, name, region, plan) VALUES ($1, $2, $3, $4)", ["tenant-b", "Firm B", "IN", "growth"]);
});

afterAll(async () => {
  await pool.query("DELETE FROM tenants WHERE id IN ('tenant-a', 'tenant-b')");
  await closeDatabase();
});

it("cannot read Tenant B's documents from Tenant A's session", async () => {
  // Create a document under tenant-b
  const docId = await repo.createDocument("tenant-b", { sourceName: "secret.pdf", ... });

  // Attempt to fetch it as tenant-a — must return null
  const result = await repo.getDocumentForTenant(docId, "tenant-a");
  expect(result).toBeNull();
});
```

**Example: worker.test.ts (real chunkText and backoff functions)**

```ts
// apps/api/src/__tests__/worker.test.ts
import { describe, it, expect } from "vitest";
// Test the real exported function, not a re-implementation
import { chunkText } from "../worker.js";

describe("chunkText", () => {
  it("produces chunks of at most 1500 characters", () => {
    const longText = "word ".repeat(1000);
    const chunks = chunkText(longText);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1500);
    }
  });

  it("overlaps consecutive chunks by ~200 characters", () => {
    const text = "a".repeat(5000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    const overlap = chunks[0].slice(-200);
    expect(chunks[1].startsWith(overlap)).toBe(true);
  });
});
```

**Add a `vitest.config.ts` environment for integration tests:**
```ts
// apps/api/vitest.config.ts — update to separate unit vs integration
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/**/*.integration.test.ts"],   // run separately in CI
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"]
  }
});
```

---

### Issue 7 — Dockerfiles run all processes as `root`

**Files:** `Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.web`
**Impact:** If any dependency has a remote code execution vulnerability, the attacker owns the container as root. With `node:20-alpine`, `root` inside the container has UID 0, and unless the container runtime enforces a user namespace, this can translate to elevated access on the host or other containers sharing a network namespace.

**Fix — Add a non-root user to all three Dockerfiles:**

```dockerfile
# Dockerfile.api (apply same pattern to Dockerfile.worker and Dockerfile.web)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w @legal-agent/shared && npm run build -w @legal-agent/api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=appuser:appgroup /app/db ./db
COPY --chown=appuser:appgroup package.json package-lock.json ./

# Drop to non-root before starting
USER appuser

# Expose only the port the service uses
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health/live || exit 1

CMD ["node", "apps/api/dist/index.js"]
```

Apply a similar `HEALTHCHECK` for the web container pointing to `http://localhost:3000/`.

---

### Issue 8 — `docker-compose.yml` has no health checks on Postgres or MinIO

**File:** `docker-compose.yml`
**Impact:** The API and worker containers start immediately alongside Postgres and MinIO. On slower machines or when the Docker network is slow, the database is not yet accepting connections when `initializeDatabase()` runs, causing a startup crash with a cryptic `ECONNREFUSED` error. In CI pipelines this is a common and silent flake source.

**Fix:**

```yaml
# docker-compose.yml — complete replacement

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: legal_agent
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres          # override in production
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d legal_agent"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin      # override in production
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD-SHELL", "mc ready local || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  createbucket:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy     # wait for MinIO health check to pass
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin;
      mc mb -p local/legal-agent-dev || true;
      mc anonymous set private local/legal-agent-dev || true;
      exit 0;
      "

volumes:
  postgres_data:
  minio_data:
```

For a full local stack including the API and worker, add `depends_on` with `condition: service_healthy` to both service definitions.

---

### Issue 9 — `MALWARE_SCANNER=none` is the default — legal documents require real scanning

**Files:** `apps/api/src/config.ts`, `.env.example`
**Impact:** Law firms uploading contracts, affidavits, and title deeds will also receive email attachments from counterparties. `MALWARE_SCANNER=none` means every uploaded file goes directly into storage and gets OCR'd without any virus check. A malicious PDF with an embedded exploit or a macro-laden `.docx` disguised as a legal document will be stored, displayed in the UI, and potentially executed by an attorney's machine when downloaded.

**Fix — Part 1: Make `MALWARE_SCANNER=none` log a loud startup warning in production:**

```ts
// apps/api/src/config.ts — add to the bottom of the config export block:
if (config.nodeEnv === "production" && config.malwareScanner === "none") {
  console.warn(
    "[security] ⚠️  MALWARE_SCANNER=none in production. " +
    "All uploaded files will be stored without malware scanning. " +
    "Set MALWARE_SCANNER=clamav and configure CLAMAV_HOST to enable scanning."
  );
}
```

**Fix — Part 2: Add ClamAV to `docker-compose.yml` for local development:**

```yaml
# docker-compose.yml — add ClamAV service:
  clamav:
    image: clamav/clamav:stable
    ports:
      - "3310:3310"
    volumes:
      - clamav_data:/var/lib/clamav
    healthcheck:
      test: ["CMD-SHELL", "clamdcheck || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 120s      # ClamAV takes ~2 min to update signatures on first boot
```

```env
# .env.example — update MALWARE_SCANNER comment:
# For production: set to 'clamav' and configure CLAMAV_HOST.
# 'none' is acceptable only for local development with no real client data.
MALWARE_SCANNER=none
```

**For cloud deployment (AWS):** Use [Amazon GuardDuty Malware Protection for S3](https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html) or deploy ClamAV as an ECS Fargate sidecar. The existing `malware.ts` + worker job architecture is well-suited for this.

---

### Issue 10 — JWT access tokens have no refresh mechanism

**Files:** `apps/api/src/auth.ts`, `apps/api/src/routes.ts`
**Impact:** `JWT_EXPIRES_IN=2h` means every attorney session expires in two hours. The current code has no `POST /auth/refresh` endpoint and no refresh token. Attorneys mid-document will be silently logged out and will lose unsaved state. This is especially problematic for long document review sessions.

**Fix — Add a `refreshToken` httpOnly cookie and a refresh endpoint:**

```ts
// apps/api/src/auth.ts — add refresh token issuance alongside access token:
import { randomBytes } from "node:crypto";

const REFRESH_TOKEN_TTL_DAYS = 30;

export function issueTokens(reply: FastifyReply, payload: JwtPayload) {
  // Short-lived access token (existing)
  const accessToken = signJwt(payload);

  // Long-lived opaque refresh token — stored in DB, rotated on use
  const rawRefresh = `rt_${randomBytes(32).toString("hex")}`;

  reply.setCookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 2 * 60 * 60,   // 2 hours in seconds
  });

  reply.setCookie("refreshToken", rawRefresh, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    path: "/auth/refresh",   // scope refresh token to the refresh endpoint only
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });

  return rawRefresh;   // caller stores hash in DB
}
```

```ts
// apps/api/src/routes.ts — add refresh endpoint:
app.post("/auth/refresh", async (request, reply) => {
  const raw = request.cookies.refreshToken;
  if (!raw) return reply.code(401).send({ error: "No refresh token" });

  const session = await authRepository.consumeRefreshToken(raw);  // validates + rotates
  if (!session) return reply.code(401).send({ error: "Invalid or expired refresh token" });

  issueTokens(reply, { tenantId: session.tenantId, attorneyId: session.attorneyId });
  return reply.send({ ok: true });
});
```

```ts
// apps/web/lib/api.ts — in parseResponse(), handle 401 with silent refresh:
async function withRefresh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Attempt silent token refresh
      const refreshResp = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!refreshResp.ok) throw err;   // refresh also failed — user must re-login
      return await fn();               // retry original request with new token
    }
    throw err;
  }
}
```

---

### Issue 11 — No CI/CD pipeline

**Impact:** Without automated checks, every push to `main` could introduce regressions, security issues, or broken Docker images that only surface when a client notices a problem.

**Fix — Add a GitHub Actions workflow:**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx biome check .
      - run: npm run build -w @legal-agent/shared
      - run: npm run build -w @legal-agent/api
      - run: npm run build -w @legal-agent/web

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build -w @legal-agent/shared
      - run: npm test -w @legal-agent/api

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_DB: legal_agent_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/legal_agent_test
      NODE_ENV: test
      # Stub values for config validation
      OPENAI_API_KEY: sk-test
      APP_ENCRYPTION_KEY: test-encryption-key-32-bytes-long!
      JWT_SECRET: test-jwt-secret-32-bytes-long-xxx!
      PLATFORM_ADMIN_SECRET: test-platform-admin-secret-32-bytes!
      DEMO_API_KEY: test-demo-api-key-at-least-24-chars
      DEMO_USER_EMAIL: test@example.com
      DEMO_USER_PASSWORD: TestPassword123!
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build -w @legal-agent/shared
      - run: npm run test:integration -w @legal-agent/api

  docker-build:
    runs-on: ubuntu-latest
    needs: [lint-and-type-check]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -f Dockerfile.api -t legal-agent-api:${{ github.sha }} .
      - run: docker build -f Dockerfile.worker -t legal-agent-worker:${{ github.sha }} .
      - run: docker build -f Dockerfile.web -t legal-agent-web:${{ github.sha }} .
```

---

---

## 🔵 Minor

---

### Issue 12 — `DEPLOYMENT.md` contains hardcoded Windows local paths

**File:** `DEPLOYMENT.md` lines 33–35
**Impact:** A new engineer on Linux or macOS following the documentation will see broken Markdown hyperlinks pointing to `C:/Users/deeps/OneDrive/…`. This is a leftover from local development. It erodes trust in the documentation at the most critical moment — initial setup.

**Fix:**

```markdown
<!-- DEPLOYMENT.md — replace the three broken lines: -->

## Container images

The repo includes three Dockerfiles at the project root:

- `Dockerfile.web`
- `Dockerfile.api`
- `Dockerfile.worker`

Build examples from the repo root:

```bash
docker build -f Dockerfile.web -t legal-agent-web .
docker build -f Dockerfile.api -t legal-agent-api .
docker build -f Dockerfile.worker -t legal-agent-worker .
```
```

---

### Issue 13 — No observability (OpenTelemetry / structured logs / metrics)

**Files:** `apps/api/src/index.ts`, `apps/api/src/worker-main.ts`
**Impact:** Fastify's built-in `pino` logger sends JSON to stdout, which is a good start. However, with three separate services (API, worker, web) deployed on ECS/Fargate, there is no way to trace a single document upload end-to-end across the API and worker, no latency histograms to know when OpenAI calls are slow, and no alerting on job failure rates.

**Fix — Add OpenTelemetry auto-instrumentation:**

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
    @opentelemetry/exporter-trace-otlp-http --save -w @legal-agent/api
```

```ts
// apps/api/src/tracing.ts — new file, must be imported BEFORE everything else
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },  // too noisy
    }),
  ],
  serviceName: process.env.OTEL_SERVICE_NAME ?? "legal-agent-api",
});

sdk.start();
process.on("SIGTERM", () => sdk.shutdown());
```

```ts
// apps/api/src/index.ts — add as first import:
import "./tracing.js";
// ... rest of imports
```

**For AWS deployments:** Send traces to AWS X-Ray via the [ADOT Collector](https://aws-otel.github.io/docs/getting-started/collector), or use Grafana Cloud / Datadog with the OTLP exporter. Add the `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` env vars to your ECS task definitions.

---

### Issue 14 — Dockerfile base image not pinned to a digest

**Files:** `Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.web`
**Impact:** `FROM node:20-alpine` resolves to a different image layer on every build if Alpine or Node.js patch versions are updated. A supply chain attack on the `node:20-alpine` tag (unlikely but possible) would silently affect your production images.

**Fix — Pin to a specific SHA256 digest:**

```bash
# Find the current digest
docker pull node:20-alpine
docker inspect node:20-alpine --format '{{index .RepoDigests 0}}'
# Example output: node@sha256:abcd1234...
```

```dockerfile
# Dockerfile.api (and worker, web) — pin the base image:
FROM node:20-alpine@sha256:abcd1234...   # replace with actual digest

# Update the digest every time you intentionally upgrade Node.js
```

In CI, use [Dependabot's Docker digest pinning](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot) to receive automated PRs when new digests are released.

---

---

## Production Deployment Checklist

Use this checklist before accepting the first real tenant.

### Security
- [ ] All `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `PLATFORM_ADMIN_SECRET` generated with `openssl rand -base64 48` — never reuse `.env.example` values
- [ ] `SEED_DEMO_DATA=false` in all production environment configs
- [ ] `DEMO_API_KEY`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD` removed from production env (only needed if `SEED_DEMO_DATA=true`)
- [ ] `MALWARE_SCANNER=clamav` with a reachable ClamAV instance, or GuardDuty Malware Protection enabled on the S3 bucket
- [ ] TLS termination at the load balancer (ACM certificate on ALB) — API and web services themselves run HTTP internally
- [ ] CORS_ORIGIN set to the exact production web domain — no wildcards
- [ ] SAML SP private key and cert generated (`openssl req -x509 -newkey rsa:4096 -keyout saml.key -out saml.crt -days 365 -nodes`)
- [ ] All containers running as non-root user (after applying Issue 7 fix)
- [ ] RDS security group allows inbound 5432 only from the API and worker security groups — never from the internet

### Database
- [ ] `pgvector` extension installed (`CREATE EXTENSION IF NOT EXISTS vector;`)
- [ ] Database migrations run via migration runner — not raw `schema.sql` execution on startup
- [ ] RDS automated backups enabled with at least 7-day retention
- [ ] Point-in-time recovery (PITR) tested — perform a dry-run restore to a staging instance before go-live
- [ ] `DB_POOL_MAX` set appropriately per replica count

### Infrastructure
- [ ] Health checks passing: `GET /health/live` and `GET /health/ready` both return 200
- [ ] At least one dedicated worker replica — `RUN_INLINE_WORKER=false` on API
- [ ] Worker and API in separate ECS task definitions so they can be scaled independently
- [ ] CloudWatch log groups or equivalent created for API, worker, and web services
- [ ] Alerting configured on: 5xx error rate, job failure rate, OpenAI API error rate, DB connection pool exhaustion

### Compliance (Indian law firm context)
- [ ] S3 bucket region set to `ap-south-1` (Mumbai) for data residency
- [ ] S3 bucket versioning enabled for document retention/recovery
- [ ] S3 lifecycle rules configured for multi-year document retention (as required by Bar Council rules)
- [ ] Audit log table (`audit_events`) backed up separately and retained for minimum 3 years
- [ ] `WEBAUTHN_RP_ID` set to the exact production hostname (e.g., `app.yourfirm.in`)

---

## Summary by Priority

| Priority | Issues to fix before first production tenant |
|----------|---------------------------------------------|
| **Do first** | Issue 1 (pgvector), Issue 4 (demo seed), Issue 5 (migrations) |
| **Do before scaling** | Issue 2 (worker shutdown), Issue 3 (DB pool), Issue 8 (health checks) |
| **Do before first client data** | Issue 7 (non-root Docker), Issue 9 (malware scanner), Issue 10 (JWT refresh) |
| **Do before GA** | Issue 6 (tests), Issue 11 (CI/CD), Issue 13 (observability) |
| **Housekeeping** | Issue 12 (DEPLOYMENT.md paths), Issue 14 (image digest pinning) |