# Deployment Guide

This application is designed to run as three deployable services:

- `web`: Next.js front end
- `api`: Fastify API
- `worker`: background ingestion processor

## Recommended production architecture

### AWS

- `web` on ECS Fargate or App Runner behind an Application Load Balancer
- `api` on ECS Fargate behind an internal or public Application Load Balancer
- `worker` on ECS Fargate as a long-running service with 1+ replicas
- PostgreSQL on Amazon RDS
- Object storage on Amazon S3
- Secrets in AWS Secrets Manager
- DNS in Route 53
- TLS with ACM certificates
- Logs in CloudWatch

### Other solid options

- Fly.io or Render for app containers
- Managed PostgreSQL from Neon, Supabase, Render, Railway, or RDS
- S3-compatible storage from Cloudflare R2, Backblaze B2, DigitalOcean Spaces, or MinIO

## Container images

The repo includes three Dockerfiles at the project root:

- `Dockerfile.web`
- `Dockerfile.api`
- `Dockerfile.worker`

Build examples:

```bash
docker build -f Dockerfile.web -t legal-agent-web .
docker build -f Dockerfile.api -t legal-agent-api .
docker build -f Dockerfile.worker -t legal-agent-worker .
```

## Runtime environment

All production services need:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `DATABASE_URL`
- `STORAGE_BACKEND=s3`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ENDPOINT` if using non-AWS S3-compatible storage
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
- `WEB_APP_URL`
- `PUBLIC_API_BASE_URL`

API-specific:

- `PORT=4000`
- `CORS_ORIGIN=https://your-web-domain`
- `MAX_UPLOAD_BYTES=26214400`
- `RUN_INLINE_WORKER=false`

Worker-specific:

- `RUN_INLINE_WORKER=false`
- `JOB_POLL_INTERVAL_MS=5000`

Web-specific:

- `NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.com`

OIDC callback URL:

- `https://api.your-domain.com/auth/sso/callback`

SAML endpoints:

- ACS: `https://api.your-domain.com/auth/sso/saml/acs`
- Metadata: `https://api.your-domain.com/auth/sso/saml/metadata?tenantId=...&providerName=...`

SCIM and WebAuthn:

- SCIM base URL: `https://api.your-domain.com/scim/v2`
- WebAuthn RP ID: set `WEBAUTHN_RP_ID` to the browser-facing app hostname, for example `app.your-domain.com`
- If you enable SAML signing, load PEM-formatted `SAML_SP_PRIVATE_KEY` and `SAML_SP_PUBLIC_CERT`
- SAML logout callback: `https://api.your-domain.com/auth/sso/saml/logout/callback?tenantId=...&providerName=...`

## Health checks

Use these endpoints for load balancers and service monitors:

- API liveness: `GET /health/live`
- API readiness: `GET /health/ready`

The readiness endpoint checks database connectivity and storage availability.

## Database migrations

This project uses [node-pg-migrate](https://github.com/salsita/node-pg-migrate) for database schema management. Migrations must be run **before** starting the API or worker services.

### Running migrations

```bash
# From the repo root, run migrations against your database
DATABASE_URL=<your_database_url> npm run migrate -w @legal-agent/api

# To rollback the last migration
DATABASE_URL=<your_database_url> npm run migrate:down -w @legal-agent/api

# To create a new migration
npm run migrate:create -w @legal-agent/api -- <migration-name>
```

### Migration files

Migrations are located in `db/migrations/` and follow the format `YYYYMMDDHHMMSS_description.js`. The initial schema migration (`20260101000000_initial-schema.js`) creates all core tables.

### CI/CD integration

In your deployment pipeline, run migrations as a separate step before deploying the API:

```yaml
# Example GitHub Actions step
- name: Run database migrations
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: npm run migrate -w @legal-agent/api
```

## Deployment sequence

1. Provision PostgreSQL with the `pgvector` extension.
2. Provision S3 bucket and credentials.
3. Store secrets in your secret manager.
4. **Run database migrations** (see above).
5. Deploy the `api` service.
6. Deploy the `worker` service.
7. Deploy the `web` service.
8. Use the platform admin secret to create your first tenant through `POST /api/platform/tenants`.
9. If you are using local-password auth initially, create or invite your first tenant users.
10. Configure each tenant's OIDC or SAML provider through the tenant admin APIs and register the callback/metadata details with the identity provider.
11. Create a tenant SCIM token from the admin console if your IdP will provision users or groups.
12. If your IdP supports SCIM groups, map it to `/scim/v2/Groups` as well as `/scim/v2/Users`.
13. Point DNS and TLS to the web and api endpoints.
14. Verify `GET /health/ready` on the API.
15. Log in with the tenant admin user, register a passkey, test passwordless passkey login, and confirm SSO/MFA actions work.
16. Upload a test document and confirm quarantine scan, promotion, OCR, and ingestion all complete successfully.

## Scaling guidance

- `web`: scale on CPU or request rate
- `api`: scale on CPU, memory, and latency
- `worker`: scale on job backlog and processing time
- Postgres: start small but monitor CPU, connections, and storage IOPS
- S3: usually scales automatically

## Production hardening checklist

- Put the API behind a WAF or managed API gateway
- Add rate limiting and abuse protection at the edge
- Add OpenTelemetry tracing and centralized logs
- Add backups and point-in-time recovery for PostgreSQL
- Add bucket lifecycle rules and retention policies
- Run at least one dedicated worker replica per environment so quarantine and OCR jobs do not stall
- Run ClamAV as a reachable internal service if `MALWARE_SCANNER=clamav`
- Rotate SCIM bearer tokens and SAML signing keys through your secret manager
- If you use SAML SLO, confirm your IdP is configured with the provider-specific logout callback URL and test both SP-initiated and IdP-initiated logout
