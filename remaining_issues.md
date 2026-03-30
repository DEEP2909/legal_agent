# Remaining Issues from Task.md

Analysis of what was completed vs. what's still outstanding from the 25-issue refactoring plan.

---

## ✅ Completed Issues

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| **4** | Fix cross-tenant login query | ✅ Done | `getAttorneyForLogin` now requires `tenantId`, login route requires `tenantId` |
| **6** | Add rate limiting | ✅ Done | `@fastify/rate-limit` registered globally + `authRateLimit` per auth route |
| **7** | Tighten reset token exposure | ✅ Done | `resetToken` only exposed when `nodeEnv === "development"` |
| **11** | Add `withTransaction` utility | ✅ Done | [transaction.ts](file:///c:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/transaction.ts) created |
| **13** | Sanitize error messages | ✅ Done | [index.ts](file:///c:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/index.ts) has full error handler with production sanitization |
| **15** | Remove redundant ALTER TABLE | ✅ Done | No `ALTER TABLE` statements remain in schema.sql |
| **16** | Support multi-origin CORS | ✅ Done | `corsOrigins` split by comma in config, passed as array to `@fastify/cors` |
| **18** | Remove docker-compose version key | ✅ Done | `version` key removed from docker-compose.yml |
| **20** | Separate APP_ENCRYPTION_KEY from JWT_SECRET | ✅ Done | Both independently required with 32-char minimum |
| **21** | Add Biome config | ✅ Done | [biome.json](file:///c:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/biome.json) created |
| **23** | Fix scanned PDF OCR fallback | ✅ Done | [ocr.ts](file:///c:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/ocr.ts) falls back to `runOpenAiImageOcr` for openai provider |
| **24** | HTML-escape email templates | ✅ Done | `escapeHtml()` in [email.ts](file:///c:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/email.ts) |
| **25** | Add return after 403 in auth hooks | ✅ Done | [auth.ts](file:///c:/Users/deeps/OneDrive/Documents/New%20project/Legal%20Agent/apps/api/src/auth.ts) — all hooks have explicit `return` after `reply.send()` |
| **8** | Add vitest + unit tests (partial) | ⚠️ Partial | vitest installed, `security.test.ts` exists, but `helpers.test.ts` was **not created** |
| **12** | Improve worker guard + logging | ✅ Done | Worker has `workerId`, stuck job recovery, concurrency guard comment |

---

## ❌ Still Remaining Issues (10 items)

### Phase 1: Split Monster Files — **All 3 still pending**

| # | Issue | What's Missing |
|---|-------|---------------|
| **1** | Split `services.ts` into domain modules | `services.ts` is still **2,700 lines / 85KB** monolith. No `services/` directory with sub-modules was created. Only `repositories/mappers.ts` exists. |
| **2** | Split `repository.ts` into domain modules | `repository.ts` is still **1,803 lines / 53KB** monolith. The `repositories/` directory only has `mappers.ts`, none of the planned sub-repos (`authRepository.ts`, `documentRepository.ts`, etc.) were created. |
| **3** | Split `dashboard-app.tsx` into components | `dashboard-app.tsx` is still **65KB** monolith. No `components/` directory exists — no `LoginForm.tsx`, `SecurityPanel.tsx`, `AdminPanel.tsx`, etc. |

### Phase 3: Scalability — **2 still pending**

| # | Issue | What's Missing |
|---|-------|---------------|
| **9** | Add pagination to dashboard queries | Dashboard queries now have `LIMIT` clauses (good), but there are **no paginated API endpoints** — no `offset`/`page` query params on dashboard or admin listing routes. `listAttorneys`, `listApiKeys`, `listInvitations`, `listTenants` all return full results. |
| **10** | Add LIMIT to embedding queries + pgvector TODO | No `LIMIT` found on embedding/vector similarity queries in `repository.ts`. Need to verify the document chunk / embedding fetch queries. |

### Phase 4: Testing — **1 partially remaining**

| # | Issue | What's Missing |
|---|-------|---------------|
| **8** | `helpers.test.ts` unit tests | `security.test.ts` exists ✅, but `helpers.test.ts` for service helper functions was **never created**. |

### Phase 5: Code Quality — **1 still pending**

| # | Issue | What's Missing |
|---|-------|---------------|
| **19** | Create `.env` from `.env.example` | **`.env` file does not exist** in the project root. Only `.env.example` is present. |

### Phase 6: Frontend — **1 still pending**

| # | Issue | What's Missing |
|---|-------|---------------|
| **22** | Add loading skeleton state | No skeleton/spinner component in the frontend. `dashboard-app.tsx` has no loading state between auth check and data display. |

### Phase 3: Transaction usage — **Not wired up**

| # | Issue | What's Missing |
|---|-------|---------------|
| **11** | Use `withTransaction` in multi-step operations | The utility was **created** but is **never imported or used** in `services.ts`. `acceptInvitation`, `confirmMfaEnrollment`, SCIM user creation etc. still don't wrap in transactions. |

---

## Summary

| Category | Total | Done | Remaining |
|----------|-------|------|-----------|
| Phase 1: File Splits | 3 | 0 | **3** |
| Phase 2: Security Fixes | 7 | 7 | 0 |
| Phase 3: Scalability | 3 | 1 (partial) | **2** |
| Phase 4: Testing | 1 | 0.5 | **0.5** |
| Phase 5: Code Quality | 4 | 3 | **1** |
| Phase 6: Frontend | 1 | 0 | **1** |
| Phase 7: Minor Backend | 3 | 3 | 0 |
| **Total** | **22** | **~14.5** | **~7.5** |

> [!IMPORTANT]
> The biggest outstanding work is **Phase 1** — splitting the three monolith files. This is the most impactful change and everything else (pagination, transaction wiring, tests) becomes cleaner after the split.

> [!WARNING]
> `withTransaction` was created in Phase 3 but is a dead module — it's not imported anywhere. Multi-step operations like `acceptInvitation` and `confirmMfaEnrollment` still have atomicity risks.
