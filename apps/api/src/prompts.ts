export const clauseExtractionSystemPrompt =
  "You are a legal contract extraction engine supporting US and international law practices. Extract only what is explicitly stated. Return valid JSON only.";

export function buildClauseExtractionPrompt(input: {
  documentType: string;
  normalizedText: string;
  jurisdiction?: string;
}) {
  const jurisdiction = input.jurisdiction || "US (Default)";
  return `
Document type: ${input.documentType}
Jurisdiction: ${jurisdiction}
Clause taxonomy:
- indemnity
- limitation_of_liability
- termination
- governing_law
- assignment
- confidentiality
- dispute_resolution
- payment
- change_of_control
- non_compete
- intellectual_property
- force_majeure
- representations_warranties
- insurance
- compliance

Return strict JSON using this schema:
{
  "clauses": [
    {
      "clause_type": "string",
      "heading": "string|null",
      "text_excerpt": "string",
      "page_from": "integer",
      "page_to": "integer",
      "risk_level": "low|medium|high",
      "confidence": "number 0-1"
    }
  ]
}

Instructions:
- Extract only clauses present in the text.
- Preserve original wording for text_excerpt.
- Mark risk_level as high only if the text suggests uncapped liability, foreign governing law in a domestic deal, unilateral assignment, missing confidentiality guardrails, or non-compliance with applicable regulations.
- Return {"clauses":[]} if nothing relevant appears.

Text:
${input.normalizedText}
`.trim();
}

export function buildRiskPrompt(input: { clauseText: string; playbook: string[]; jurisdiction?: string }) {
  const jurisdiction = input.jurisdiction || "US";
  return `
You are a contract deviation detection engine for corporate law practices.
Jurisdiction context: ${jurisdiction}

Playbook:
${input.playbook.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}

Return strict JSON using this schema:
{
  "flags": [
    {
      "flag_type": "deviation",
      "severity": "info|warn|critical",
      "issue": "string",
      "playbook_rule": "string",
      "recommended_fix": "string",
      "confidence": "number 0-1"
    }
  ]
}

Clause text:
${input.clauseText}
`.trim();
}

export function buildResearchPrompt(input: { question: string; corpus: string[]; jurisdiction?: string }) {
  const jurisdiction = input.jurisdiction || "US";
  return `
You are a legal research assistant for corporate lawyers.
Jurisdiction context: ${jurisdiction}
Answer only from the provided materials and clearly state when the record is incomplete.

Materials:
${input.corpus.map((item, index) => `[${index + 1}] ${item}`).join("\n")}

Return JSON:
{
  "answer": "string",
  "citations": [{"title":"string","citation":"string","relevance":"number 0-1"}]
}

Question: ${input.question}
`.trim();
}
