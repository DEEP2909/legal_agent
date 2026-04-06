/**
 * Shared helper functions used across services
 */

// Region-specific playbook rules
export const playbooksByRegion: Record<string, string[]> = {
  US: [
    "Indemnity cap must not exceed 2x the contract value unless specifically negotiated.",
    "Governing law must be Delaware, New York, or California law for US domestic deals.",
    "Counterparty assignment requires prior written consent.",
    "Confidentiality clauses must survive termination for at least 3 years.",
    "Dispute resolution should specify AAA arbitration or state/federal court jurisdiction.",
    "Insurance requirements must include general liability ($1M minimum) and E&O coverage.",
    "Compliance with SOX, HIPAA, or other applicable federal regulations must be addressed.",
    "IP assignment clauses must clearly define work product ownership.",
    "Force majeure clauses should explicitly address pandemics and cyber events."
  ],
  India: [
    "Indemnity cap must not exceed 20% of purchase price.",
    "Governing law must be Indian law for domestic deals.",
    "Counterparty assignment requires prior written consent.",
    "Confidentiality clauses must survive termination for at least 3 years.",
    "Dispute resolution should prefer arbitration seated in Mumbai or Delhi.",
    "Stamp duty and registration requirements must be addressed.",
    "Foreign exchange compliance (FEMA) must be ensured for cross-border transactions."
  ],
  UK: [
    "Indemnity cap must not exceed 100% of contract value for standard commercial deals.",
    "Governing law must be English law for UK domestic deals.",
    "Counterparty assignment requires prior written consent.",
    "Confidentiality clauses must survive termination for at least 3 years.",
    "Dispute resolution should specify LCIA arbitration or English courts.",
    "GDPR compliance provisions must be included where personal data is processed."
  ],
  default: [
    "Indemnity cap must be reasonable relative to contract value.",
    "Governing law should match the primary jurisdiction of operations.",
    "Counterparty assignment requires prior written consent.",
    "Confidentiality clauses must survive termination for at least 3 years.",
    "Dispute resolution mechanism must be clearly specified.",
    "Compliance with applicable local regulations must be addressed."
  ]
};

// Default playbook (US-focused for primary market)
export const defaultPlaybook = playbooksByRegion.US;

export function getPlaybookForJurisdiction(jurisdiction?: string): string[] {
  if (!jurisdiction) return defaultPlaybook;
  const normalized = jurisdiction.toUpperCase().trim();
  
  // Match common jurisdiction patterns
  if (normalized.includes("US") || normalized.includes("UNITED STATES") || 
      normalized.includes("DELAWARE") || normalized.includes("NEW YORK") || 
      normalized.includes("CALIFORNIA")) {
    return playbooksByRegion.US;
  }
  if (normalized.includes("INDIA") || normalized.includes("MUMBAI") || 
      normalized.includes("DELHI") || normalized.includes("BANGALORE")) {
    return playbooksByRegion.India;
  }
  if (normalized.includes("UK") || normalized.includes("UNITED KINGDOM") || 
      normalized.includes("ENGLAND") || normalized.includes("LONDON")) {
    return playbooksByRegion.UK;
  }
  
  return playbooksByRegion.default;
}

export function ensureTenant<T extends { tenantId?: string }>(entity: T, tenantId: string) {
  if (entity.tenantId && entity.tenantId !== tenantId) {
    throw new Error("Access denied.");
  }
}

export function sanitizeDocumentForResponse(doc: { storagePath?: unknown; [key: string]: unknown }) {
  const { storagePath: _, ...rest } = doc;
  return rest;
}

export function normalizeRedirectPath(redirectPath?: string | null) {
  if (!redirectPath) return "/";
  // Prevent open redirect attacks by ensuring the path is relative
  if (redirectPath.startsWith("/") && !redirectPath.startsWith("//")) {
    return redirectPath;
  }
  return "/";
}

export function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) {
    return { givenName: "", familyName: "" };
  }
  if (parts.length === 1) {
    return { givenName: parts[0], familyName: "" };
  }
  return {
    givenName: parts.slice(0, -1).join(" "),
    familyName: parts[parts.length - 1]
  };
}

export function getRecoveryCodeHashes(input: unknown) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as string[];
    } catch {
      return [];
    }
  }
  return Array.isArray(input) ? input as string[] : [];
}

