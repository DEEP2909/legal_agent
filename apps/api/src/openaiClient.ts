import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";

const clauseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    clauses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          clause_type: { type: "string" },
          heading: { type: ["string", "null"] },
          text_excerpt: { type: "string" },
          page_from: { type: "integer" },
          page_to: { type: "integer" },
          risk_level: { type: "string", enum: ["low", "medium", "high"] },
          confidence: { type: "number" }
        },
        required: [
          "clause_type",
          "heading",
          "text_excerpt",
          "page_from",
          "page_to",
          "risk_level",
          "confidence"
        ]
      }
    }
  },
  required: ["clauses"]
} as const;

const riskJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          flag_type: { type: "string", enum: ["deviation"] },
          severity: { type: "string", enum: ["info", "warn", "critical"] },
          issue: { type: "string" },
          playbook_rule: { type: "string" },
          recommended_fix: { type: "string" },
          confidence: { type: "number" }
        },
        required: [
          "flag_type",
          "severity",
          "issue",
          "playbook_rule",
          "recommended_fix",
          "confidence"
        ]
      }
    }
  },
  required: ["flags"]
} as const;

const researchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          citation: { type: "string" },
          relevance: { type: "number" }
        },
        required: ["title", "citation", "relevance"]
      }
    }
  },
  required: ["answer", "citations"]
} as const;

const clauseSchema = z.object({
  clauses: z.array(
    z.object({
      clause_type: z.string(),
      heading: z.string().nullable(),
      text_excerpt: z.string(),
      page_from: z.number().int(),
      page_to: z.number().int(),
      risk_level: z.enum(["low", "medium", "high"]),
      confidence: z.number()
    })
  )
});

const riskSchema = z.object({
  flags: z.array(
    z.object({
      flag_type: z.literal("deviation"),
      severity: z.enum(["info", "warn", "critical"]),
      issue: z.string(),
      playbook_rule: z.string(),
      recommended_fix: z.string(),
      confidence: z.number()
    })
  )
});

const researchSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      title: z.string(),
      citation: z.string(),
      relevance: z.number()
    })
  )
});

const client = config.openAiApiKey
  ? new OpenAI({
      apiKey: config.openAiApiKey,
      maxRetries: 3,      // Auto-retry on 429 / 5xx with exponential backoff
      timeout: 120_000,   // 2 min hard timeout per request
    })
  : null;

async function runJsonPrompt<T>(
  prompt: string,
  schema: z.ZodType<T>,
  jsonSchema: Record<string, unknown>,
  fallback: T
): Promise<T> {
  if (!client) {
    return fallback;
  }

  const response = await client.responses.create({
    model: config.openAiModel,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "legal_agent_response",
        schema: jsonSchema
      }
    }
  });

  return schema.parse(JSON.parse(response.output_text));
}

export async function extractClausesWithOpenAI(prompt: string) {
  return runJsonPrompt(prompt, clauseSchema, clauseJsonSchema, { clauses: [] });
}

export async function assessRiskWithOpenAI(prompt: string) {
  return runJsonPrompt(prompt, riskSchema, riskJsonSchema, { flags: [] });
}

export async function answerResearchWithOpenAI(prompt: string) {
  return runJsonPrompt(prompt, researchSchema, researchJsonSchema, {
    answer: "No OpenAI API key configured. This is a placeholder grounded response.",
    citations: []
  });
}

export async function embedTextWithOpenAI(text: string) {
  if (!client) {
    return Array.from({ length: 12 }, (_, index) => (text.length % (index + 7)) / 10);
  }

  const response = await client.embeddings.create({
    model: config.embeddingModel,
    input: text
  });

  return response.data[0]?.embedding ?? [];
}
