import { Pool } from "pg";
import { sampleData } from "./sampleData.js";
import { config } from "./config.js";
import { getApiKeyPrefix, hashApiKey, hashPassword } from "./security.js";

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required to start the API.");
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: config.dbIdleTimeoutMs,
  connectionTimeoutMillis: config.dbConnectTimeoutMs,
  ssl: config.nodeEnv === "production"
    ? { rejectUnauthorized: true }   // enforce TLS to RDS in production
    : false
});

// Log pool-level errors (e.g. idle client disconnected by DB) without crashing
pool.on("error", (err) => {
  console.error("[pg pool] Unexpected idle client error:", err.message);
});

async function seedDatabase() {
  const existing = await pool.query<{ count: string }>("select count(*)::text as count from tenants");
  if (Number(existing.rows[0]?.count ?? "0") > 0) {
    return;
  }

  await pool.query(
    "insert into tenants (id, name, region, plan) values ($1, $2, $3, $4)",
    ["tenant-demo", "Demo Legal LLP", "IN", "growth"]
  );

  for (const attorney of sampleData.attorneys) {
    // Only seed the demo user with a password - others require invitation/password reset
    const passwordHash = attorney.email === config.demoUserEmail
      ? await hashPassword(config.demoUserPassword)
      : null;
    
    // Only the demo user can login initially; others need to be invited
    const canLogin = attorney.email === config.demoUserEmail;

    await pool.query(
      `insert into attorneys
       (id, tenant_id, email, full_name, role, practice_area, password_hash, can_login, is_tenant_admin)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        attorney.id,
        "tenant-demo",
        attorney.email,
        attorney.fullName,
        attorney.role,
        attorney.practiceArea,
        passwordHash,
        canLogin,
        attorney.id === "att-1"
      ]
    );
  }

  for (const matter of sampleData.matters) {
    await pool.query(
      `insert into matters
       (id, tenant_id, matter_code, title, client_name, matter_type, status, jurisdiction, responsible_attorney_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        matter.id,
        "tenant-demo",
        matter.matterCode,
        matter.title,
        matter.clientName,
        matter.matterType,
        matter.status,
        matter.jurisdiction,
        matter.responsibleAttorneyId
      ]
    );
  }

  for (const document of sampleData.documents) {
    await pool.query(
      `insert into documents
       (id, tenant_id, matter_id, source_name, file_uri, sha256, mime_type, doc_type, ingestion_status, normalized_text,
        privilege_score, relevance_score)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        document.id,
        "tenant-demo",
        document.matterId,
        document.sourceName,
        document.storagePath ?? "seed://sample",
        `seed-${document.id}`,
        document.mimeType,
        document.docType,
        document.ingestionStatus,
        document.normalizedText,
        document.privilegeScore,
        document.relevanceScore
      ]
    );

    if (document.embedding?.length) {
      await pool.query(
        `insert into document_chunks
         (id, tenant_id, document_id, page_from, page_to, chunk_index, text_content, citation_json, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::halfvec)`,
        [
          `${document.id}-chunk-1`,
          "tenant-demo",
          document.id,
          1,
          1,
          0,
          document.normalizedText,
          JSON.stringify({ source: document.sourceName }),
          document.embedding
        ]
      );
    }
  }

  for (const clause of sampleData.clauses) {
    await pool.query(
      `insert into clauses
       (id, tenant_id, document_id, clause_type, heading, text_excerpt, page_from, page_to, risk_level, confidence, reviewer_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        clause.id,
        "tenant-demo",
        clause.documentId,
        clause.clauseType,
        clause.heading,
        clause.textExcerpt,
        clause.pageFrom,
        clause.pageTo,
        clause.riskLevel,
        clause.confidence,
        clause.reviewerStatus
      ]
    );
  }

  for (const flag of sampleData.flags) {
    await pool.query(
      `insert into flags
       (id, tenant_id, matter_id, document_id, clause_id, flag_type, severity, reason, confidence, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        flag.id,
        "tenant-demo",
        flag.matterId,
        flag.documentId,
        flag.clauseId ?? null,
        flag.flagType,
        flag.severity,
        flag.reason,
        flag.confidence,
        flag.status
      ]
    );
  }

  await pool.query(
    `insert into api_keys
     (id, tenant_id, attorney_id, key_prefix, key_hash, role, status)
     values ($1, $2, $3, $4, $5, $6, 'active')`,
    [
      "api-key-demo-1",
      "tenant-demo",
      "att-1",
      getApiKeyPrefix(config.demoApiKey),
      hashApiKey(config.demoApiKey),
      "partner"
    ]
  );
}

export async function initializeDatabase() {
  // Migrations are now run via `npm run migrate` before the service starts.
  // This function only verifies connectivity and optionally seeds demo data.
  // See DEPLOYMENT.md for the deployment sequence.
  await pool.query("SELECT 1");
  console.log("[database] Connection verified.");
  
  // Only seed demo data when explicitly requested
  if (config.seedDemoData) {
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

export async function checkDatabaseConnection() {
  await pool.query("select 1");
}

export async function closeDatabase() {
  await pool.end();
}
