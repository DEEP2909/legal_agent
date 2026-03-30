import { initializeDatabase } from "./database.js";
import { ensureDirectories } from "./storage.js";
import { startWorker } from "./worker.js";

await initializeDatabase();
await ensureDirectories();
startWorker();
