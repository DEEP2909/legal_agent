# Task Tracker — Remaining Issues

## Quick Wins
- [ ] Issue #19: Create `.env` from `.env.example` (user cancelled - deployment will handle this)
- [x] Issue #11: Wire `withTransaction` into multi-step service operations ✓ (already wired in acceptInvitation, confirmMfaEnrollment)
- [x] Issue #8: Create `helpers.test.ts` unit tests ✓

## Phase 1: Split Monster Files (Partial Progress)
- [x] Issue #2: Split `repository.ts` into domain modules (started - auth repo created with mappers)
- [ ] Issue #1: Split `services.ts` into domain modules (pending)
- [x] Issue #3: Split `dashboard-app.tsx` into components ✓
  - Created `components/auth/` with: login-form, mfa-challenge-form, forgot-password-form, reset-password-form, invitation-accept-form
  - Created `components/shared/` with: masked-secret, loading-skeleton
  - Created `components/security/` and `components/admin/` directories

## Scalability
- [x] Issue #9: Add pagination query params to dashboard/admin API endpoints ✓
  - Added optional `{ limit, offset }` params to: listTenants, listAttorneys, listApiKeys, listInvitations
  - Added count functions: countTenants, countAttorneys, countApiKeys, countInvitations
- [x] Issue #10: Add LIMIT to embedding/vector queries + pgvector TODO ✓
  - Added configurable limit param to getDocumentEmbeddings (default 100, max 500)

## Frontend
- [x] Issue #22: Add loading skeleton state to dashboard ✓
  - Created `components/shared/loading-skeleton.tsx` with animated skeleton UI
