# Legal Agent — Re-Audit After Latest Push

---

## Overall Progress: 21 of 29 issues fixed ✅

---

## ✅ Issues Now Fixed (21)

| # | Issue |
|---|-------|
| #1 | JWT removed from `localStorage` — now uses httpOnly cookies exclusively. No `storageKey`, no `setItem/getItem/removeItem`. CSRF token added to sensitive mutations. |
| #2 | AI endpoint rate limiting — `aiRateLimitConfig` applied to extract, assess, and research routes. |
| #3 | `reviewerId` removed from request body — always uses `session.attorneyId`. |
| #4 | `approved`/`rejected` review actions now write to DB via `updateFlagStatus()`. |
| #A | SQL crash from `updated_at` — fixed by using `resolved_at` which actually exists in the flags table. |
| #B | `FlagRecord.status` now includes `"approved" \| "rejected"` in shared types. |
| #5 | Vector search — `getAllDocumentChunks()` fetches all chunks across all documents and is used in `research()`. |
| #6 | Text truncation — research now uses full chunk text (1,500 chars/chunk) instead of a 700-char slice. |
| #7 | Hardcoded default playbook — `assessRisk()` now loads the tenant's active playbook from DB via `getActivePlaybook()`. |
| #8 | Exponential backoff — `failWorkflowJob()` now uses `30 * Math.pow(10, attempts - 1)` capped at 1,800 seconds. |
| #9 | `pdf-parse` replaced with `unpdf` (`import { extractText } from "unpdf"`). |
| #C | `Attorney` interface in `shared/index.ts` now includes `isActive?`, `lastLoginAt?`, and `mustResetPassword?`. |
| #11 | `tenantIdForSso` now reads from `process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? ""` instead of `"tenant-demo"`. |
| #12 | Logout correctly calls `reply.clearCookie("accessToken")`. |
| #13 | Worker now properly chunks documents (`chunkText()` with 1,500-char chunks and 200-char overlap) and embeds all chunks via `embedChunksWithConcurrencyLimit()`. |
| #15 | Research history fully implemented — `recordResearch()` writes to `research_queries` table, `GET /api/research/history` endpoint exists. |
| #16 | Windows absolute paths removed from `README.md`. |
| #17 | `POST /api/admin/attorneys` now uses `passwordSchema` (not `min(10)`), and `mustResetPassword` defaults to `true`. |
| #E | `document_chunks` indexes added: `idx_document_chunks_document` and `idx_document_chunks_tenant`. |
| #19 | Unreachable third branch in `getFinalStoragePath` removed. |
| #20 | No-op `filter()` in `extractClauses` removed. |
| #F | `POST /api/admin/attorneys` password weakness fixed — now uses `passwordSchema`. |

---

---

## ❌ Issues Still Remaining (8)

---

### Issue #10 — `mapAttorney` in `repository.ts` still missing `isActive` and `lastLoginAt`
**File:** `apps/api/src/repository.ts` lines 44–55
**Severity:** 🟠 Major

The `mapAttorney` function in `repositories/mappers.ts` was correctly fixed and now maps `isActive` and `lastLoginAt`. But `repository.ts` has its **own private copy** of `mapAttorney` that is still incomplete:

```ts
// repository.ts lines 44–55 — still missing fields
function mapAttorney(row: Record<string, unknown>): Attorney {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    canLogin: Boolean(row.can_login),
    mustResetPassword: Boolean(row.must_reset_password)
    // isActive — MISSING
    // lastLoginAt — MISSING
  };
}
```

The column list (`COLS.attorneys`) includes both `is_active` and `last_login_at` so the data is present in the query result — it is just not mapped. Every call that goes through `repository.ts`'s internal `mapAttorney` (e.g. `getDashboard`, `listAttorneys`, `createAttorney`) returns attorneys without `isActive` or `lastLoginAt`.

**Fix:**
```ts
function mapAttorney(row: Record<string, unknown>): Attorney {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    canLogin: Boolean(row.can_login),
    mustResetPassword: Boolean(row.must_reset_password),
    isActive: Boolean(row.is_active),                                                        // ← add
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : undefined  // ← add
  };
}
```

---

### Issue #14 — `page_count` still never populated
**File:** `apps/api/src/worker.ts`, `apps/api/src/services.ts`
**Severity:** 🟡 Moderate

**Partially fixed:** `created_by` and `language` are now correctly written when a document is created via `services.ts` (`addDocument` sets `createdBy: session.attorneyId` and `language: "en"`). `ocr_confidence` is also still not populated.

**Still missing:** `page_count` is never set anywhere. The `documents` schema defines `page_count integer`, the `mapDocument` function reads it as `pageCount`, and `DocumentRecord` in the shared types exposes it — but no code ever writes a value to it.

The worker's `document.ingest` job calls `extractTextForIngestion()` which calls `extractText()` from `unpdf`. The `unpdf` library returns page count information that is simply discarded.

**Fix:** In `ocr.ts`, return `pageCount` alongside the text:
```ts
// ocr.ts — for PDFs
const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
return { text, pageCount: totalPages ?? null };
```

Then in `worker.ts`, store it:
```ts
const { text: normalizedText, pageCount } = await extractTextForIngestion(...);
await repository.updateDocument(document.id, job.tenantId, (existing) => ({
  ...existing,
  normalizedText,
  pageCount,   // ← write it
  ...
}));
```

---

### Issue #18 — Still no workflow or integration tests
**File:** `apps/api/src/__tests__/`
**Severity:** 🟡 Moderate

Two test files now exist, which is an improvement. But both test only **pure utility functions** with zero external dependencies:
- `security.test.ts` — crypto helpers (password hashing, API key generation, encryption)
- `helpers.test.ts` — internal logic helpers (normalizeRedirectPath, splitFullName, buildWebRedirectUrl, etc.)

There are still **no tests** for:
- Document upload → scan → OCR → chunk → embed pipeline (the most complex and critical path)
- Clause extraction with mocked OpenAI responses
- Risk assessment / flag creation and status updates
- Research / semantic search ranking
- Login, MFA challenge, passkey authentication flows
- Tenant isolation (can Tenant A read Tenant B's documents/flags?)
- Route-level validation (does the API correctly reject malformed input?)
- Worker retry and exponential backoff behaviour

**Fix:** Add at minimum:
```
apps/api/src/__tests__/tenant-isolation.test.ts  — verifies cross-tenant access is blocked
apps/api/src/__tests__/worker.test.ts            — verifies chunking, retry backoff
apps/api/src/__tests__/services.test.ts          — verifies extractClauses, assessRisk with mocked OpenAI
```

---

### Issue #21 — One residual inline password length check remains
**File:** `apps/web/app/dashboard-app.tsx` line 630
**Severity:** 🔵 Minor

`validatePassword` is now correctly imported from `@legal-agent/shared` and used in two places. However, there is still one standalone inline check that duplicates the minimum length rule:

```ts
// dashboard-app.tsx line 630 — inline check not using shared validatePassword
} else if (password.length < 12) {
  errors.push("Password must be at least 12 characters");
}
```

This is inside the `LoginForm`'s local `validateForm()` function. If the minimum length ever changes in `shared/index.ts`, this line won't update automatically.

**Fix:** Replace the inline check with the imported function:
```ts
import { validatePassword } from "@legal-agent/shared";

// In LoginForm.validateForm():
const passwordErrors = validatePassword(password);
if (passwordErrors.length > 0) {
  errors.push(...passwordErrors);
}
```

---

### Issue #22 — `NEXT_PUBLIC_DEFAULT_TENANT_ID` missing from `.env.example`
**File:** `.env.example`
**Severity:** 🔵 Minor

The dashboard now reads `process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID` (correctly), but this variable is **not documented in `.env.example`**. Any developer setting up the project from scratch will have an empty tenant ID field on the SSO login screen with no indication of why or what to set.

```bash
grep "NEXT_PUBLIC" .env.example
# Only finds: NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
# NEXT_PUBLIC_DEFAULT_TENANT_ID is absent
```

**Fix:** Add the variable to `.env.example` with a comment:
```env
# Default tenant ID pre-filled on the SSO login screen.
# Set this to your firm's tenant UUID for single-tenant deployments.
NEXT_PUBLIC_DEFAULT_TENANT_ID=
```

---

### Issue #23 — `parseResponse` now uses `ApiError` — but callers don't handle it yet
**File:** `apps/web/app/dashboard-app.tsx`
**Severity:** 🔵 Minor

`ApiError` is correctly defined in `api.ts` and thrown with the HTTP status code:
```ts
throw new ApiError(response.status, body?.error || "Request failed");
```

However, **no error handler in `dashboard-app.tsx` uses `instanceof ApiError`** to branch on status code. All catch blocks still do:
```ts
} catch (loginError) {
  setError(loginError instanceof Error ? loginError.message : "Login failed.");
}
```

This means a 401 (expired session) and a 500 (server crash) produce the same generic error message. The `ApiError` class exists but its `status` field is never checked.

**Fix:** Add status-code-aware handling in at least the key auth catch blocks:
```ts
} catch (err) {
  if (err instanceof ApiError && err.status === 401) {
    // Session expired — clear state and go to login
    setSession(null);
    setIsAuthenticated(false);
    setAuthView("login");
    setError("Your session has expired. Please sign in again.");
  } else {
    setError(err instanceof Error ? err.message : "An unexpected error occurred.");
  }
}
```

---

### Issue — `research_queries.answer` column is nullable but should not be
**File:** `db/schema.sql` line 377
**Severity:** 🔵 Minor (new finding)

The `research_queries` table defines `answer` as nullable:
```sql
answer text,  -- nullable
```

But `recordResearch()` always writes a non-null answer from the OpenAI response, and the `GET /api/research/history` endpoint returns it as a required field. If the answer column were ever null (e.g. from a partial insert or migration), it would produce unexpected `null` values in the API response.

**Fix:**
```sql
answer text not null default '',
```

---

### Issue — `ingestDocument()` inline path still uses single embedding without chunking
**File:** `apps/api/src/services.ts` line 1533
**Severity:** 🔵 Minor (new finding)

The worker correctly chunks documents. But `ingestDocument()` in `services.ts` handles a separate code path (used when `normalizedText` is provided directly in the API request body, without a file upload). This path still generates a single embedding without chunking:

```ts
// services.ts line 1533 — no chunking, single embedding
document.embedding = await embedTextWithOpenAI(document.normalizedText.slice(0, 4000));
```

Documents ingested via this path will not benefit from the chunk-based semantic search that was implemented in the worker.

**Fix:** Apply the same `chunkText()` + `embedChunksWithConcurrencyLimit()` approach here, or call `repository.saveDocumentChunks()` after ingestion.

---

## Summary

| Category | Count |
|----------|-------|
| ✅ Fixed | 21 |
| ❌ Remaining | 8 |
| 🟠 Major remaining | 2 (#10, #14) |
| 🟡 Moderate remaining | 1 (#18) |
| 🔵 Minor remaining | 5 (#21, #22, #23, answer nullable, inline ingest) |

The repo is in significantly better shape than before. The most impactful remaining fix is **#10** (mapAttorney in repository.ts) since it causes `isActive` and `lastLoginAt` to silently return `undefined` for all attorneys returned through the dashboard, attorney list, and create-attorney flows.