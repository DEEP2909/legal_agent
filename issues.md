# Legal Agent — Full Issue Report

---

## 🔴 Critical Issues

---

### 1. JWT stored in `localStorage` — XSS risk

**File:** `apps/web/app/dashboard-app.tsx`

**Problem:**
The access token is stored and retrieved via `window.localStorage` in multiple places:
```ts
window.localStorage.setItem(storageKey, result.accessToken);
const storedToken = window.localStorage.getItem(storageKey);
window.localStorage.removeItem(storageKey);
```
Any injected JavaScript (XSS) can steal the token. The server already sets an `httpOnly` cookie on login (in `routes.ts`), but the frontend ignores it and reads from `localStorage` instead. The two mechanisms are in direct conflict and `localStorage` always wins — making the `httpOnly` cookie pointless.

**Fix:**
- Stop writing the token to `localStorage` entirely.
- Rely exclusively on the `httpOnly` cookie the server already sets.
- On the frontend, remove all `localStorage.getItem/setItem/removeItem` calls for the token.
- Pass `credentials: "include"` on every fetch (already done in `withCredentials`) so the cookie is sent automatically.

---

### 2. No rate limiting on AI-heavy routes

**File:** `apps/api/src/routes.ts`

**Problem:**
`/api/documents/extract`, `/api/flags/assess`, and `/api/research/query` have zero rate limiting. Auth routes are protected with `authRateLimit`, but these three endpoints — each making expensive OpenAI calls — have no protection. A loop or runaway client can exhaust the OpenAI budget in minutes.

**Fix:**
Apply per-tenant rate limiting (e.g. 20 calls/minute) to these routes the same way auth endpoints are protected:
```ts
protectedApp.post("/api/documents/extract", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, ...)
protectedApp.post("/api/flags/assess",       { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, ...)
protectedApp.post("/api/research/query",     { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, ...)
```

---

### 3. `reviewerId` accepted but never validated

**File:** `apps/api/src/services.ts` — `reviewFeedback()`

**Problem:**
`reviewFeedback()` accepts a `reviewerId` from the request body but never verifies it belongs to the authenticated tenant. `request.authSession.attorneyId` is available but completely ignored for this field — any arbitrary ID can be submitted.

**Fix:**
Ignore `reviewerId` from the request body entirely. Always use `session.attorneyId`:
```ts
// Before
reviewerId: string  // from request body, unvalidated

// After — remove reviewerId from input, use session directly
actorAttorneyId: session.attorneyId
```

---

### 4. `approved` / `rejected` review actions do nothing

**File:** `apps/api/src/services.ts` — `reviewFeedback()`

**Problem:**
The `"approved"` and `"rejected"` actions compute a hash and return `{ stored: true }` — but nothing is actually written to the database. No flag status is updated. Only `"resolved"` calls the database via `resolveFlag()`. The review workflow is largely non-functional.

```ts
// This is the current code for approved/rejected — it does nothing real
const response = {
  id: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  stored: true
};
```

**Fix:**
Add an `updateFlagStatus(flagId, tenantId, status)` method to the repository and call it for `approved` and `rejected` actions:
```ts
if (input.action === "approved" || input.action === "rejected") {
  return repository.updateFlagStatus(input.flagId, session.tenantId, input.action);
}
```

---

## 🟠 Major Issues

---

### 5. Vector search loads all embeddings into memory

**File:** `apps/api/src/services.ts` — `research()` and `apps/api/src/repository.ts` — `getDocumentEmbeddings()`

**Problem:**
`research()` calls `getDocumentEmbeddings(tenantId)` which does a full `SELECT *` on all documents + embeddings for the tenant, loads them all into Node.js memory, then does cosine similarity in JavaScript. For a firm with 500+ documents, this loads tens of megabytes of float arrays per query.

Additionally, the repository only fetches `chunk_index = 0` — so only the first chunk of each document is used, and all other chunks are ignored.

```ts
// Current — loads everything into JS memory
const rankedDocuments = (await repository.getDocumentEmbeddings(session.tenantId))
  .map(doc => ({ document: doc, score: cosineSimilarity(questionEmbedding, doc.embedding ?? []) }))
  .sort(...)
  .slice(0, 5);
```

**Fix:**
- Install the `pgvector` Postgres extension.
- Add a vector index on `document_chunks.embedding`.
- Push similarity search into SQL using the `<=>` (cosine distance) operator:
```sql
SELECT d.*, c.text_content,
       (c.embedding <=> $1::vector) AS distance
FROM document_chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.tenant_id = $2
ORDER BY distance ASC
LIMIT 5;
```

---

### 6. Text truncation is too aggressive

**File:** `apps/api/src/services.ts` and `apps/api/src/worker.ts`

**Problem:**
Two truncation problems exist:
- In `worker.ts` and `services.ts`, only the first **4,000 characters** of a document are embedded. For a 50-page SPA, this covers roughly 2 pages.
- In `research()`, each document's text is truncated to **700 characters** for the research prompt — so the model answers based on a tiny snippet per document.

```ts
// worker.ts — only first 4000 chars embedded
const embedding = await embedTextWithOpenAI(normalizedText.slice(0, 4000));

// services.ts — only 700 chars used per document in research context
`${document.sourceName} (score ${score.toFixed(2)}): ${document.normalizedText.slice(0, 700)}`
```

**Fix:**
- During ingestion, split documents into overlapping ~1,000-token chunks, embed each chunk separately, and store them all in `document_chunks`.
- During research, retrieve the top-K most relevant chunks (not documents) and pass the full chunk text to the prompt.

---

### 7. Hardcoded default playbook — no tenant configuration

**File:** `apps/api/src/services.ts`

**Problem:**
If the caller doesn't supply a `playbook` array, `assessRisk()` falls back to 5 rules hardcoded directly in `services.ts`. There's no way for firms to configure their own persistent playbook from the admin dashboard.

```ts
const defaultPlaybook = [
  "Indemnity cap must not exceed 20% of purchase price.",
  "Governing law must be Indian law for domestic deals.",
  // ...
];
```

**Fix:**
- Add a `playbooks` table to the DB schema.
- Let tenant admins create/save playbooks in the admin dashboard.
- Auto-load the tenant's active playbook in `assessRisk()` when none is supplied in the request.

---

### 8. Worker has no exponential backoff on retries

**File:** `apps/api/src/worker.ts`

**Problem:**
The worker retries failed jobs up to `maxAttempts` times with no delay between retries. If ClamAV or OpenAI is temporarily down, all 3 attempts fire immediately, fail instantly, and the document is permanently marked as failed — when a short wait would have resolved it.

**Fix:**
Add exponential backoff between retry attempts. Store `attempt_count` and `next_attempt_at` on the job row. The worker should only claim jobs where `next_attempt_at <= now()`:
```
Attempt 1: retry after 30 seconds
Attempt 2: retry after 5 minutes
Attempt 3: retry after 30 minutes → mark as permanently failed
```

---

### 9. `pdf-parse` is unmaintained

**File:** `apps/api/src/ocr.ts`

**Problem:**
The codebase even has a `// TODO: Consider replacing pdf-parse` comment. The library has known issues with certain PDF structures and hasn't been maintained. For a legal platform processing sensitive PDFs, this is a reliability and security risk.

**Fix:**
Replace `pdf-parse` with `unpdf` or `pdfjs-dist`. Both are actively maintained, handle edge-case PDFs better, and `unpdf` has a nearly identical API.

---

### 10. `mapAttorney()` silently drops fields

**File:** `apps/api/src/repository.ts` — `mapAttorney()`

**Problem:**
The `mapAttorney` function maps DB rows to the `Attorney` type but drops `isActive`, `practiceArea`, and `lastLoginAt`. These fields exist in the DB schema and the `Attorney` type but are never mapped — so the dashboard shows incomplete attorney data silently.

```ts
// Current mapAttorney — missing fields
function mapAttorney(row: Record<string, unknown>): Attorney {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as Attorney["role"],
    isTenantAdmin: Boolean(row.is_tenant_admin),
    canLogin: Boolean(row.can_login)
    // isActive, practiceArea, lastLoginAt are missing
  };
}
```

**Fix:**
Add the missing fields:
```ts
isActive: Boolean(row.is_active),
practiceArea: String(row.practice_area ?? ""),
lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : undefined,
```

---

## 🟡 Moderate Issues

---

### 11. Tenant ID hardcoded as `"tenant-demo"` in frontend

**File:** `apps/web/app/dashboard-app.tsx`

**Problem:**
The default state for `tenantIdForSso` is the placeholder string `"tenant-demo"`:
```ts
const [tenantIdForSso, setTenantIdForSso] = useState("tenant-demo");
```
Any real firm using SSO would need to manually enter their tenant ID each time. There's no mechanism to auto-discover or pre-configure it.

**Fix:**
Read it from an environment variable at build time and fall back to empty string (forcing entry):
```ts
const [tenantIdForSso, setTenantIdForSso] = useState(
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? ""
);
```

---

### 12. Logout does not clear the httpOnly cookie

**File:** `apps/api/src/routes.ts` — `POST /auth/logout`

**Problem:**
The logout route records an audit event but never calls `reply.clearCookie("accessToken")`. A user who logs out still has a valid session cookie until JWT expiry (up to 8 hours).

**Fix:**
Add cookie clearing to the logout route:
```ts
protectedApp.post("/auth/logout", async (request, reply) => {
  // ... existing audit event ...
  reply.clearCookie("accessToken", { path: "/" });
  return { ok: true };
});
```

---

### 13. `document_chunks` table is effectively unused

**File:** `apps/api/src/worker.ts` and `apps/api/src/repository.ts`

**Problem:**
The schema defines `document_chunks` with `chunk_index`, `page_from`, `page_to`, and `citation_json` — clearly designed for multi-chunk ingestion. But the worker only ever writes a single row (`chunk_index = 0`) with the full document text, and the research query only reads `chunk_index = 0`. The table is a one-row-per-document store with wasted columns.

**Fix:**
Implement real chunking during ingestion. Split the normalized text into overlapping ~800-token chunks, embed each one, and write each as a separate row in `document_chunks`. This is required for Issue #5 (vector search) and Issue #6 (text truncation) to be properly fixed.

---

### 14. Several DB schema columns are never populated

**File:** `db/schema.sql` and `apps/api/src/repository.ts`

**Problem:**
The `documents` table has these columns that are never written to anywhere in the codebase:
- `page_count` — never set (basic metadata users expect)
- `ocr_confidence` — never set
- `dedup_group_id` — never set
- `language` — never set
- `created_by` — never set (important for audit)
- `scan_completed_at` — partially handled but inconsistently

**Fix:**
At minimum, populate `page_count` during PDF parsing, `created_by` from `session.attorneyId` when a document is uploaded, `scan_completed_at` when the malware scan job completes, and `language` during OCR/normalization.

---

### 15. Research history is stored but never exposed

**File:** `apps/api/src/services.ts` — `research()`

**Problem:**
`repository.recordResearch(result)` is called after every query, meaning research history is being saved to the DB. But there is no API endpoint to retrieve past queries or their answers. All that history is silently inaccessible from the UI.

**Fix:**
Add a `GET /api/research/history` endpoint (optionally filtered by `matterId`) and expose past queries in the Research panel in the frontend.

---

### 16. Windows absolute paths committed in README

**File:** `README.md`

**Problem:**
The implementation notes section contains hardcoded developer machine paths:
```
C:/Users/deeps/OneDrive/Documents/New project/Legal Agent/apps/api/src/database.ts
```
These are personal machine paths that were accidentally committed and will break on any other machine or environment.

**Fix:**
Replace all absolute paths in the README with relative paths from the repo root:
```
apps/api/src/database.ts
apps/api/src/repository.ts
```

---

### 17. `POST /api/admin/attorneys` bypasses the invitation flow

**File:** `apps/api/src/routes.ts`

**Problem:**
There are two paths to create an attorney account:
1. The invitation flow — sends an email, user sets their own password.
2. `POST /api/admin/attorneys` — admin sets the password directly.

The second path means attorneys can be created with passwords they never chose, may not know, or that get shared insecurely. It's inconsistent with the rest of the auth model.

**Fix:**
Either remove the direct creation endpoint or mark it as explicitly "admin-set password" and force a password reset on first login for accounts created this way.

---

### 18. Only one test file in the entire project

**File:** `apps/api/src/__tests__/security.test.ts`

**Problem:**
The only test file covers cryptographic utility functions. There are zero tests for:
- Document ingestion workflow
- Clause extraction
- Risk flagging
- Research / vector search
- Auth flows (login, MFA, SSO, passkeys)
- Route handlers
- Worker job processing

For a legal product where incorrect output has real professional consequences, this is a significant gap.

**Fix:**
At minimum, add integration tests for:
- The full document upload → scan → ingest → extract pipeline
- Login, MFA verify, and passkey flows
- `extractClauses` and `assessRisk` with mocked OpenAI responses
- Tenant isolation (ensure one tenant cannot access another's data)

---

## 🔵 Minor / Polish Issues

---

### 19. Redundant third branch in `getFinalStoragePath`

**File:** `apps/api/src/worker.ts`

**Problem:**
The function has three branches to handle `/quarantine/` path replacement. The third branch constructs the same pattern as the first and can never be reached.

```ts
// Third branch — unreachable dead code
if (storagePath.includes("/quarantine/".replace(/\//g, "\\"))) {
  return storagePath.replace("/quarantine/".replace(/\//g, "\\"), "/uploads/".replace(/\//g, "\\"));
}
```

**Fix:**
Remove the third branch entirely.

---

### 20. No-op filter in `extractClauses`

**File:** `apps/api/src/services.ts` — `extractClauses()`

**Problem:**
The return statement has a filter that is always `true`:
```ts
return clauses.filter(() => session.tenantId.length > 0);
```
`session.tenantId` is always a non-empty string at this point (enforced earlier in the auth flow), so this filter never removes anything. It looks like an unfinished stub.

**Fix:**
Remove the filter entirely, or replace it with actual filtering logic if some was intended:
```ts
return clauses;
```

---

### 21. Password validation logic is duplicated in three places

**Files:** `apps/api/src/routes.ts`, `apps/web/app/dashboard-app.tsx` (twice)

**Problem:**
Password complexity rules are defined separately in:
1. `routes.ts` — Zod `passwordSchema`
2. `dashboard-app.tsx` — `validatePassword()` function
3. `dashboard-app.tsx` — inline regex checks in the login form

If rules change (e.g. minimum length goes from 12 to 14), all three places need updating and they will drift out of sync.

**Fix:**
Define the rules once in `packages/shared` and import from there everywhere.

---

### 22. `DEMO_API_KEY` in `.env.example` fails config validation

**Files:** `apps/api/src/config.ts` and `.env.example`

**Problem:**
`config.ts` requires `DEMO_API_KEY` to be at least 24 characters:
```ts
DEMO_API_KEY: z.string().min(24, "DEMO_API_KEY must be at least 24 characters")
```
But `.env.example` provides `demo-firm-key-123` which is only 17 characters. Copying the example file directly will cause a startup validation crash.

**Fix:**
Update `.env.example` to use a value that passes validation:
```env
DEMO_API_KEY=demo-firm-api-key-change-me-123
```

---

### 23. Error responses in `parseResponse` lose HTTP status code

**File:** `apps/web/lib/api.ts` — `parseResponse()`

**Problem:**
```ts
throw new Error(body?.error || "Request failed");
```
A 401 (Unauthorized), 403 (Forbidden), 422 (Validation error), and 500 (Server error) all produce identical-looking `Error` objects. The UI has no way to distinguish them and can't show context-appropriate messages.

**Fix:**
Create a typed `ApiError` class that carries the status code:
```ts
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

throw new ApiError(response.status, body?.error || "Request failed");
```
Then check `error instanceof ApiError && error.status === 401` in the UI to redirect to login vs. showing a generic error toast.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | 🔴 Critical | `dashboard-app.tsx` | JWT in localStorage — XSS risk |
| 2 | 🔴 Critical | `routes.ts` | No rate limiting on AI endpoints |
| 3 | 🔴 Critical | `services.ts` | `reviewerId` unvalidated |
| 4 | 🔴 Critical | `services.ts` | `approved`/`rejected` review actions do nothing |
| 5 | 🟠 Major | `services.ts`, `repository.ts` | Vector search loads all embeddings into memory |
| 6 | 🟠 Major | `services.ts`, `worker.ts` | Text truncation too aggressive (4000 / 700 chars) |
| 7 | 🟠 Major | `services.ts` | Hardcoded default playbook — no tenant config |
| 8 | 🟠 Major | `worker.ts` | No exponential backoff on job retries |
| 9 | 🟠 Major | `ocr.ts` | `pdf-parse` is unmaintained |
| 10 | 🟠 Major | `repository.ts` | `mapAttorney()` silently drops `isActive`, `practiceArea`, `lastLoginAt` |
| 11 | 🟡 Moderate | `dashboard-app.tsx` | Tenant ID hardcoded as `"tenant-demo"` |
| 12 | 🟡 Moderate | `routes.ts` | Logout doesn't clear httpOnly cookie |
| 13 | 🟡 Moderate | `worker.ts`, `repository.ts` | `document_chunks` table effectively unused |
| 14 | 🟡 Moderate | `repository.ts`, `schema.sql` | `page_count`, `created_by`, etc. never populated |
| 15 | 🟡 Moderate | `services.ts` | Research history stored but never exposed |
| 16 | 🟡 Moderate | `README.md` | Windows absolute paths committed |
| 17 | 🟡 Moderate | `routes.ts` | Direct attorney creation bypasses invite flow |
| 18 | 🟡 Moderate | `__tests__/` | Only one test file, no workflow tests |
| 19 | 🔵 Minor | `worker.ts` | Unreachable third branch in `getFinalStoragePath` |
| 20 | 🔵 Minor | `services.ts` | No-op filter in `extractClauses` |
| 21 | 🔵 Minor | `routes.ts`, `dashboard-app.tsx` | Password validation duplicated in 3 places |
| 22 | 🔵 Minor | `.env.example` | `DEMO_API_KEY` too short — fails startup validation |
| 23 | 🔵 Minor | `api.ts` | `parseResponse` loses HTTP status code |
