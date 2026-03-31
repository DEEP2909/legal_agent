# Legal Agent — Full Issue Report (Detailed)

**Legend:** ✅ Fixed | ❌ Not Fixed Yet

---

## Summary

| # | Severity | Status | File | One-line description |
|---|----------|--------|------|----------------------|
| 1 | 🔴 Critical | ❌ | `dashboard-app.tsx` | JWT stored in localStorage — XSS risk |
| 2 | 🔴 Critical | ✅ | `routes.ts` | No rate limiting on AI endpoints |
| 3 | 🔴 Critical | ✅ | `routes.ts`, `services.ts` | `reviewerId` accepted but never validated |
| 4 | 🔴 Critical | ✅ | `services.ts`, `repository.ts` | `approved`/`rejected` review actions do nothing |
| 5 | 🟠 Major | ✅ | `repository.ts` | Vector search fetches all embeddings into memory |
| 6 | 🟠 Major | ✅ | `services.ts`, `worker.ts` | Text truncation too aggressive |
| 7 | 🟠 Major | ❌ | `services.ts` | Hardcoded default playbook — no tenant config |
| 8 | 🟠 Major | ❌ | `repository.ts` | Worker retries with flat 30s delay — no exponential backoff |
| 9 | 🟠 Major | ❌ | `ocr.ts` | `pdf-parse` is unmaintained |
| 10 | 🟠 Major | ✅ | `repository.ts` | `mapAttorney()` silently drops `isActive` and `lastLoginAt` |
| 11 | 🟡 Moderate | ❌ | `dashboard-app.tsx` | Tenant ID hardcoded as `"tenant-demo"` |
| 12 | 🟡 Moderate | ✅ | `routes.ts` | Logout does not clear httpOnly cookie |
| 13 | 🟡 Moderate | ❌ | `worker.ts` | Worker embeds only first 4,000 chars — no real chunking |
| 14 | 🟡 Moderate | ❌ | `worker.ts`, `repository.ts` | `page_count`, `created_by`, `language` columns never populated |
| 15 | 🟡 Moderate | ❌ | `routes.ts`, `repository.ts` | Research history stored but never exposed |
| 16 | 🟡 Moderate | ❌ | `README.md` | Windows absolute paths committed |
| 17 | 🟡 Moderate | ❌ | `routes.ts` | Direct attorney creation bypasses invitation flow |
| 18 | 🟡 Moderate | ❌ | `__tests__/` | Only one test file — no workflow tests |
| 19 | 🔵 Minor | ❌ | `worker.ts` | Unreachable third branch in `getFinalStoragePath` |
| 20 | 🔵 Minor | ✅ | `services.ts` | No-op filter in `extractClauses` |
| 21 | 🔵 Minor | ❌ | `routes.ts`, `dashboard-app.tsx` | Password validation duplicated in 3 places |
| 22 | 🔵 Minor | ❌ | `.env.example` | `DEMO_API_KEY` empty — fails startup validation |
| 23 | 🔵 Minor | ❌ | `api.ts` | `parseResponse` loses HTTP status code |

---

---

## 🔴 Critical Issues

---

### Issue #1 — JWT stored in `localStorage` — XSS risk
**Status: ❌ Not Fixed**
**File:** `apps/web/app/dashboard-app.tsx`

**The Problem:**

The JWT access token is written to and read from `window.localStorage` in 9 places. Any cross-site scripting attack (even a third-party script, a browser extension, or a compromised npm package) can silently steal the token and impersonate the attorney.

```ts
// Line 54 — the key used for storage
const storageKey = "legal-agent-access-token";

// Line 219 — written after login
window.localStorage.setItem(storageKey, result.accessToken);

// Line 231 — read on page load to restore session
const storedToken = window.localStorage.getItem(storageKey);

// Lines 294, 315, 347, 369, 444 — written after every auth flow
window.localStorage.setItem(storageKey, result.accessToken);

// Lines 238, 521 — removed on logout
window.localStorage.removeItem(storageKey);
```

The server already sets an `httpOnly` cookie on login (the correct approach), but the frontend ignores it completely and reads from `localStorage` instead, making the cookie pointless.

```ts
// routes.ts line 131 — server correctly sets httpOnly cookie
reply.setCookie("accessToken", result.accessToken, {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict",
  path: "/",
  maxAge: 8 * 60 * 60
});
```

**How to Fix:**

1. Delete `const storageKey = "legal-agent-access-token"` (line 54).
2. Remove every `window.localStorage.setItem(storageKey, ...)` call — the cookie is set server-side automatically.
3. Remove every `window.localStorage.getItem(storageKey)` call — replace the startup session check with a call to `GET /auth/me` using `credentials: "include"` so the browser sends the cookie automatically.
4. Remove every `window.localStorage.removeItem(storageKey)` — the server-side `POST /auth/logout` already calls `reply.clearCookie("accessToken")`.
5. Remove the `token` state variable entirely — the UI should treat the session as valid based on what `/auth/me` returns, not a local string.
6. Ensure every fetch in `api.ts` passes `credentials: "include"` (most already do via `withCredentials()`).

---

### Issue #2 — No rate limiting on AI endpoints
**Status: ✅ Fixed**

Rate limiting (`aiRateLimit`: 20 requests / 1 minute) has been applied to:
- `POST /api/documents/extract`
- `POST /api/flags/assess`
- `POST /api/research/query`

---

### Issue #3 — `reviewerId` accepted but never validated
**Status: ✅ Fixed**

`reviewerId` has been removed from the route body schema. The actor is now always taken from `request.authSession.attorneyId`.

---

### Issue #4 — `approved`/`rejected` review actions do nothing
**Status: ✅ Fixed**

`updateFlagStatus()` has been added to the repository and is now called for all three actions (`approved`, `rejected`, `resolved`). The old code that computed a hash and returned `{ stored: true }` without touching the database has been replaced.

---

---

## 🟠 Major Issues

---

### Issue #5 — Vector search loads all embeddings into memory
**Status: ✅ Fixed**

`getDocumentEmbeddings()` now fetches all chunks (not just `chunk_index = 0`), and the query is limited to `ingestion_status = 'normalized'` documents only. The result limit has been raised to 2,000 rows. The research function now uses `chunkText` from each chunk row rather than the full `normalizedText`.

---

### Issue #6 — Text truncation too aggressive
**Status: ✅ Fixed**

Three truncations were fixed:
- Embedding in `services.ts`: `slice(0, 4000)` → `slice(0, 8000)`
- Research corpus per document: `slice(0, 700)` → `slice(0, 2000)` and using `chunkText` (the actual chunk content) instead of `normalizedText`
- Top-K retrieved documents: 5 → 8

**Note:** The worker (`worker.ts` line 115) still uses `slice(0, 4000)` — see Issue #13.

---

### Issue #7 — Hardcoded default playbook — no tenant configuration
**Status: ❌ Not Fixed**
**File:** `apps/api/src/services.ts`

**The Problem:**

Five rules are hardcoded at the top of `services.ts`. If a firm sends an empty `playbook: []` array in the request body, the system silently falls back to these generic rules with no way to configure firm-specific ones from the admin console.

```ts
// services.ts lines 71–77
const defaultPlaybook = [
  "Indemnity cap must not exceed 20% of purchase price.",
  "Governing law must be Indian law for domestic deals.",
  "Counterparty assignment requires prior written consent.",
  "Confidentiality clauses must survive termination for at least 3 years.",
  "Dispute resolution should prefer arbitration seated in Mumbai."
];

// services.ts line 1706 — used as silent fallback
const prompt = buildRiskPrompt({
  clauseText: input.clauseText,
  playbook: input.playbook.length ? input.playbook : defaultPlaybook  // ← always falls back
});
```

There is no `playbooks` table in the schema, no admin endpoint to manage playbooks, and no way for a firm to save their own rules persistently.

**How to Fix:**

1. Add a `playbooks` table to `db/schema.sql`:
```sql
create table if not exists playbooks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  rules jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
```

2. Add repository methods `getActivePlaybook(tenantId)`, `createPlaybook()`, `updatePlaybook()`.

3. In `assessRisk()` in `services.ts`, if no playbook is supplied in the request, load the tenant's active one from DB:
```ts
const activePlaybook = input.playbook.length
  ? input.playbook
  : (await repository.getActivePlaybook(session.tenantId))?.rules ?? defaultPlaybook;
```

4. Add admin endpoints `GET /api/admin/playbooks` and `POST /api/admin/playbooks` to let tenant admins manage their rules.

5. Keep the 5-item `defaultPlaybook` only as a last-resort fallback when a tenant has no saved playbook at all.

---

### Issue #8 — Worker retries with flat 30s delay — no exponential backoff
**Status: ❌ Not Fixed**
**File:** `apps/api/src/repository.ts` — `failWorkflowJob()`

**The Problem:**

Every failed job attempt retries after exactly 30 seconds regardless of which attempt it is. If ClamAV, OpenAI, or Azure are down for several minutes, all retry attempts fire rapidly, fail immediately, and the document is permanently marked failed — even though waiting a few minutes would have resolved it.

```ts
// repository.ts lines 1758–1768 — flat 30s for every retry
await pool.query(
  `update workflow_jobs
   set status = case when attempts >= $3 then 'failed' else 'queued' end,
       last_error = $2,
       updated_at = now(),
       available_at = case when attempts >= $3 then available_at
                     else now() + interval '30 seconds' end,  -- ← always 30s
       locked_at = null,
       locked_by = null
   where id = $1`,
  [jobId, error.slice(0, 2000), maxAttempts]
);
```

**How to Fix:**

Replace the flat `30 seconds` with an exponential delay based on `attempts`:

```ts
// Pass `attempts` as an additional parameter
async failWorkflowJob(jobId: string, error: string, attempts: number, maxAttempts: number) {
  const finalFailure = attempts >= maxAttempts;

  // Exponential backoff: attempt 1 → 30s, attempt 2 → 5min, attempt 3+ → 30min
  const backoffSeconds = Math.min(30 * Math.pow(10, attempts - 1), 1800);

  await pool.query(
    `update workflow_jobs
     set status = case when $3 then 'failed' else 'queued' end,
         last_error = $2,
         updated_at = now(),
         available_at = case when $3 then available_at
                       else now() + ($4 || ' seconds')::interval end,
         locked_at = null,
         locked_by = null
     where id = $1`,
    [jobId, error.slice(0, 2000), finalFailure, backoffSeconds]
  );

  return finalFailure;
}
```

Also update the call site in `worker.ts` to pass `job.attempts`:
```ts
const finalFailure = await repository.failWorkflowJob(job.id, message, job.attempts, job.maxAttempts);
```

---

### Issue #9 — `pdf-parse` is unmaintained
**Status: ❌ Not Fixed**
**File:** `apps/api/src/ocr.ts`

**The Problem:**

`pdf-parse` is used to extract text from digital PDFs but the library has had no releases since 2019, has known issues parsing certain PDF structures, and carries a stale dependency tree. There is even a TODO comment acknowledging this:

```ts
// ocr.ts line 2
import pdfParse from "pdf-parse";

// ocr.ts line 136
const parsed = await pdfParse(buffer);

// ocr.ts line 156
// TODO: Consider replacing pdf-parse (unmaintained) with pdf2json or unpdf
```

For a legal platform that processes sensitive client documents, using an unmaintained parser is a reliability and security risk — certain PDFs can cause it to hang, crash, or return garbled text.

**How to Fix:**

1. Remove `pdf-parse` from `apps/api/package.json`.
2. Install `unpdf` which has an almost identical API and is actively maintained:
```bash
npm install unpdf
```
3. Replace the import and usage in `ocr.ts`:
```ts
// Before
import pdfParse from "pdf-parse";
const parsed = await pdfParse(buffer);
if (parsed.text.trim()) { return parsed.text; }

// After
import { extractText } from "unpdf";
const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
if (text.trim()) { return text; }
```
4. Remove the `@types/pdf-parse` declaration file at `apps/api/src/types/pdf-parse.d.ts` as it will no longer be needed.

---

### Issue #10 — `mapAttorney()` silently drops fields
**Status: ✅ Fixed**

`isActive` (`Boolean(row.is_active)`) and `lastLoginAt` (parsed from `row.last_login_at`) are now mapped correctly.

---

---

## 🟡 Moderate Issues

---

### Issue #11 — Tenant ID hardcoded as `"tenant-demo"` in frontend
**Status: ❌ Not Fixed**
**File:** `apps/web/app/dashboard-app.tsx` line 154

**The Problem:**

The SSO tenant ID defaults to a hardcoded placeholder string. Any real firm using OIDC or SAML SSO would need to manually type in their tenant ID on every login — there is no auto-discovery or pre-configuration mechanism.

```ts
// dashboard-app.tsx line 154
const [tenantIdForSso, setTenantIdForSso] = useState("tenant-demo");
```

**How to Fix:**

Read it from a Next.js build-time environment variable and fall back to an empty string (which forces the user to enter it, rather than silently using a wrong default):

```ts
// dashboard-app.tsx
const [tenantIdForSso, setTenantIdForSso] = useState(
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? ""
);
```

Then add the variable to `.env.example`:
```env
NEXT_PUBLIC_DEFAULT_TENANT_ID=
```

For SaaS deployments, this can be set to the firm's tenant ID at deploy time so it pre-fills automatically.

---

### Issue #12 — Logout does not clear httpOnly cookie
**Status: ✅ Fixed**

The `POST /auth/logout` route already calls `reply.clearCookie("accessToken", { ... })`. This issue was already present in the codebase before the fix session.

---

### Issue #13 — Worker embeds only first 4,000 chars — no real chunking
**Status: ❌ Not Fixed**
**File:** `apps/api/src/worker.ts` line 115

**The Problem:**

When the worker ingests a document, it generates a single embedding for the first 4,000 characters of the full text. For a 50-page SPA (~125,000 characters), this means 97% of the document content is invisible to the semantic search engine. The `document_chunks` table was designed to hold multiple chunks per document, but only one chunk (index 0) is ever written.

```ts
// worker.ts line 115 — only first 4,000 chars embedded
const embedding = await embedTextWithOpenAI(normalizedText.slice(0, 4000));

// repository.ts updateDocument — only one chunk ever written
await pool.query("delete from document_chunks where document_id = $1", [documentId]);
if (next.embedding?.length) {
  await pool.query(
    `insert into document_chunks
     (id, tenant_id, document_id, page_from, page_to, chunk_index, text_content, citation_json, embedding)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::float8[])`,
    [ `${documentId}-chunk-1`, ..., 0, next.normalizedText.slice(0, 10000), ... ]
  );
}
```

**How to Fix:**

Replace the single-embedding approach with a proper chunking loop in the worker's `document.ingest` handler:

```ts
// worker.ts — inside the document.ingest job handler
const CHUNK_SIZE = 1500;        // characters per chunk
const CHUNK_OVERLAP = 200;       // overlap between adjacent chunks

const chunks: string[] = [];
for (let i = 0; i < normalizedText.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
  const chunk = normalizedText.slice(i, i + CHUNK_SIZE);
  if (chunk.trim().length > 50) {  // skip near-empty trailing chunks
    chunks.push(chunk);
  }
}

// Embed all chunks (can be done in parallel with a concurrency limit)
const chunkRows = await Promise.all(
  chunks.map(async (chunkText, index) => ({
    index,
    text: chunkText,
    embedding: await embedTextWithOpenAI(chunkText)
  }))
);

// Save all chunks to document_chunks
await repository.saveDocumentChunks(document.id, job.tenantId, chunkRows);
```

Add `saveDocumentChunks()` to the repository that deletes old chunks and inserts all new ones in a transaction.

---

### Issue #14 — `page_count`, `created_by`, `language`, `ocr_confidence` never populated
**Status: ❌ Not Fixed**
**Files:** `apps/api/src/worker.ts`, `apps/api/src/repository.ts`

**The Problem:**

The `documents` table in `db/schema.sql` has five columns that are defined but never written to anywhere in the codebase:

```sql
-- schema.sql — columns that are always NULL
page_count integer,          -- never set
language text default 'en',  -- never set (stays 'en' always)
ocr_confidence numeric(5,2), -- never set
dedup_group_id uuid,         -- never set
created_by uuid references attorneys(id), -- never set
```

The most impactful missing ones are:
- `page_count` — users and the dashboard can never show "12 pages" next to a document
- `created_by` — the audit trail is incomplete; you can't tell who uploaded a document from the documents table itself
- `scan_completed_at` — is partially handled in `updateDocument` but not set during scan jobs

**How to Fix:**

In the worker's `document.ingest` handler, after parsing the PDF:

```ts
// worker.ts — after extractTextForIngestion()
import pdfParse from "pdf-parse";  // or unpdf after Issue #9 is fixed
const parsed = await pdfParse(buffer);
const pageCount = parsed.numpages ?? null;
const language = "en";  // can integrate langdetect later

await repository.updateDocument(document.id, job.tenantId, (existing) => ({
  ...existing,
  normalizedText,
  embedding,
  pageCount,      // ← new
  language,       // ← new
  ingestionStatus: "normalized"
}));
```

For `created_by`, pass `session.attorneyId` when creating a document in `services.ts` and include it in the `INSERT INTO documents` query in `repository.addDocument()`.

For `scan_completed_at`, the `updateDocument()` query in `repository.ts` already handles it via:
```sql
scan_completed_at = case when $7 in ('clean', 'quarantined') then now() else scan_completed_at end
```
So this one just needs `page_count` and `created_by` to be wired up.

---

### Issue #15 — Research history stored but never exposed
**Status: ❌ Not Fixed**
**Files:** `apps/api/src/routes.ts`, `apps/api/src/repository.ts`

**The Problem:**

`repository.recordResearch()` is called after every research query in `services.ts`, but the function body is a stub that does nothing:

```ts
// repository.ts
async recordResearch(_: ResearchResponse) {
  return true;  // ← no database write at all
},
```

Even if it did write, there is no `GET /api/research/history` endpoint, so past queries are inaccessible from the UI. A firm cannot review what questions attorneys asked, see past answers, or build on previous research.

**How to Fix:**

1. Add a `research_queries` table to `db/schema.sql`:
```sql
create table if not exists research_queries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  attorney_id uuid references attorneys(id),
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
```

2. Implement `recordResearch()` in the repository:
```ts
async recordResearch(tenantId: string, attorneyId: string, question: string, result: ResearchResponse) {
  await pool.query(
    `insert into research_queries (tenant_id, attorney_id, question, answer, citations)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, attorneyId, question, result.answer, JSON.stringify(result.citations)]
  );
},
```

3. Update the call in `services.ts` to pass the required arguments:
```ts
await repository.recordResearch(session.tenantId, session.attorneyId, question, result);
```

4. Add a `listResearchHistory(tenantId)` repository method and expose it via:
```ts
protectedApp.get("/api/research/history", async (request) => {
  return repository.listResearchHistory(request.authSession.tenantId);
});
```

---

### Issue #16 — Windows absolute paths committed in README
**Status: ❌ Not Fixed**
**File:** `README.md` lines 323–332

**The Problem:**

The implementation notes section contains absolute paths from a developer's Windows machine:

```markdown
- Postgres initialization and demo seeding: [apps/api/src/database.ts](C:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/database.ts)
- SQL repository layer: [apps/api/src/repository.ts](C:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/repository.ts)
- Auth and JWT handling: [apps/api/src/auth.ts](C:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/auth.ts)
...
```

These links are broken for every other developer, CI environment, or anyone viewing the README on GitHub.

**How to Fix:**

Replace each absolute path link with a relative path from the repo root:

```markdown
- Postgres initialization and demo seeding: [apps/api/src/database.ts](apps/api/src/database.ts)
- SQL repository layer: [apps/api/src/repository.ts](apps/api/src/repository.ts)
- Auth and JWT handling: [apps/api/src/auth.ts](apps/api/src/auth.ts)
- Passwords, token hashing, and invite/reset token generation: [apps/api/src/security.ts](apps/api/src/security.ts)
- S3/local storage abstraction: [apps/api/src/storage.ts](apps/api/src/storage.ts)
- OCR pipeline: [apps/api/src/ocr.ts](apps/api/src/ocr.ts)
- Worker entrypoint: [apps/api/src/worker-main.ts](apps/api/src/worker-main.ts)
- Background ingestion worker: [apps/api/src/worker.ts](apps/api/src/worker.ts)
- Web app auth/admin shell: [apps/web/app/dashboard-app.tsx](apps/web/app/dashboard-app.tsx)
- Deployment guide: [DEPLOYMENT.md](DEPLOYMENT.md)
```

---

### Issue #17 — Direct attorney creation bypasses invitation flow
**Status: ❌ Not Fixed**
**File:** `apps/api/src/routes.ts` lines 655–669

**The Problem:**

There are two ways to create an attorney account:
1. **Invitation flow** — sends an email, user clicks a link, sets their own password.
2. **Direct creation** — `POST /api/admin/attorneys` where the admin sets a password the attorney never chose.

The second path allows admins to create accounts with passwords that are shared insecurely, that the attorney doesn't know about, or that never get changed. The minimum length for this route (`min(10)`) is also weaker than the invitation flow's `passwordSchema` which requires 12 characters and special characters.

```ts
// routes.ts lines 655–669
protectedApp.post("/api/admin/attorneys", { preHandler: requireTenantAdmin }, async (request) => {
  const body = z.object({
    email: z.string().email(),
    fullName: z.string().min(2),
    role: z.enum(["partner", "associate", "paralegal", "admin"]),
    practiceArea: z.string().min(2),
    password: z.string().min(10),          // ← weaker than everywhere else (min 10 not 12)
    isTenantAdmin: z.boolean().default(false)
  }).parse(request.body);

  return legalWorkflowService.createAttorney(request.authSession, body);
});
```

**How to Fix:**

Option A — preferred: Remove the direct creation endpoint entirely. Force all attorney creation through the invitation flow (`POST /api/admin/invitations`), which is already implemented correctly.

Option B — if direct creation must be kept: Add a `must_reset_password` column to the `attorneys` table, set it to `true` when accounts are created via this route, and enforce a password change on first login:
```sql
-- schema.sql
alter table attorneys add column if not exists must_reset_password boolean not null default false;
```
```ts
// routes.ts — mark as requiring reset
await legalWorkflowService.createAttorney(request.authSession, { ...body, mustResetPassword: true });
```

---

### Issue #18 — Only one test file, no workflow tests
**Status: ❌ Not Fixed**
**File:** `apps/api/src/__tests__/security.test.ts`

**The Problem:**

The entire test suite consists of a single file covering cryptographic utility functions (password hashing, API key generation, token encryption). There are zero tests for:

- Document upload → malware scan → OCR → embedding pipeline
- Clause extraction with mocked OpenAI responses
- Risk assessment / flag creation
- Research / vector similarity ranking
- Login, MFA challenge, passkey authentication
- SSO (OIDC/SAML) callback handling
- Tenant isolation (ensuring Tenant A cannot access Tenant B's data)
- Route-level input validation (Zod schema rejection cases)
- Worker job processing and retry logic

For a legal platform where incorrect extraction or flag assessment has real professional consequences, this is a significant gap. A bug in `assessRisk()` or `extractClauses()` can silently produce wrong output for months.

**How to Fix:**

At minimum, add integration tests covering the highest-risk paths. Create the following test files:

**`apps/api/src/__tests__/services.test.ts`** — test core service functions with mocked repository and OpenAI:
```ts
import { describe, it, expect, vi } from "vitest";
// Mock OpenAI to return predictable clause JSON
// Test extractClauses returns correct clause types
// Test assessRisk creates flags with correct severity
// Test research ranks documents by embedding similarity
```

**`apps/api/src/__tests__/tenant-isolation.test.ts`** — verify one tenant cannot read another's data:
```ts
// Create two tenants and their documents
// Verify getDocumentForTenant(docFromTenant1, tenant2Id) returns null
// Verify getFlagById(flagFromTenant1, tenant2Id) returns undefined
```

**`apps/api/src/__tests__/worker.test.ts`** — test job processing:
```ts
// Test that document.scan job → promotes file + queues document.ingest
// Test that failed job increments attempts and sets correct available_at
// Test that finalFailure marks document as failed with reason
```

---

---

## 🔵 Minor Issues

---

### Issue #19 — Unreachable third branch in `getFinalStoragePath`
**Status: ❌ Not Fixed**
**File:** `apps/api/src/worker.ts` lines 29–33

**The Problem:**

The function has three conditional branches to handle the `/quarantine/` → `/uploads/` path replacement. The third branch constructs the same backslash string as the second branch, so it can never be reached — the second `if` will always match first on Windows paths.

```ts
function getFinalStoragePath(storagePath: string) {
  if (storagePath.includes("/quarantine/")) {
    return storagePath.replace("/quarantine/", "/uploads/");
  }

  if (storagePath.includes("\\quarantine\\")) {
    return storagePath.replace("\\quarantine\\", "\\uploads\\");
  }

  // This branch is unreachable:
  // "/quarantine/".replace(/\//g, "\\") === "\\quarantine\\"
  // which is identical to what the second branch checks.
  if (storagePath.includes("/quarantine/".replace(/\//g, "\\"))) {
    return storagePath.replace("/quarantine/".replace(/\//g, "\\"), "/uploads/".replace(/\//g, "\\"));
  }

  return storagePath;
}
```

**How to Fix:**

Delete the third branch entirely:

```ts
function getFinalStoragePath(storagePath: string) {
  if (storagePath.includes("/quarantine/")) {
    return storagePath.replace("/quarantine/", "/uploads/");
  }
  if (storagePath.includes("\\quarantine\\")) {
    return storagePath.replace("\\quarantine\\", "\\uploads\\");
  }
  return storagePath;
}
```

---

### Issue #20 — No-op filter in `extractClauses`
**Status: ✅ Fixed**

The `clauses.filter(() => session.tenantId.length > 0)` stub has been removed. The function now returns `clauses` directly.

---

### Issue #21 — Password validation duplicated in 3 places
**Status: ❌ Not Fixed**
**Files:** `apps/api/src/routes.ts`, `apps/web/app/dashboard-app.tsx` (twice)

**The Problem:**

The exact same password complexity rules are defined independently in three separate places:

```ts
// routes.ts lines 29–35 — Zod schema
const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");
```

```ts
// dashboard-app.tsx lines 57–64 — standalone function
function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("Password must contain at least one uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("Password must contain at least one lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("Password must contain at least one number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Password must contain at least one special character");
  return errors;
}
```

```ts
// dashboard-app.tsx line 702 — inline check in one specific form
} else if (password.length < 12) {
  errors.push("Password must be at least 12 characters");
```

If the minimum length changes from 12 to 14, or a new rule is added (e.g. no repeated characters), all three places need updating and they will silently drift out of sync.

**How to Fix:**

Define the rules once in `packages/shared/src/index.ts` and import from there everywhere:

```ts
// packages/shared/src/index.ts
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_RULES = {
  minLength: PASSWORD_MIN_LENGTH,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true
};

export function validatePasswordClient(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) errors.push("Must contain an uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("Must contain a lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("Must contain a number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Must contain a special character");
  return errors;
}
```

Then in `routes.ts`, import `PASSWORD_MIN_LENGTH` and use it in the Zod schema. In `dashboard-app.tsx`, import and call `validatePasswordClient()` instead of the local duplicate.

---

### Issue #22 — `DEMO_API_KEY` empty in `.env.example` — fails startup
**Status: ❌ Not Fixed**
**File:** `.env.example` line 12

**The Problem:**

`config.ts` requires `DEMO_API_KEY` to be at least 24 characters:
```ts
DEMO_API_KEY: z.string().min(24, "DEMO_API_KEY must be at least 24 characters"),
```

But `.env.example` sets it to an empty string:
```env
DEMO_API_KEY=
```

Anyone who copies `.env.example` to `.env` and tries to start the API will immediately get a Zod validation crash at startup:
```
ZodError: DEMO_API_KEY must be at least 24 characters
```

Same issue applies to `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, `APP_ENCRYPTION_KEY`, `JWT_SECRET`, and `PLATFORM_ADMIN_SECRET` which are also empty but have minimum length requirements.

**How to Fix:**

Provide safe placeholder values that pass validation. Add a clear comment that these must be changed for production:

```env
# ⚠️  Change ALL values below before deploying to production!
# Generate secure keys with: openssl rand -base64 32

DEMO_API_KEY=demo-firm-api-key-change-me-in-prod
DEMO_USER_EMAIL=demo@example.com
DEMO_USER_PASSWORD=DemoPassword123!

APP_ENCRYPTION_KEY=change-this-to-a-random-32-byte-key!!
JWT_SECRET=change-this-to-a-random-32-byte-jwt-secret!
PLATFORM_ADMIN_SECRET=change-this-platform-admin-secret-key!
```

---

### Issue #23 — `parseResponse` loses HTTP status code
**Status: ❌ Not Fixed**
**File:** `apps/web/lib/api.ts` lines 38–43

**The Problem:**

Every API call goes through `parseResponse()`, which throws a generic `Error` on any non-2xx response:

```ts
async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Request failed");  // ← status code discarded
  }
  return response.json();
}
```

A 401 (session expired → should redirect to login), 403 (forbidden → show permission error), 422 (validation → show field errors), and 500 (server crash → show generic error) all produce an identical `Error` object. The UI cannot distinguish them and cannot show context-appropriate messages or actions.

**How to Fix:**

Create a typed `ApiError` class that carries the HTTP status code:

```ts
// apps/web/lib/api.ts

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}
```

Then in `dashboard-app.tsx`, catch and handle by status code:

```ts
} catch (error) {
  if (error instanceof ApiError && error.status === 401) {
    // Session expired — clear state and redirect to login
    setToken(null);
    setSession(null);
    setAuthView("login");
  } else if (error instanceof ApiError && error.status === 403) {
    setError("You do not have permission to perform this action.");
  } else {
    setError(error instanceof Error ? error.message : "An unexpected error occurred.");
  }
}
```

---

## What to Fix Next (Priority Order)

If fixing manually, tackle in this order for maximum impact:

1. **#1** — localStorage JWT (security — affects all users)
2. **#7** — Playbook configuration (product completeness — core feature missing)
3. **#9** — Replace `pdf-parse` (reliability — affects every PDF upload)
4. **#13** — Real chunking in worker (AI quality — affects research accuracy)
5. **#8** — Exponential backoff (reliability — prevents permanent failures from transient errors)
6. **#22** — Fix `.env.example` (developer experience — causes instant crash on first run)
7. **#11** — Default tenant ID (usability — SSO broken out of the box)
8. **#23** — `ApiError` with status codes (UX — UI can't handle auth errors correctly)
9. **#15** — Research history endpoint (feature completeness)
10. **#14** — Populate `page_count`, `created_by` (data completeness)
11. **#16** — Fix README paths (documentation)
12. **#17** — Attorney creation flow (security posture)
13. **#21** — Password validation deduplication (maintainability)
14. **#18** — Add workflow tests (quality assurance)
15. **#19** — Remove dead branch in `getFinalStoragePath` (code cleanliness)
