import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { config } from "./config.js";
import { embedTextWithOpenAI } from "./openaiClient.js";
import { scanBufferForThreats } from "./malware.js";
import { extractTextForIngestion } from "./ocr.js";
import { repository } from "./repository.js";
import { moveStoredObject, readStoredObject } from "./storage.js";

// Heartbeat file path for Docker health check
const HEARTBEAT_FILE = "/tmp/worker-heartbeat";

/** Write current timestamp to heartbeat file for health checks */
function writeHeartbeat() {
  try {
    writeFileSync(HEARTBEAT_FILE, Date.now().toString());
  } catch {
    // Ignore errors (e.g., read-only filesystem in some envs)
  }
}

/**
 * In-process concurrency guard. If this worker is scaled to multiple processes,
 * each instance will have its own isRunning flag. Database-level locking
 * (SELECT FOR UPDATE SKIP LOCKED in claimWorkflowJobs) prevents duplicate processing.
 */
let isRunning = false;
let shouldStop = false;
const workerId = `worker-${randomUUID()}`;

// Job timeout in milliseconds (10 minutes)
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

// Chunking configuration
const CHUNK_SIZE = 1500;       // characters per chunk
const CHUNK_OVERLAP = 200;     // overlap between adjacent chunks
const MIN_CHUNK_LENGTH = 50;   // skip near-empty trailing chunks
const MAX_CONCURRENT_EMBEDDINGS = 5; // limit concurrent API calls

/**
 * Split text into overlapping chunks for better semantic search coverage.
 * This ensures that context isn't lost at chunk boundaries.
 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = text.slice(i, i + CHUNK_SIZE);
    if (chunk.trim().length >= MIN_CHUNK_LENGTH) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

/**
 * Embed multiple chunks with concurrency limiting to avoid rate limits.
 */
export async function embedChunksWithConcurrencyLimit(
  chunks: string[]
): Promise<Array<{ index: number; text: string; embedding: number[] }>> {
  const results: Array<{ index: number; text: string; embedding: number[] }> = [];
  
  for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_EMBEDDINGS) {
    const batch = chunks.slice(i, i + MAX_CONCURRENT_EMBEDDINGS);
    const batchResults = await Promise.all(
      batch.map(async (text, batchIndex) => {
        const { embedding } = await embedTextWithOpenAI(text);
        return {
          index: i + batchIndex,
          text,
          embedding
        };
      })
    );
    results.push(...batchResults);
  }
  
  return results;
}

function getFinalStoragePath(storagePath: string) {
  // Handle Unix-style paths
  if (storagePath.includes("/quarantine/")) {
    return storagePath.replace("/quarantine/", "/uploads/");
  }

  // Handle Windows-style paths
  if (storagePath.includes("\\quarantine\\")) {
    return storagePath.replace("\\quarantine\\", "\\uploads\\");
  }

  return storagePath;
}

/**
 * Recover jobs that have been stuck in processing state for too long.
 * This handles cases where a worker crashed while processing a job.
 */
async function recoverStuckJobs() {
  try {
    const recoveredCount = await repository.recoverStuckWorkflowJobs(JOB_TIMEOUT_MS);
    if (recoveredCount > 0) {
      console.log(`[Worker] Recovered ${recoveredCount} stuck job(s)`);
    }
  } catch (error) {
    console.error("[Worker] Error recovering stuck jobs:", error);
  }
}

export async function processPendingDocuments() {
  if (isRunning || shouldStop) {
    return;
  }

  isRunning = true;

  try {
    const jobs = await repository.claimWorkflowJobs(workerId, 10);

    for (const job of jobs) {
      try {
        const documentId = String(job.payload.documentId ?? "");
        const document = await repository.getDocumentForTenant(documentId, job.tenantId);
        if (!document) {
          throw new Error("Document not found for job.");
        }

        if (job.jobType === "document.scan" || job.jobType === "document.rescan") {
          if (!document.storagePath) {
            throw new Error("Document does not have a stored file to scan.");
          }

          const buffer = await readStoredObject(document.storagePath);
          await scanBufferForThreats({
            buffer,
            fileName: document.sourceName
          });

          const finalStoragePath = getFinalStoragePath(document.storagePath);
          const moved = await moveStoredObject({
            fromPath: document.storagePath,
            toPath: finalStoragePath
          });

          await repository.updateDocument(document.id, job.tenantId, (existing) => ({
            ...existing,
            storagePath: moved.storagePath,
            ingestionStatus: existing.normalizedText.trim() ? existing.ingestionStatus : "processing",
            securityStatus: "clean",
            securityReason: undefined
          }));

          if (!document.normalizedText.trim()) {
            await repository.createWorkflowJob({
              id: randomUUID(),
              tenantId: job.tenantId,
              jobType: "document.ingest",
              payload: {
                documentId: document.id
              }
            });
          }
        } else if (job.jobType === "document.ingest") {
          if (document.securityStatus !== "clean") {
            throw new Error("Document cannot be ingested until malware scanning is complete.");
          }

          let normalizedText: string;
          let pageCount: number | null = null;
          
          if (document.normalizedText.trim()) {
            normalizedText = document.normalizedText.trim();
          } else if (document.storagePath) {
            const result = await extractTextForIngestion(document.storagePath, document.mimeType);
            normalizedText = result.text;
            pageCount = result.pageCount;
          } else {
            normalizedText = "";
          }

          // Chunk the document text for better semantic search coverage
          const chunks = chunkText(normalizedText);
          
          // Generate embeddings for all chunks with concurrency limiting
          const chunkRows = chunks.length > 0 
            ? await embedChunksWithConcurrencyLimit(chunks)
            : [];

          // Save all chunks to the database
          await repository.saveDocumentChunks(document.id, job.tenantId, chunkRows);

          // Store the first chunk's embedding on the document for backward compatibility
          const firstEmbedding = chunkRows[0]?.embedding ?? [];

          await repository.updateDocument(document.id, job.tenantId, (existing) => ({
            ...existing,
            normalizedText,
            embedding: firstEmbedding,
            pageCount: pageCount ?? existing.pageCount,
            ingestionStatus: "normalized",
            securityStatus: "clean",
            securityReason: undefined
          }));
        } else {
          await repository.completeWorkflowJob(job.id);
          continue;
        }

        await repository.completeWorkflowJob(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown worker error";
        const documentId = String(job.payload.documentId ?? "");
        const finalFailure = await repository.failWorkflowJob(job.id, message, job.maxAttempts);
        if (documentId && finalFailure) {
          const document = await repository.getDocumentForTenant(documentId, job.tenantId);
          if (document) {
            const isThreat = /malware|virus|infected|eicar|threat/i.test(message);
            await repository.updateDocument(documentId, job.tenantId, (existing) => ({
              ...existing,
              ingestionStatus: "failed",
              securityStatus: isThreat ? "quarantined" : existing.securityStatus,
              securityReason: message
            }));
          }
        }
      }
    }
  } finally {
    isRunning = false;
  }
}

export function startWorker() {
  // Write initial heartbeat
  writeHeartbeat();
  
  // Run job recovery on startup and periodically
  void recoverStuckJobs();
  setInterval(() => {
    void recoverStuckJobs();
  }, JOB_TIMEOUT_MS / 2); // Check for stuck jobs at half the timeout interval
  
  // Write heartbeat every 30 seconds to signal liveness
  setInterval(() => {
    writeHeartbeat();
  }, 30_000);
  
  setInterval(() => {
    writeHeartbeat(); // Also write heartbeat on each poll cycle
    void processPendingDocuments();
  }, config.jobPollIntervalMs);
  
  // Cleanup expired tokens and auth states periodically
  setInterval(async () => {
    try {
      const deletedTokens = await repository.cleanupExpiredRefreshTokens();
      if (deletedTokens > 0) {
        console.log(`[Worker] Cleaned up ${deletedTokens} expired refresh tokens`);
      }
    } catch (error) {
      console.error("[Worker] Error cleaning up expired tokens:", error);
    }
  }, 6 * 60 * 60 * 1000); // every 6 hours
  
  void processPendingDocuments();
}

/**
 * Gracefully stop the worker, allowing in-flight jobs to complete.
 * Returns a promise that resolves when the worker has stopped.
 */
export function stopWorker(): Promise<void> {
  shouldStop = true;
  console.log("[worker] Stopping worker, waiting for in-flight jobs...");
  
  return new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!isRunning) {
        clearInterval(check);
        console.log("[worker] Worker stopped cleanly.");
        resolve();
      }
    }, 500);
    
    // Force resolve after 30 seconds even if job is still running
    setTimeout(() => {
      clearInterval(check);
      console.log("[worker] Worker shutdown timeout, forcing exit.");
      resolve();
    }, 30_000);
  });
}
