# Legal Agent Platform — Remaining Issues Report

> **Audit version:** `legal_agent-main__6_`
> All 15 issues from the previous production readiness report have been resolved correctly.
> This document covers the 3 new issues introduced or carried over in this version.

---

## Summary

| # | Issue | File | Severity | Category |
|---|-------|------|----------|----------|
| 1 | `continue-on-error: true` still on test step — failures show green in CI | `.github/workflows/ci.yml` | 🟠 Major | CI / Quality |
| 2 | Refresh token rotation is non-atomic — two sessions can be minted from one token | `apps/api/src/repository.ts` | 🟠 Major | Security |
| 3 | SCIM filter string has no length cap — unbounded memory per request | `apps/api/src/routes.ts` | 🟡 Moderate | Security / Reliability |

---

---

## Issue 1 — `continue-on-error: true` Still Present on the Test Step

**File:** `.github/workflows/ci.yml` — line 101
**Severity:** 🟠 Major
**Category:** CI / Quality

### Problem

The integration test step in the CI workflow has `continue-on-error: true`:

```yaml
# .github/workflows/ci.yml  (current — broken)
- run: npm run test -w @legal-agent/api
  continue-on-error: true        # ← every test failure is silently swallowed
```

This flag tells GitHub Actions to mark the step as **passed** even when every single test fails. The practical consequence is:

- A developer pushes a breaking change. All 84 tests fail.
- GitHub marks the `integration-tests` job as ✅ **passing**.
- The PR is merged. The breakage ships.

This issue was identified and flagged in the original production readiness report. The fix was applied to the `integration-tests` job correctly (the migration step no longer has `continue-on-error`), but the flag was accidentally left on the actual test run step — the one place it matters most.

This is not a theoretical risk. It has already silently masked two separate test failures across the previous versions of this repository. With `continue-on-error: true` in place, the entire investment in the test suite provides zero protection.

### Fix

Remove the `continue-on-error: true` line from the test step. One line deletion.

```yaml
# .github/workflows/ci.yml  (fixed)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build -w @legal-agent/shared
      - name: Run database migrations
        run: npm run migrate -w @legal-agent/api
      - name: Run tests
        run: npm run test -w @legal-agent/api
        # ✅ No continue-on-error — failures now correctly fail the job
```

The `continue-on-error: true` at line 101 is on the `npm audit` step in the `security-scan` job — that one is intentional and correct (audit warnings should not block CI). Only the test step needs the change.

---

---

## Issue 2 — Refresh Token Rotation Is Non-Atomic

**File:** `apps/api/src/repository.ts` — `validateAndRotateRefreshToken` function
**Severity:** 🟠 Major
**Category:** Security

### Problem

The `validateAndRotateRefreshToken` function performs a two-step operation — a `SELECT` to find the token, followed by a separate `UPDATE` to revoke it:

```ts
// repository.ts  (current — broken)
async validateAndRotateRefreshToken(tokenHash: string) {

  // Step 1: Read the token
  const result = await pool.query(
    `select id, tenant_id, attorney_id
     from refresh_tokens
     where token_hash = $1
       and revoked_at is null
       and expires_at > now()
     limit 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) return null;

  // ⚠️ GAP: another request using the same token can pass the SELECT above
  //          before this UPDATE executes — both will get a valid session back

  // Step 2: Revoke it
  await pool.query(
    `update refresh_tokens set revoked_at = now() where id = $1`,
    [row.id]
  );

  return { tenantId: String(row.tenant_id), attorneyId: String(row.attorney_id) };
}
```

There is a **race condition window** between the two queries. In the following scenario both requests succeed:

```
Time →

Request A:  SELECT (token valid ✓) ─────────────────── UPDATE (revoke)
Request B:              SELECT (token still valid ✓) ─────────────── UPDATE (already revoked — no-op)
                                                       ↑
                                          Both A and B return a valid session
                                          from a single refresh token
```

This happens in practice under two real conditions:

1. **Network retry.** A mobile client on a flaky connection sends a refresh request. The server responds, but the response is lost in transit. The client retries — the same token arrives a second time within milliseconds of the first.

2. **Browser double-send.** A tab is restored from hibernation, and multiple parts of the UI simultaneously detect an expired access token and race to call `/auth/refresh`.

The result is that **two valid access tokens are issued from one refresh token**. The refresh token rotation security model (use-once, detect reuse) is broken. A stolen refresh token cannot be detected via reuse, because legitimate clients are already generating two sessions per token.

### Why `FOR UPDATE SKIP LOCKED` Is Not Enough Here

The worker queue uses `FOR UPDATE SKIP LOCKED` to claim jobs. That pattern causes one holder to skip locked rows — not what you want for token validation. Here you want the second request to **wait**, then find the token already revoked and return `null`.

### Fix

Replace the two-query pattern with a single atomic `UPDATE ... RETURNING`. PostgreSQL evaluates the `WHERE` clause and the `RETURNING` in a single operation. Only one concurrent caller can match the row and update it — the other will find zero rows.

```ts
// repository.ts  (fixed)
async validateAndRotateRefreshToken(
  tokenHash: string
): Promise<{ tenantId: string; attorneyId: string } | null> {

  // Atomic: find a valid token AND revoke it in one statement.
  // If two requests arrive concurrently with the same token,
  // only one UPDATE matches — the other gets zero rows back.
  const result = await pool.query(
    `UPDATE refresh_tokens
     SET    revoked_at = now()
     WHERE  token_hash  = $1
       AND  revoked_at IS NULL
       AND  expires_at  > now()
     RETURNING id, tenant_id, attorney_id`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    tenantId:  String(row.tenant_id),
    attorneyId: String(row.attorney_id)
  };
}
```

This is the standard pattern for single-use token consumption in PostgreSQL. The `RETURNING` clause makes it behave like a compare-and-swap — only the writer that performed the `UPDATE` gets the row back.

No schema changes are required. The `refresh_tokens` table already has the `revoked_at` column and the correct index.

---

---

## Issue 3 — SCIM Filter String Has No Length Cap

**File:** `apps/api/src/routes.ts` — lines 408 and 430
**Severity:** 🟡 Moderate
**Category:** Security / Reliability

### Problem

The SCIM `GET /scim/v2/Users` and `GET /scim/v2/Groups` endpoints accept a `filter` query parameter with no maximum length:

```ts
// routes.ts  (current — broken)

// GET /scim/v2/Users
const query = z.object({
  startIndex: z.coerce.number().int().min(1).default(1),
  count:      z.coerce.number().int().min(1).max(200).default(50),
  filter:     z.string().optional()   // ← no .max() — unbounded
}).parse(request.query);

// GET /scim/v2/Groups  (same pattern)
const query = z.object({
  startIndex: z.coerce.number().int().min(1).default(1),
  count:      z.coerce.number().int().min(1).max(200).default(50),
  filter:     z.string().optional()   // ← no .max() — unbounded
}).parse(request.query);
```

The filter value is then passed to `listScimUsers` / `listScimGroups`, which runs a regex match against it:

```ts
// services.ts
const emailFilterMatch = input.filter?.match(/userName eq "([^"]+)"/i);
const emailFilter = emailFilterMatch?.[1];
```

There are two concrete risks:

**Memory exhaustion.** The query string is fully buffered by Node.js and Fastify before Zod sees it. A SCIM client (or an attacker with a valid SCIM token) can send a filter string of arbitrary length — 1 MB, 10 MB, 100 MB — and the entire value will be allocated in process memory. Under concurrent requests this can push the API process to OOM.

**Regex safety margin.** The specific regex used (`/userName eq "([^"]+)"/i`) does not exhibit catastrophic backtracking — `[^"]+` is a negated character class and does not cause exponential behaviour. However, the absence of a length cap means there is no guard against future regressions if the regex is ever changed to a more complex pattern. SCIM filter expressions are short by RFC 7644 design — a 200-character cap enforces the protocol's intent and eliminates the class of issue entirely.

The SCIM endpoints are protected by `requireScimAuth`, so this is not exploitable by anonymous traffic. However, a compromised or misconfigured IdP SCIM token, or a rogue internal service, could trigger it.

### Fix

Add `.max(200)` to both `filter` validators. SCIM filter expressions like `userName eq "john.doe@firm.com"` are at most ~60 characters in practice. 200 characters is generous and covers edge cases.

```ts
// routes.ts  (fixed)

// GET /scim/v2/Users
const query = z.object({
  startIndex: z.coerce.number().int().min(1).default(1),
  count:      z.coerce.number().int().min(1).max(200).default(50),
  filter:     z.string().max(200).optional()   // ✅ bounded
}).parse(request.query);

// GET /scim/v2/Groups
const query = z.object({
  startIndex: z.coerce.number().int().min(1).default(1),
  count:      z.coerce.number().int().min(1).max(200).default(50),
  filter:     z.string().max(200).optional()   // ✅ bounded
}).parse(request.query);
```

No other changes are needed. Zod will return a 400 with a clear validation error if the filter exceeds 200 characters, which is the correct behaviour for a SCIM API.

---

---

## Fix Priority

| Order | Issue | Effort | Risk if deferred |
|-------|-------|--------|-----------------|
| **1st** | Issue 2 — Refresh token race condition | ~5 minutes — one SQL query change | Two sessions issued per token on retry/double-send; breaks security model |
| **2nd** | Issue 1 — `continue-on-error: true` in CI | ~1 minute — delete one line | Future regressions ship silently without anyone noticing |
| **3rd** | Issue 3 — SCIM filter length cap | ~2 minutes — add `.max(200)` twice | Low exploitability but unbounded memory allocation per SCIM request |

All three are small, targeted changes with no side effects. The total fix time is under 10 minutes.