import { pool } from "./database.js";
import type { PoolClient } from "pg";

/**
 * Execute a function within a database transaction.
 * Automatically commits on success and rolls back on failure.
 *
 * Issue #11: Multi-step operations (invitation acceptance, MFA enrollment, etc.)
 * should be wrapped in this utility to maintain data consistency.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
