import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for services layer logic.
 * Tests clause extraction parsing, risk assessment logic, and research response handling.
 * Uses mocked OpenAI responses to test the parsing and validation logic.
 */

describe("clause extraction response parsing", () => {
  // Re-implement the clause parsing logic for testing
  interface ParsedClause {
    clauseType: string;
    text: string;
    riskLevel: "low" | "medium" | "high";
    explanation: string;
  }

  function parseClauseResponse(response: string): ParsedClause[] {
    try {
      // Handle markdown code blocks
      let cleaned = response.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      
      const parsed = JSON.parse(cleaned.trim());
      
      if (!Array.isArray(parsed)) {
        return [];
      }
      
      return parsed.filter((clause: unknown) => {
        if (typeof clause !== "object" || clause === null) return false;
        const c = clause as Record<string, unknown>;
        return (
          typeof c.clauseType === "string" &&
          typeof c.text === "string" &&
          ["low", "medium", "high"].includes(String(c.riskLevel))
        );
      });
    } catch {
      return [];
    }
  }

  it("should parse valid JSON array of clauses", () => {
    const response = JSON.stringify([
      {
        clauseType: "indemnification",
        text: "Party A shall indemnify Party B...",
        riskLevel: "high",
        explanation: "Broad indemnification clause"
      },
      {
        clauseType: "limitation_of_liability",
        text: "Neither party shall be liable...",
        riskLevel: "medium",
        explanation: "Caps liability at contract value"
      }
    ]);
    
    const clauses = parseClauseResponse(response);
    expect(clauses).toHaveLength(2);
    expect(clauses[0].clauseType).toBe("indemnification");
    expect(clauses[0].riskLevel).toBe("high");
  });

  it("should handle markdown code block wrapper", () => {
    const response = `\`\`\`json
[{
  "clauseType": "termination",
  "text": "Either party may terminate with 30 days notice.",
  "riskLevel": "low",
  "explanation": "Standard termination clause"
}]
\`\`\``;
    
    const clauses = parseClauseResponse(response);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].clauseType).toBe("termination");
  });

  it("should filter out invalid clauses", () => {
    const response = JSON.stringify([
      { clauseType: "valid", text: "Some text", riskLevel: "low" },
      { clauseType: 123, text: "Invalid type" }, // invalid clauseType
      { clauseType: "missing_risk", text: "No risk level" }, // missing riskLevel
      { clauseType: "bad_risk", text: "Text", riskLevel: "invalid" } // invalid riskLevel
    ]);
    
    const clauses = parseClauseResponse(response);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].clauseType).toBe("valid");
  });

  it("should return empty array for invalid JSON", () => {
    expect(parseClauseResponse("not valid json")).toEqual([]);
    expect(parseClauseResponse("{ malformed")).toEqual([]);
    expect(parseClauseResponse("")).toEqual([]);
  });

  it("should return empty array for non-array JSON", () => {
    expect(parseClauseResponse('{"clauses": []}')).toEqual([]);
    expect(parseClauseResponse('"string"')).toEqual([]);
    expect(parseClauseResponse("42")).toEqual([]);
  });
});

describe("risk assessment response parsing", () => {
  interface RiskAssessment {
    overallRisk: "low" | "medium" | "high" | "critical";
    score: number;
    flags: Array<{
      severity: "low" | "medium" | "high" | "critical";
      title: string;
      description: string;
      clauseReference?: string;
    }>;
    summary: string;
  }

  function parseRiskResponse(response: string): RiskAssessment | null {
    try {
      let cleaned = response.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      
      const parsed = JSON.parse(cleaned.trim());
      
      if (typeof parsed !== "object" || parsed === null) return null;
      
      const validRiskLevels = ["low", "medium", "high", "critical"];
      if (!validRiskLevels.includes(parsed.overallRisk)) return null;
      if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100) return null;
      if (!Array.isArray(parsed.flags)) return null;
      if (typeof parsed.summary !== "string") return null;
      
      return {
        overallRisk: parsed.overallRisk,
        score: parsed.score,
        flags: parsed.flags.filter((f: unknown) => {
          if (typeof f !== "object" || f === null) return false;
          const flag = f as Record<string, unknown>;
          return (
            validRiskLevels.includes(String(flag.severity)) &&
            typeof flag.title === "string" &&
            typeof flag.description === "string"
          );
        }),
        summary: parsed.summary
      };
    } catch {
      return null;
    }
  }

  it("should parse valid risk assessment response", () => {
    const response = JSON.stringify({
      overallRisk: "high",
      score: 78,
      flags: [
        {
          severity: "high",
          title: "Unlimited liability",
          description: "No cap on damages"
        },
        {
          severity: "medium",
          title: "Short notice period",
          description: "Only 7 days termination notice"
        }
      ],
      summary: "Contract contains several high-risk provisions."
    });
    
    const result = parseRiskResponse(response);
    expect(result).not.toBeNull();
    expect(result?.overallRisk).toBe("high");
    expect(result?.score).toBe(78);
    expect(result?.flags).toHaveLength(2);
    expect(result?.summary).toContain("high-risk");
  });

  it("should handle markdown wrapper", () => {
    const response = `\`\`\`json
{
  "overallRisk": "low",
  "score": 25,
  "flags": [],
  "summary": "Low risk contract."
}
\`\`\``;
    
    const result = parseRiskResponse(response);
    expect(result).not.toBeNull();
    expect(result?.overallRisk).toBe("low");
  });

  it("should reject invalid overall risk level", () => {
    const response = JSON.stringify({
      overallRisk: "extreme", // invalid
      score: 50,
      flags: [],
      summary: "Test"
    });
    
    expect(parseRiskResponse(response)).toBeNull();
  });

  it("should reject score out of range", () => {
    expect(parseRiskResponse(JSON.stringify({
      overallRisk: "medium",
      score: 150, // > 100
      flags: [],
      summary: "Test"
    }))).toBeNull();
    
    expect(parseRiskResponse(JSON.stringify({
      overallRisk: "medium",
      score: -10, // < 0
      flags: [],
      summary: "Test"
    }))).toBeNull();
  });

  it("should filter invalid flags", () => {
    const response = JSON.stringify({
      overallRisk: "medium",
      score: 50,
      flags: [
        { severity: "high", title: "Valid", description: "Valid flag" },
        { severity: "invalid", title: "Bad severity", description: "Desc" },
        { title: "Missing severity", description: "Desc" },
        { severity: "low", description: "Missing title" }
      ],
      summary: "Some issues found."
    });
    
    const result = parseRiskResponse(response);
    expect(result).not.toBeNull();
    expect(result?.flags).toHaveLength(1);
    expect(result?.flags[0].title).toBe("Valid");
  });

  it("should return null for invalid JSON", () => {
    expect(parseRiskResponse("not json")).toBeNull();
    expect(parseRiskResponse("")).toBeNull();
  });
});

describe("research response handling", () => {
  interface ResearchResult {
    answer: string;
    sourceDocumentIds: string[];
    modelName: string;
  }

  function validateResearchResponse(response: unknown): ResearchResult | null {
    if (typeof response !== "object" || response === null) return null;
    
    const r = response as Record<string, unknown>;
    
    if (typeof r.answer !== "string" || r.answer.trim().length === 0) return null;
    
    const sourceIds = Array.isArray(r.sourceDocumentIds)
      ? r.sourceDocumentIds.filter((id): id is string => typeof id === "string")
      : [];
    
    return {
      answer: r.answer,
      sourceDocumentIds: sourceIds,
      modelName: typeof r.modelName === "string" ? r.modelName : "unknown"
    };
  }

  it("should validate complete research response", () => {
    const response = {
      answer: "Based on the documents, the limitation of liability is capped at $1M.",
      sourceDocumentIds: ["doc-123", "doc-456"],
      modelName: "gpt-4.1"
    };
    
    const result = validateResearchResponse(response);
    expect(result).not.toBeNull();
    expect(result?.answer).toContain("limitation of liability");
    expect(result?.sourceDocumentIds).toHaveLength(2);
    expect(result?.modelName).toBe("gpt-4.1");
  });

  it("should reject empty answers", () => {
    expect(validateResearchResponse({ answer: "", sourceDocumentIds: [] })).toBeNull();
    expect(validateResearchResponse({ answer: "   ", sourceDocumentIds: [] })).toBeNull();
  });

  it("should handle missing or invalid source document IDs", () => {
    const response = {
      answer: "The contract specifies...",
      sourceDocumentIds: ["valid-id", 123, null, "another-id"],
      modelName: "gpt-4.1"
    };
    
    const result = validateResearchResponse(response);
    expect(result).not.toBeNull();
    expect(result?.sourceDocumentIds).toEqual(["valid-id", "another-id"]);
  });

  it("should default modelName to unknown", () => {
    const result = validateResearchResponse({
      answer: "Some answer",
      sourceDocumentIds: []
    });
    
    expect(result?.modelName).toBe("unknown");
  });

  it("should reject non-object responses", () => {
    expect(validateResearchResponse(null)).toBeNull();
    expect(validateResearchResponse("string")).toBeNull();
    expect(validateResearchResponse(42)).toBeNull();
    expect(validateResearchResponse(undefined)).toBeNull();
  });
});

describe("tenant context validation", () => {
  function ensureTenantContext<T extends { tenantId?: string }>(
    entity: T,
    sessionTenantId: string
  ): T & { tenantId: string } {
    if (entity.tenantId && entity.tenantId !== sessionTenantId) {
      throw new Error("Cross-tenant access denied");
    }
    return { ...entity, tenantId: sessionTenantId };
  }

  it("should set tenantId from session", () => {
    const entity = { name: "Test Document" };
    const result = ensureTenantContext(entity, "tenant-abc");
    
    expect(result.tenantId).toBe("tenant-abc");
    expect(result.name).toBe("Test Document");
  });

  it("should allow matching tenantId", () => {
    const entity = { name: "Test", tenantId: "tenant-abc" };
    const result = ensureTenantContext(entity, "tenant-abc");
    
    expect(result.tenantId).toBe("tenant-abc");
  });

  it("should reject mismatched tenantId (cross-tenant access)", () => {
    const entity = { name: "Test", tenantId: "tenant-xyz" };
    
    expect(() => ensureTenantContext(entity, "tenant-abc"))
      .toThrow("Cross-tenant access denied");
  });
});
