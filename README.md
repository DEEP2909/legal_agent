# Legal Agent Platform

An end-to-end legal workflow automation MVP for Indian and South Asian law firms handling corporate law, M&A diligence, and commercial contracts.

## What is included

- Matter-centric legal workflow dashboard
- OpenAI-powered clause extraction, risk flagging, research, embeddings, and image OCR
- PostgreSQL-backed persistence
- S3-compatible object storage support
- Durable workflow jobs for ingestion
- Separate worker process for normalization and embedding generation
- JWT login for attorney users plus API keys for integrations
- Tenant admin layer for firm settings, attorney accounts, and API key issuance
- Invitation acceptance and password reset flows with email delivery support
- MFA with TOTP enrollment, verification, and recovery codes
- WebAuthn passkey enrollment and passkey-based MFA verification
- Passwordless-first passkey sign-in for tenant-scoped accounts
- Full OIDC and SAML sign-in flows with tenant-scoped provider configuration, discovery, callback handling, PKCE, nonce validation, SAML ACS handling, signed SP metadata, and signed AuthnRequests
- SAML logout initiation and callback handling for stricter IdP interoperability
- SCIM 2.0 user and group provisioning endpoints with tenant-scoped bearer tokens
- Asynchronous malware quarantine, clean-file promotion, and re-scan workflow jobs
- Hybrid OCR with Azure Document Intelligence fallback for scanned PDFs and images
- Database-backed API keys and audit events
- Next.js web app for matters, review, uploads, and research
- Docker Compose stack for Postgres and MinIO

## Security Features

The platform includes comprehensive security measures:

- **Authentication**: JWT tokens, API keys, MFA (TOTP + WebAuthn), SSO (OIDC/SAML)
- **Account Protection**: Lockout after failed attempts, secure password reset with expiring tokens
- **Input Validation**: Parameterized queries, path traversal prevention, content-type validation
- **Rate Limiting**: Configurable limits on auth endpoints to prevent brute force attacks
- **Encryption**: AES-256-GCM for secrets at rest, bcrypt for passwords
- **Audit Logging**: All security events tracked with timestamps and actor IDs
- **CSRF Protection**: State parameters for OAuth flows, secure cookie handling

## Monorepo layout

```
├── apps/
│   ├── api/                    # Fastify API server
│   │   └── src/
│   │       ├── services/       # Domain service modules
│   │       ├── repositories/   # Data access layer
│   │       └── __tests__/      # Unit tests (32 tests)
│   └── web/                    # Next.js frontend
│       └── app/
│           └── components/     # Extracted UI components
│               ├── admin/      # Admin panel components
│               ├── auth/       # Authentication forms
│               ├── security/   # Security settings
│               └── shared/     # Reusable components
├── packages/shared/            # Shared TypeScript types
├── db/schema.sql              # Database schema
├── docker-compose.yml         # Local Postgres + MinIO stack
└── DEPLOYMENT.md              # Production deployment guidance
```

## Requirements

Application:

- Node.js 20+
- npm 10+
- OpenAI API key with access to `gpt-4.1` and `text-embedding-3-large`

Infrastructure:

- PostgreSQL 15+ or 16+
- S3-compatible object storage for production such as AWS S3, MinIO, Cloudflare R2, or DigitalOcean Spaces
- 2 vCPU / 4 GB RAM minimum for local or dev usage
- 4 vCPU / 8 GB RAM recommended for staging and production app nodes

Document processing:

- Text files and JSON upload directly
- Digital PDFs are parsed automatically
- Images are OCR'd with OpenAI or Azure Document Intelligence
- Scanned PDFs can use Azure Document Intelligence through `OCR_PROVIDER=azure_document_intelligence` or `OCR_PROVIDER=hybrid`

Security:

- TLS in front of API and web services
- Encrypted Postgres and bucket/object storage
- Private networking between app, database, and storage
- Secret management for OpenAI, database, and storage credentials

## Environment

Copy `.env.example` to `.env` and set:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `WEB_APP_URL`
- `PUBLIC_API_BASE_URL`
- `DEMO_API_KEY`
- `DEMO_USER_EMAIL`
- `DEMO_USER_PASSWORD`
- `DATABASE_URL`
- `STORAGE_BACKEND`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `OCR_PROVIDER`
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`
- `AZURE_DOCUMENT_INTELLIGENCE_KEY`
- `AZURE_DOCUMENT_INTELLIGENCE_MODEL`
- `AZURE_DOCUMENT_INTELLIGENCE_API_VERSION`
- `MALWARE_SCANNER`
- `CLAMAV_HOST`
- `CLAMAV_PORT`
- `CLAMAV_TIMEOUT_MS`
- `EMAIL_DELIVERY_MODE`
- `MAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SAML_SP_PRIVATE_KEY`
- `SAML_SP_PUBLIC_CERT`
- `SAML_SIGN_AUTHN_REQUESTS`
- `SAML_SIGN_METADATA`
- `SAML_SIGNATURE_ALGORITHM`
- `WEBAUTHN_RP_NAME`
- `WEBAUTHN_RP_ID`
- `APP_ENCRYPTION_KEY`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `PLATFORM_ADMIN_SECRET`

Recommended local `.env` values:

```bash
OPENAI_MODEL=gpt-4.1
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
PORT=4000
WEB_APP_URL=http://localhost:3000
PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
DEMO_API_KEY=demo-firm-key-123
DEMO_USER_EMAIL=aarav@firm.example
DEMO_USER_PASSWORD=ChangeMe123!
DATABASE_URL=postgres://postgres:postgres@localhost:5432/legal_agent
STORAGE_BACKEND=s3
S3_REGION=ap-south-1
S3_BUCKET=legal-agent-dev
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
OCR_PROVIDER=openai
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
AZURE_DOCUMENT_INTELLIGENCE_MODEL=prebuilt-layout
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30
CORS_ORIGIN=http://localhost:3000
MAX_UPLOAD_BYTES=26214400
MALWARE_SCANNER=none
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=10000
EMAIL_DELIVERY_MODE=log
MAIL_FROM=noreply@legal-agent.local
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SAML_SP_PRIVATE_KEY=
SAML_SP_PUBLIC_CERT=
SAML_SIGN_AUTHN_REQUESTS=false
SAML_SIGN_METADATA=false
SAML_SIGNATURE_ALGORITHM=sha256
WEBAUTHN_RP_NAME=Legal Agent
WEBAUTHN_RP_ID=localhost
RUN_INLINE_WORKER=false
JOB_POLL_INTERVAL_MS=5000
APP_ENCRYPTION_KEY=change-this-32-byte-app-key
JWT_SECRET=super-secret-jwt-key-123456
JWT_EXPIRES_IN=8h
PLATFORM_ADMIN_SECRET=platform-admin-secret-123
```

## Local infrastructure

Start Postgres and MinIO:

```bash
docker compose up -d
```

This provisions:

- Postgres on `localhost:5432`
- MinIO S3 API on `localhost:9000`
- MinIO console on `localhost:9001`
- Bucket `legal-agent-dev`

## Run locally

1. `npm install`
2. Create `.env`
3. `docker compose up -d`
4. Terminal 1: `npm run dev:api`
5. Terminal 2: `npm run dev:worker`
6. Terminal 3: `npm run dev:web`

The API initializes the schema and seeds demo data at startup.

Browser login for the seeded tenant admin:

- Email: `aarav@firm.example`
- Password: `ChangeMe123!`

## Core API endpoints

- `POST /auth/login`
- `POST /auth/passkey/options`
- `POST /auth/passkey/verify`
- `POST /auth/mfa/verify`
- `POST /auth/mfa/webauthn/options`
- `POST /auth/mfa/webauthn/verify`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/invitations/accept`
- `POST /auth/exchange`
- `GET /auth/sso/providers?tenantId=...`
- `GET /auth/sso/start?tenantId=...&providerName=...`
- `GET /auth/sso/callback`
- `POST /auth/sso/saml/acs`
- `GET /auth/sso/saml/logout/callback`
- `GET /auth/sso/saml/metadata?tenantId=...&providerName=...`
- `GET /auth/me`
- `POST /auth/sso/saml/logout`
- `GET /api/security/mfa`
- `POST /api/security/mfa/setup`
- `POST /api/security/mfa/confirm`
- `POST /api/security/mfa/disable`
- `GET /api/security/passkeys`
- `POST /api/security/passkeys/register/options`
- `POST /api/security/passkeys/register/verify`
- `DELETE /api/security/passkeys/:passkeyId`
- `GET /api/dashboard`
- `GET /api/matters/:matterId/documents`
- `GET /api/admin/tenant`
- `PATCH /api/admin/tenant`
- `POST /api/admin/attorneys`
- `POST /api/admin/api-keys`
- `POST /api/admin/scim/tokens`
- `POST /api/admin/invitations`
- `PUT /api/admin/sso-providers`
- `GET /api/admin/playbooks` — List all playbooks for tenant
- `GET /api/admin/playbooks/:id` — Get specific playbook
- `POST /api/admin/playbooks` — Create new playbook with rules
- `PATCH /api/admin/playbooks/:id` — Update playbook name/rules/active status
- `DELETE /api/admin/playbooks/:id` — Delete playbook
- `GET /scim/v2/ServiceProviderConfig`
- `GET /scim/v2/ResourceTypes`
- `GET /scim/v2/Schemas`
- `GET /scim/v2/Users`
- `POST /scim/v2/Users`
- `GET /scim/v2/Users/:id`
- `PUT /scim/v2/Users/:id`
- `PATCH /scim/v2/Users/:id`
- `DELETE /scim/v2/Users/:id`
- `GET /scim/v2/Groups`
- `POST /scim/v2/Groups`
- `GET /scim/v2/Groups/:id`
- `PUT /scim/v2/Groups/:id`
- `PATCH /scim/v2/Groups/:id`
- `DELETE /scim/v2/Groups/:id`
- `GET /api/platform/tenants`
- `POST /api/platform/tenants`
- `POST /api/documents/ingest`
- `POST /api/documents/upload`
- `POST /api/documents/:documentId/rescan`
- `POST /api/documents/extract`
- `POST /api/flags/assess`
- `POST /api/research/query`
- `GET /api/research/history`
- `POST /api/review/feedback`

Health endpoints:

- `GET /health/live`
- `GET /health/ready`

UI access uses JWT login. Integration routes can still use `x-api-key: demo-firm-key-123`.

OIDC callback URL for provider configuration:

- `http://localhost:4000/auth/sso/callback` for local development
- `https://api.your-domain.com/auth/sso/callback` for production

SAML ACS and metadata:

- ACS: `https://api.your-domain.com/auth/sso/saml/acs`
- Metadata: `https://api.your-domain.com/auth/sso/saml/metadata?tenantId=...&providerName=...`

WebAuthn and SCIM:

- Set `WEBAUTHN_RP_ID` to the web app hostname used by browsers, for example `app.your-domain.com`
- SCIM base URL: `https://api.your-domain.com/scim/v2`
- Create a tenant SCIM bearer token from the admin console before wiring your IdP provisioning connector
- Passkey-first login expects both tenant ID and email on the sign-in screen so multi-tenant email collisions stay unambiguous
- SAML logout callback: `https://api.your-domain.com/auth/sso/saml/logout/callback?tenantId=...&providerName=...`

## Example API calls

```bash
curl http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email":"aarav@firm.example",
    "password":"ChangeMe123!"
  }'
```

```bash
curl http://localhost:4000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email":"aarav@firm.example"
  }'
```

```bash
curl http://localhost:4000/api/documents/upload \
  -H "x-api-key: demo-firm-key-123" \
  -F "matterId=mat-1" \
  -F "docType=Share Purchase Agreement" \
  -F "file=@./sample.pdf"
```

```bash
curl http://localhost:4000/api/research/query \
  -H "x-api-key: demo-firm-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "question":"What are the key negotiation risks in this SPA?"
  }'
```

## Implementation notes

- Postgres initialization and demo seeding: `apps/api/src/database.ts`
- SQL repository layer: `apps/api/src/repository.ts`
- Service helpers module: `apps/api/src/services/`
- Auth and JWT handling: `apps/api/src/auth.ts`
- Passwords, token hashing, and invite/reset token generation: `apps/api/src/security.ts`
- S3/local storage abstraction: `apps/api/src/storage.ts`
- OCR pipeline: `apps/api/src/ocr.ts`
- Worker entrypoint: `apps/api/src/worker-main.ts`
- Background ingestion worker: `apps/api/src/worker.ts`
- Web app dashboard: `apps/web/app/dashboard-app.tsx`
- Admin panel component: `apps/web/app/components/admin/`
- Security panel component: `apps/web/app/components/security/`
- Auth form components: `apps/web/app/components/auth/`
- Shared UI components: `apps/web/app/components/shared/`
- Deployment guide: `DEPLOYMENT.md`

## Testing

Run all tests:

```bash
npm test
```

The test suite includes:
- **32 unit tests** covering security helpers and service utilities
- Password hashing and verification
- Token generation and validation
- Input sanitization and validation

## Production notes

- Uploaded files now land in quarantine first; the worker scans and promotes clean files before OCR/embedding jobs run.
- Keep at least one worker replica online in every environment or uploaded files will remain in `pending_scan`.
- SCIM now supports both users and groups, but not nested groups.
- API endpoints support pagination with `limit` and `offset` parameters for scalability.
- Embedding queries are limited to prevent memory issues (configurable, default 100).

## License

Proprietary - All rights reserved.
