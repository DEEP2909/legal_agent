import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { embedTextWithOpenAI } from "./openaiClient.js";
import { scanBufferForThreats } from "./malware.js";
import { extractTextForIngestion } from "./ocr.js";
import { repository } from "./repository.js";
import { moveStoredObject, readStoredObject } from "./storage.js";

/**
 * In-process concurrency guard. If this worker is scaled to multiple processes,
 * each instance will have its own isRunning flag. Database-level locking
 * (SELECT FOR UPDATE SKIP LOCKED in claimWorkflowJobs) prevents duplicate processing.
 */
let isRunning = false;
const workerId = `worker-${randomUUID()}`;

// Job timeout in milliseconds (10 minutes)
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

function getFinalStoragePath(storagePath: string) {
  if (storagePath.includes("/quarantine/")) {
    return storagePath.replace("/quarantine/", "/uploads/");
  }

  if (storagePath.includes("\\quarantine\\")) {
    return storagePath.replace("\\quarantine\\", "\\uploads\\");
  }

  if (storagePath.includes("/quarantine/".replace(/\//g, "\\"))) {
    return storagePath.replace("/quarantine/".replace(/\//g, "\\"), "/uploads/".replace(/\//g, "\\"));
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
  if (isRunning) {
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

          const normalizedText =
            document.normalizedText.trim() ||
            (document.storagePath
              ? await extractTextForIngestion(document.storagePath, document.mimeType)
              : "");

          const embedding = await embedTextWithOpenAI(normalizedText.slice(0, 4000));

          await repository.updateDocument(document.id, job.tenantId, (existing) => ({
            ...existing,
            normalizedText,
            embedding,
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
  // Run job recovery on startup and periodically
  void recoverStuckJobs();
  setInterval(() => {
    void recoverStuckJobs();
  }, JOB_TIMEOUT_MS / 2); // Check for stuck jobs at half the timeout interval
  
  setInterval(() => {
    void processPendingDocuments();
  }, config.jobPollIntervalMs);
  void processPendingDocuments();
}
