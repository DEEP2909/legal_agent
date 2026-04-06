import type {
  AuthSession,
  ClauseExtractionRequest,
  ClauseRecord,
  DocumentRecord,
  FlagRecord,
  ResearchResponse,
  RiskAssessmentRequest
} from "@legal-agent/shared";
import { createHash, randomUUID } from "node:crypto";
import {
  answerResearchWithOpenAI,
  assessRiskWithOpenAI,
  embedTextWithOpenAI,
  extractClausesWithOpenAI
} from "../openaiClient.js";
import {
  buildClauseExtractionPrompt,
  buildResearchPrompt,
  buildRiskPrompt,
  clauseExtractionSystemPrompt
} from "../prompts.js";
import { repository } from "../repository.js";
import { chunkText, embedChunksWithConcurrencyLimit } from "../worker.js";
import { config } from "../config.js";
import { defaultPlaybook, ensureTenant, sanitizeDocumentForResponse } from "./shared.js";

export const documentService = {
  async dashboard(session: AuthSession) {
    return repository.getDashboard(session.tenantId);
  },

  async ingestDocument(
    session: AuthSession,
    input: {
      matterId: string;
      sourceName: string;
      mimeType: string;
      docType: string;
      normalizedText?: string;
      storagePath?: string;
      sha256: string;
    }
  ) {
    const matter = await repository.getMatterForTenant(input.matterId, session.tenantId);
    if (!matter) {
      throw new Error("Matter not found for tenant.");
    }

    const existingDocument = await repository.getDocumentByShaForTenant(session.tenantId, input.sha256);
    if (existingDocument) {
      return existingDocument;
    }

    const document: DocumentRecord = ensureTenant<DocumentRecord>(
      {
        id: randomUUID(),
        matterId: input.matterId,
        sourceName: input.sourceName,
        mimeType: input.mimeType,
        docType: input.docType,
        ingestionStatus: input.normalizedText ? "normalized" : "processing",
        securityStatus: "clean",
        normalizedText: input.normalizedText ?? "",
        privilegeScore: 0.2,
        relevanceScore: 0.75,
        storagePath: input.storagePath,
        createdAt: new Date().toISOString(),
        sha256: input.sha256,
        createdBy: session.attorneyId,
        language: "en"
      },
      session.tenantId
    );

    if (document.normalizedText) {
      // Use chunking for better semantic search coverage (same as worker.ts)
      const chunks = chunkText(document.normalizedText);
      const chunkRows = chunks.length > 0
        ? await embedChunksWithConcurrencyLimit(chunks)
        : [];
      
      // Save all chunks to the database
      await repository.saveDocumentChunks(document.id, session.tenantId, chunkRows);
      
      // Store the first chunk's embedding on the document for backward compatibility
      document.embedding = chunkRows[0]?.embedding ?? [];
    }

    await repository.addDocument(document);

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.ingested",
      objectType: "document",
      objectId: document.id,
      metadata: {
        matterId: document.matterId,
        docType: document.docType,
        ingestionStatus: document.ingestionStatus
      }
    });

    if (!document.normalizedText) {
      await repository.createWorkflowJob({
        id: randomUUID(),
        tenantId: session.tenantId,
        jobType: "document.ingest",
        payload: {
          documentId: document.id
        }
      });
    }

    return sanitizeDocumentForResponse(document);
  },

  async queueUploadedDocument(
    session: AuthSession,
    input: {
      matterId: string;
      sourceName: string;
      mimeType: string;
      docType: string;
      storagePath: string;
      sha256: string;
    }
  ) {
    const matter = await repository.getMatterForTenant(input.matterId, session.tenantId);
    if (!matter) {
      throw new Error("Matter not found for tenant.");
    }

    const existingDocument = await repository.getDocumentByShaForTenant(session.tenantId, input.sha256);
    if (existingDocument) {
      return existingDocument;
    }

    const document: DocumentRecord = ensureTenant<DocumentRecord>(
      {
        id: randomUUID(),
        matterId: input.matterId,
        sourceName: input.sourceName,
        mimeType: input.mimeType,
        docType: input.docType,
        ingestionStatus: "uploaded",
        securityStatus: "pending_scan",
        normalizedText: "",
        privilegeScore: 0.2,
        relevanceScore: 0.75,
        storagePath: input.storagePath,
        createdAt: new Date().toISOString(),
        sha256: input.sha256,
        createdBy: session.attorneyId,
        language: "en"
      },
      session.tenantId
    );

    await repository.addDocument(document);
    await repository.createWorkflowJob({
      id: randomUUID(),
      tenantId: session.tenantId,
      jobType: "document.scan",
      payload: {
        documentId: document.id
      },
      maxAttempts: 3
    });
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.uploaded",
      objectType: "document",
      objectId: document.id,
      metadata: {
        matterId: document.matterId,
        storagePath: document.storagePath,
        securityStatus: document.securityStatus
      }
    });

    return sanitizeDocumentForResponse(document);
  },

  async queueDocumentRescan(session: AuthSession, documentId: string) {
    const document = await repository.getDocumentForTenant(documentId, session.tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    if (!document.storagePath) {
      throw new Error("Document does not have a stored file to rescan.");
    }

    await repository.updateDocument(document.id, session.tenantId, (existing) => ({
      ...existing,
      ingestionStatus: existing.normalizedText ? existing.ingestionStatus : "uploaded",
      securityStatus: "pending_scan",
      securityReason: undefined
    }));
    await repository.createWorkflowJob({
      id: randomUUID(),
      tenantId: session.tenantId,
      jobType: "document.rescan",
      payload: {
        documentId: document.id
      },
      maxAttempts: 3
    });
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.rescan_requested",
      objectType: "document",
      objectId: document.id
    });

    return { ok: true };
  },

  async extractClauses(session: AuthSession, input: ClauseExtractionRequest) {
    const document = await repository.getDocumentForTenant(input.documentId, session.tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    // Truncate text to ~15k tokens to avoid exceeding context window and control cost
    const MAX_CHARS = 60_000;
    const safeText = (input.normalizedText || document.normalizedText || "").slice(0, MAX_CHARS);

    const prompt = `${clauseExtractionSystemPrompt}\n\n${buildClauseExtractionPrompt({
      documentType: input.documentType || document.docType,
      normalizedText: safeText
    })}`;
    const result = await extractClausesWithOpenAI(prompt);

    // Record AI usage for billing/quota tracking
    if (result.usage) {
      await repository.recordUsageEvent({
        id: randomUUID(),
        tenantId: session.tenantId,
        attorneyId: session.attorneyId,
        operation: "clause_extraction",
        model: result.usage.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens
      });
    }

    const clauses: ClauseRecord[] = result.clauses.map((clause) => ({
      id: randomUUID(),
      documentId: input.documentId,
      clauseType: clause.clause_type,
      heading: clause.heading,
      textExcerpt: clause.text_excerpt,
      pageFrom: clause.page_from,
      pageTo: clause.page_to,
      riskLevel: clause.risk_level,
      confidence: clause.confidence,
      reviewerStatus: "pending"
    }));

    await repository.replaceClauses(input.documentId, clauses, session.tenantId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.clauses_extracted",
      objectType: "document",
      objectId: input.documentId,
      metadata: {
        clauseCount: clauses.length
      }
    });
    return clauses;
  },

  async assessRisk(
    session: AuthSession,
    input: RiskAssessmentRequest & { matterId: string; documentId: string; clauseId?: string }
  ) {
    const document = await repository.getDocumentForTenant(input.documentId, session.tenantId);
    if (!document) {
      throw new Error("Document not found for tenant.");
    }

    // Determine which playbook rules to use:
    // 1. If rules provided in request, use those
    // 2. Otherwise, load tenant's active playbook from DB
    // 3. Fall back to default playbook if no tenant playbook exists
    let playbookRules: string[];
    if (input.playbook.length > 0) {
      playbookRules = input.playbook;
    } else {
      const tenantPlaybook = await repository.getActivePlaybook(session.tenantId);
      playbookRules = tenantPlaybook?.rules ?? defaultPlaybook;
    }

    const prompt = buildRiskPrompt({
      clauseText: input.clauseText,
      playbook: playbookRules
    });
    const result = await assessRiskWithOpenAI(prompt);

    // Record AI usage for billing/quota tracking
    if (result.usage) {
      await repository.recordUsageEvent({
        id: randomUUID(),
        tenantId: session.tenantId,
        attorneyId: session.attorneyId,
        operation: "risk_assessment",
        model: result.usage.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens
      });
    }

    const flags: FlagRecord[] = result.flags.map((flag) => ({
      id: randomUUID(),
      matterId: input.matterId,
      documentId: input.documentId,
      clauseId: input.clauseId,
      flagType: flag.flag_type,
      severity: flag.severity,
      reason: `${flag.issue} Recommended fix: ${flag.recommended_fix}`,
      confidence: flag.confidence,
      status: "open"
    }));

    await repository.addFlags(flags, session.tenantId);
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "document.risk_assessed",
      objectType: "document",
      objectId: input.documentId,
      metadata: {
        flagCount: flags.length
      }
    });
    return flags;
  },

  async research(session: AuthSession, question: string): Promise<ResearchResponse> {
    const { embedding: questionEmbedding, usage: embeddingUsage } = await embedTextWithOpenAI(question);

    // Record embedding usage
    if (embeddingUsage) {
      await repository.recordUsageEvent({
        id: randomUUID(),
        tenantId: session.tenantId,
        attorneyId: session.attorneyId,
        operation: "embedding",
        model: embeddingUsage.model,
        promptTokens: embeddingUsage.promptTokens,
        completionTokens: embeddingUsage.completionTokens,
        totalTokens: embeddingUsage.totalTokens
      });
    }

    // Use pgvector for efficient vector similarity search
    const similarChunks = await repository.searchSimilarChunks(
      session.tenantId,
      questionEmbedding,
      { limit: 10 }
    );

    // Deduplicate by document ID, keeping highest-scoring chunk per document
    const seenDocuments = new Set<string>();
    const topChunksByDocument = similarChunks.filter((chunk) => {
      if (seenDocuments.has(chunk.documentId)) {
        return false;
      }
      seenDocuments.add(chunk.documentId);
      return true;
    }).slice(0, 5); // Keep top 5 unique documents

    const corpus = topChunksByDocument.map(
      (chunk) =>
        `${chunk.sourceName} (semantic score ${chunk.score.toFixed(2)}): ${chunk.textContent}`
    );
    const sourceDocumentIds = topChunksByDocument.map((chunk) => chunk.documentId);

    const prompt = buildResearchPrompt({ question, corpus });
    const result = await answerResearchWithOpenAI(prompt);

    // Record AI usage for billing/quota tracking
    if (result.usage) {
      await repository.recordUsageEvent({
        id: randomUUID(),
        tenantId: session.tenantId,
        attorneyId: session.attorneyId,
        operation: "research",
        model: result.usage.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens
      });
    }
    
    // Save research query to history
    await repository.recordResearch({
      tenantId: session.tenantId,
      attorneyId: session.attorneyId,
      question,
      result,
      modelName: config.openAiModel,
      sourceDocumentIds,
      contextUsed: corpus.join("\n\n")
    });
    
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "research.queried",
      objectType: "research",
      objectId: createHash("sha256").update(question).digest("hex"),
      metadata: {
        question
      }
    });
    return result;
  },

  async getResearchHistory(session: AuthSession, opts?: { limit?: number; cursor?: string }) {
    return repository.getResearchHistory(session.tenantId, {
      attorneyId: session.attorneyId,
      limit: opts?.limit,
      cursor: opts?.cursor
    });
  },

  async reviewFeedback(session: AuthSession, input: {
    flagId: string;
    action: "approved" | "rejected" | "resolved";
  }) {
    // Validate flag belongs to tenant before any action
    const flag = await repository.getFlagById(input.flagId, session.tenantId);
    if (!flag) {
      throw new Error("Flag not found or access denied");
    }

    let result;
    if (input.action === "resolved") {
      result = await repository.resolveFlag(input.flagId, session.tenantId);
    } else {
      // approved or rejected - actually persist the status
      result = await repository.updateFlagStatus(input.flagId, session.tenantId, input.action);
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId: session.tenantId,
      actorAttorneyId: session.attorneyId,
      eventType: "review.feedback_recorded",
      objectType: "flag",
      objectId: input.flagId,
      metadata: {
        action: input.action,
        reviewerId: session.attorneyId  // Use session instead of untrusted input
      }
    });

    return result ?? { id: input.flagId, stored: true };
  },

  async listMatterDocuments(session: AuthSession, matterId: string) {
    const documents = await repository.getMatterDocuments(matterId, session.tenantId);
    return documents.map(sanitizeDocumentForResponse);
  },

};


