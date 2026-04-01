# Legal Agent — Full Re-Audit Report

**Date of audit:** Current state of `/home/claude/legal_agent_fixed`

---

## Summary Table

| # | Severity | Status | File(s) | Issue |
|---|----------|--------|---------|-------|
| 1 | 🔴 Critical | ❌ Not Fixed | `dashboard-app.tsx` | JWT stored in localStorage (XSS risk) |
| 2 | 🔴 Critical | ✅ Fixed | `routes.ts` | No rate limiting on AI endpoints |
| 3 | 🔴 Critical | ✅ Fixed | `routes.ts`, `services.ts` | `reviewerId` accepted but never validated |
| 4 | 🔴 Critical | ⚠️ Partially Fixed — NEW BUG INTRODUCED | `repository.ts`, `schema.sql`, `shared/index.ts` | Review actions DB write crashes + type mismatch |
| 5 | 🟠 Major | ✅ Fixed | `repository.ts` | Vector search only fetched chunk 0 |
| 6 | 🟠 Major | ✅ Fixed | `services.ts` | Text truncation too aggressive |
| 7 | 🟠 Major | ❌ Not Fixed | `services.ts` | Hardcoded default playbook |
| 8 | 🟠 Major | ❌ Not Fixed | `repository.ts` | Worker retries flat 30s — no exponential backoff |
| 9 | 🟠 Major | ❌ Not Fixed | `ocr.ts` | `pdf-parse` is unmaintained |
| 10 | ⚠️ Partially Fixed — NEW BUG | `repository.ts`, `repositories/mappers.ts`, `shared/index.ts` | `mapAttorney` fix only applied in one of two files |
| 11 | 🟡 Moderate | ❌ Not Fixed | `dashboard-app.tsx` | `tenantIdForSso` hardcoded as `"tenant-demo"` |
| 12 | 🟡 Moderate | ✅ Fixed | `routes.ts` | Logout did not clear httpOnly cookie |
| 13 | 🟡 Moderate | ❌ Not Fixed | `worker.ts` | Worker embeds only first 4,000 chars — no chunking |
| 14 | 🟡 Moderate | ❌ Not Fixed | `worker.ts`, `repository.ts` | `page_count`, `created_by`, `language` never populated |
| 15 | 🟡 Moderate | ❌ Not Fixed | `routes.ts`, `repository.ts` | Research history stored but never exposed |
| 16 | 🟡 Moderate | ❌ Not Fixed | `README.md` | Windows absolute paths committed |
| 17 | 🟡 Moderate | ❌ Not Fixed | `routes.ts` | Direct attorney creation bypasses invite flow |
| 18 | 🟡 Moderate | ❌ Not Fixed | `__tests__/` | Only one test file |
| 19 | 🔵 Minor | ❌ Not Fixed | `worker.ts` | Unreachable third branch in `getFinalStoragePath` |
| 20 | 🔵 Minor | ✅ Fixed | `services.ts` | No-op filter in `extractClauses` |
| 21 | 🔵 Minor | ❌ Not Fixed | `routes.ts`, `dashboard-app.tsx` | Password validation duplicated in 3 places |
| 22 | 🔵 Minor | ❌ Not Fixed | `.env.example` | `DEMO_API_KEY` empty — crashes startup |
| 23 | 🔵 Minor | ❌ Not Fixed | `apps/web/lib/api.ts` | `parseResponse` loses HTTP status code |
| **A** | **🔴 NEW CRITICAL** | ❌ | `repository.ts`, `db/schema.sql` | `updateFlagStatus` references `updated_at` column that doesn't exist in flags table — SQL crash |
| **B** | **🔴 NEW CRITICAL** | ❌ | `packages/shared/src/index.ts` | `FlagRecord.status` type is `"open" \| "resolved"` — excludes `"approved"` and `"rejected"` which are now set |
| **C** | **🟠 NEW MAJOR** | ❌ | `apps/api/src/repositories/mappers.ts` | Duplicate `mapAttorney` in separate mappers file still missing `isActive` and `lastLoginAt` |
| **D** | **🟠 NEW MAJOR** | ❌ | `packages/shared/src/index.ts` | `Attorney` interface missing `isActive` and `lastLoginAt` fields that `mapAttorney` now returns |
| **E** | **🟡 NEW MODERATE** | ❌ | `db/schema.sql` | No index on `document_chunks(document_id)` — new all-chunks query will do full scans |
| **F** | **🔵 NEW MINOR** | ❌ | `apps/api/src/routes.ts` | `POST /api/admin/attorneys` uses `password.min(10)` while all other routes use `passwordSchema` (min 12 + complexity) |

---

---

## 🔴 Critical — Not Fixed

---

### Issue #1 — JWT stored in `localStorage` (9 occurrences)
**File:** `apps/web/app/dashboard-app.tsx`

Still fully unfixed. All 9 occurrences remain:

```ts
const storageKey = "legal-agent-access-token"; // line 54

// After every auth success (lines 219, 294, 315, 347, 369, 444):
window.localStorage.setItem(storageKey, result.accessToken);

// On page load (line 231):
const storedToken = window.localStorage.getItem(storageKey);

// On logout (lines 238, 521):
window.localStorage.removeItem(storageKey);
```

The server already sets an `httpOnly` cookie correctly (`routes.ts` line 131). The frontend must be changed to stop using localStorage and rely on the cookie exclusively via `credentials: "include"` on all fetches.

---

### Issue #A (NEW) — `updateFlagStatus` references non-existent `updated_at` column — SQL crash
**File:** `apps/api/src/repository.ts` and `db/schema.sql`

This is a **newly introduced bug** from the fix attempt for issue #4. The `updateFlagStatus` function was added with this SQL:

```ts
// repository.ts
async updateFlagStatus(flagId: string, tenantId: string, status: ...) {
  const result = await pool.query(
    `update flags set status = $3, updated_at = now()   ← CRASH: column does not exist
     where id = $1 and tenant_id = $2
     returning *`,
    [flagId, tenantId, status]
  );
}
```

But the `flags` table in `db/schema.sql` has **no `updated_at` column**:

```sql
create table if not exists flags (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  ...
  status text not null default 'open',
  assigned_to uuid references attorneys(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz    ← only timestamp column, no updated_at
);
```

Every call to `reviewFeedback()` with any action will throw a Postgres error: `column "updated_at" of relation "flags" does not exist`.

**Fix — two options:**

Option A: Add the column to the schema:
```sql
-- db/schema.sql (add to flags table definition)
alter table flags add column if not exists updated_at timestamptz;

-- Also add a migration file: db/migrations/002_add_flags_updated_at.sql
alter table flags add column if not exists updated_at timestamptz;
```

Option B: Remove `updated_at` from the query:
```ts
async updateFlagStatus(flagId: string, tenantId: string, status: "open" | "resolved" | "approved" | "rejected") {
  const result = await pool.query(
    `update flags set status = $3
     where id = $1 and tenant_id = $2
     returning *`,
    [flagId, tenantId, status]
  );
  return result.rows[0] ? mapFlag(result.rows[0]) : undefined;
},
```

Option A is better long-term. Option B is the quickest fix.

---

### Issue #B (NEW) — `FlagRecord.status` type excludes `"approved"` and `"rejected"`
**File:** `packages/shared/src/index.ts`

`FlagRecord` defines status as only two values:

```ts
// shared/index.ts
export interface FlagRecord {
  ...
  status: "open" | "resolved";  ← missing "approved" and "rejected"
}
```

But `updateFlagStatus` now sets it to `"approved"` or `"rejected"`. This creates a TypeScript type mismatch — the return value of `updateFlagStatus` will contain a status that doesn't match the type, and callers in the UI expecting `"open" | "resolved"` will receive unexpected values silently.

**Fix:** Expand the type in `shared/index.ts`:
```ts
export interface FlagRecord {
  ...
  status: "open" | "resolved" | "approved" | "rejected";
}
```

---

---

## 🟠 Major — Not Fixed or Partially Fixed

---

### Issue #4 — Review actions (Partially Fixed — see bugs A and B above)
**Status:** The logic now calls `updateFlagStatus()` instead of returning a fake hash. But two breakages were introduced: the SQL crash (#A) and the type mismatch (#B). Fix both A and B to complete this issue.

---

### Issue #7 — Hardcoded default playbook
**File:** `apps/api/src/services.ts` lines 71–77 and 1706

Still entirely unfixed:

```ts
const defaultPlaybook = [
  "Indemnity cap must not exceed 20% of purchase price.",
  "Governing law must be Indian law for domestic deals.",
  "Counterparty assignment requires prior written consent.",
  "Confidentiality clauses must survive termination for at least 3 years.",
  "Dispute resolution should prefer arbitration seated in Mumbai."
];
// ...
playbook: input.playbook.length ? input.playbook : defaultPlaybook  // line 1706
```

No `playbooks` table, no admin endpoint, no way for a firm to configure their own rules.

---

### Issue #8 — Worker retry uses flat 30s — no exponential backoff
**File:** `apps/api/src/repository.ts` — `failWorkflowJob()`

Still unfixed. Every retry is scheduled exactly 30 seconds out:

```ts
available_at = case when attempts >= $3 then available_at
               else now() + interval '30 seconds' end,  ← always 30s
```

If ClamAV or OpenAI is down for 5 minutes, all 3 attempts fire in quick succession and the document is permanently failed.

---

### Issue #9 — `pdf-parse` is unmaintained
**File:** `apps/api/src/ocr.ts`

Still unfixed. The `import pdfParse from "pdf-parse"` and the TODO comment are both still there:

```ts
import pdfParse from "pdf-parse";         // line 2
// ...
const parsed = await pdfParse(buffer);    // line 136
// TODO: Consider replacing pdf-parse (unmaintained) with pdf2json or unpdf  // line 156
```

---

### Issue #10 — `mapAttorney` fix missed the second copy
**Status:** ⚠️ Partially Fixed

The fix was applied to `repository.ts` but there is a **second `mapAttorney` function** in `apps/api/src/repositories/mappers.ts` that was **not touched** and still has the old, incomplete mapping:

```ts
// repositories/mappers.ts — STILL THE OLD VERSION
export function mapAttorney(row: Record<string, unknown>): Attorney {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    canLogin: Boolean(row.can_login)
    // isActive and lastLoginAt still missing here
  };
}
```

This file is imported by other parts of the codebase. Any code using this mapper will still return incomplete attorney data.

---

### Issue #C (NEW) — `Attorney` interface in shared package missing `isActive` and `lastLoginAt`
**File:** `packages/shared/src/index.ts`

`mapAttorney` in `repository.ts` now returns `isActive` and `lastLoginAt`, but the `Attorney` interface in the shared package doesn't define these fields:

```ts
// shared/index.ts — current
export interface Attorney {
  id: string;
  fullName: string;
  email: string;
  role: "partner" | "associate" | "paralegal" | "admin";
  practiceArea: string;
  isTenantAdmin?: boolean;
  canLogin?: boolean;
  // isActive and lastLoginAt not declared — TypeScript won't surface them
}
```

**Fix:** Add both fields to the interface:
```ts
export interface Attorney {
  id: string;
  fullName: string;
  email: string;
  role: "partner" | "associate" | "paralegal" | "admin";
  practiceArea: string;
  isTenantAdmin?: boolean;
  canLogin?: boolean;
  isActive?: boolean;           // ← add
  lastLoginAt?: string;         // ← add
}
```

---

### Issue #13 — Worker still embeds only first 4,000 chars
**File:** `apps/api/src/worker.ts` line 115

Still entirely unfixed. `services.ts` was raised to 8,000 chars (for the inline ingest path), but the **worker's ingest job** — which handles all uploaded files — still uses the old truncation:

```ts
// worker.ts line 115 — unchanged
const embedding = await embedTextWithOpenAI(normalizedText.slice(0, 4000));
```

This is the primary code path for the majority of documents (those uploaded via file upload). Most real legal documents are processed through the worker, not through the inline ingest endpoint.

---

### Issue #14 — `page_count`, `created_by`, `language` never populated
**File:** `apps/api/src/worker.ts`, `apps/api/src/repository.ts`

Still entirely unfixed. The `page_count`, `language`, `ocr_confidence`, `dedup_group_id`, and `created_by` columns in the `documents` table are never written to by any code path.

---

---

## 🟡 Moderate — Not Fixed

---

### Issue #11 — Tenant ID hardcoded as `"tenant-demo"`
**File:** `apps/web/app/dashboard-app.tsx` line 154

```ts
const [tenantIdForSso, setTenantIdForSso] = useState("tenant-demo");  // ← still hardcoded
```

---

### Issue #15 — Research history has no endpoint
**File:** `apps/api/src/routes.ts`, `apps/api/src/repository.ts`

`recordResearch()` is still a stub (returns `true` without writing anything). No `GET /api/research/history` endpoint exists.

---

### Issue #16 — Windows absolute paths in README
**File:** `README.md` lines 323–332

All 10 `C:/Users/deeps/OneDrive/...` paths are still present.

---

### Issue #17 — Direct attorney creation bypasses invitation flow
**File:** `apps/api/src/routes.ts` line 662

The `POST /api/admin/attorneys` endpoint still exists without a force-reset flag, and uses weaker password validation than everywhere else:

```ts
password: z.string().min(10),  // ← should be passwordSchema (min 12 + complexity rules)
```

---

### Issue #18 — Only one test file
**File:** `apps/api/src/__tests__/`

Only `security.test.ts` exists. No tests for document workflow, clause extraction, risk assessment, research, auth flows, or tenant isolation.

---

### Issue #E (NEW) — No index on `document_chunks(document_id)`
**File:** `db/schema.sql`

The new `getDocumentEmbeddings` query joins `documents` with `document_chunks` on `document_id`:

```sql
left join document_chunks c on c.document_id = d.id
```

The schema has no index on `document_chunks.document_id`:

```sql
-- schema.sql — no index for this column
create table if not exists document_chunks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id),  ← no index here
  ...
```

Without an index, this join degrades to a full sequential scan of the entire `document_chunks` table for every research query. For a firm with thousands of chunks this becomes very slow.

**Fix:** Add an index in `schema.sql`:
```sql
create index if not exists idx_document_chunks_document_id on document_chunks (document_id);
create index if not exists idx_document_chunks_tenant on document_chunks (tenant_id, document_id);
```

---

---

## 🔵 Minor — Not Fixed

---

### Issue #19 — Unreachable third branch in `getFinalStoragePath`
**File:** `apps/api/src/worker.ts` lines 29–33

Still present:

```ts
if (storagePath.includes("/quarantine/".replace(/\//g, "\\"))) {
  return storagePath.replace("/quarantine/".replace(/\//g, "\\"), "/uploads/".replace(/\//g, "\\"));
}
```

`"/quarantine/".replace(/\//g, "\\")` evaluates to `"\\quarantine\\"` which is identical to what the second branch checks with `"\\quarantine\\"`. The third branch can never be reached.

---

### Issue #21 — Password validation duplicated in 3 places
**Files:** `apps/api/src/routes.ts`, `apps/web/app/dashboard-app.tsx`

Three separate definitions:
1. `routes.ts` lines 29–35: Zod `passwordSchema` (min 12 + 4 regex rules)
2. `dashboard-app.tsx` lines 57–64: `validatePassword()` function
3. `dashboard-app.tsx` line 702: inline `password.length < 12` check

Plus the `POST /api/admin/attorneys` route uses `z.string().min(10)` — weaker than all three.

---

### Issue #22 — `DEMO_API_KEY` empty — fails startup
**File:** `.env.example` line 12

```env
DEMO_API_KEY=   ← empty, but config.ts requires min(24)
DEMO_USER_EMAIL=   ← empty, but config.ts requires valid email
DEMO_USER_PASSWORD=   ← empty, but config.ts requires min(12) + complexity
APP_ENCRYPTION_KEY=   ← empty, but config.ts requires min(32)
JWT_SECRET=   ← empty, but config.ts requires min(32)
PLATFORM_ADMIN_SECRET=   ← empty, but config.ts requires min(32)
```

Copying `.env.example` to `.env` and running `npm run dev:api` will immediately crash with Zod validation errors.

---

### Issue #23 — `parseResponse` loses HTTP status code
**File:** `apps/web/lib/api.ts` lines 38–43

```ts
async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Request failed");  ← status code discarded
  }
  return response.json();
}
```

A 401, 403, 422, and 500 all produce identical `Error` objects.

---

### Issue #F (NEW) — `POST /api/admin/attorneys` uses weaker password validation
**File:** `apps/api/src/routes.ts` line 662

Every other route that accepts a password uses the shared `passwordSchema` (min 12 chars, uppercase, lowercase, number, special character). The direct attorney creation route uses a weaker standalone check:

```ts
// routes.ts line 662
password: z.string().min(10),  // ← only 10 chars, no complexity requirements
```

This is inconsistent and allows attorneys to be created with weak passwords like `password12` that would be rejected in every other flow.

**Fix:** Replace with the shared schema:
```ts
password: passwordSchema,  // same as reset-password, invite acceptance, etc.
```

---

---

## Consolidated Fix Checklist

### 🔴 Fix These First (Crashes / Security)

- [ ] **#A** — Add `updated_at` to `flags` table in `schema.sql` AND add a migration file, OR remove `updated_at` from `updateFlagStatus` SQL query
- [ ] **#B** — Add `"approved" | "rejected"` to `FlagRecord.status` in `shared/index.ts`
- [ ] **#1** — Remove all `localStorage` token usage in `dashboard-app.tsx`; rely on httpOnly cookie

### 🟠 Fix These Next (Correctness / Data Quality)

- [ ] **#C** — Add `isActive?` and `lastLoginAt?` to `Attorney` interface in `shared/index.ts`
- [ ] **#10** — Apply same `mapAttorney` fix to `repositories/mappers.ts`
- [ ] **#13** — Raise worker embedding truncation from 4,000 to 8,000 chars in `worker.ts` line 115
- [ ] **#7** — Add `playbooks` table and admin endpoint; load active playbook in `assessRisk()`
- [ ] **#8** — Replace flat 30s retry with exponential backoff in `failWorkflowJob()`
- [ ] **#9** — Replace `pdf-parse` with `unpdf`
- [ ] **#14** — Populate `page_count`, `created_by`, `language` during document ingestion

### 🟡 Fix These After (Features / UX)

- [ ] **#E** — Add `idx_document_chunks_document_id` index to `schema.sql`
- [ ] **#11** — Replace `"tenant-demo"` with `process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? ""`
- [ ] **#15** — Implement `recordResearch()` to write to DB; add `GET /api/research/history`
- [ ] **#16** — Replace Windows paths in `README.md` with relative paths
- [ ] **#17** — Remove direct attorney creation route or enforce `passwordSchema` + force-reset
- [ ] **#F** — Change `password: z.string().min(10)` to `password: passwordSchema` in admin/attorneys route
- [ ] **#18** — Add integration tests for document workflow, auth, tenant isolation

### 🔵 Fix Last (Polish / Minor)

- [ ] **#19** — Remove third unreachable branch in `getFinalStoragePath`
- [ ] **#21** — Move password rules to `shared/index.ts`; remove duplicates
- [ ] **#22** — Add valid placeholder values to `.env.example` for all required secrets
- [ ] **#23** — Create `ApiError` class with status code in `api.ts`