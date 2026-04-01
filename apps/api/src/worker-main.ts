import { closeDatabase, initializeDatabase } from "./database.js";
import { ensureDirectories } from "./storage.js";
import { startWorker, stopWorker } from "./worker.js";

await initializeDatabase();
await ensureDirectories();
startWorker();

async function shutdown(signal: string) {
  console.log(`[worker] Received ${signal}, draining in-flight jobs…`);
  await stopWorker();
  await closeDatabase();
  console.log("[worker] Clean shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
