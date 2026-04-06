/**
 * Shared helper functions used across services
 */

// Region-specific playbook rules
export const playbooksByRegion: Record<string, string[]> = {
  // General US federal rules (baseline for all states)
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

// US State-specific rules that supplement the base US playbook
export const usStateRules: Record<string, string[]> = {
  // Delaware - Corporate law hub
  DELAWARE: [
    "Delaware Court of Chancery preferred for corporate disputes.",
    "Delaware General Corporation Law (DGCL) provisions should be referenced for corporate governance.",
    "Fiduciary duty standards follow Delaware case law (Revlon, Unocal, entire fairness)."
  ],
  
  // New York - Financial contracts hub
  NEW_YORK: [
    "New York law preferred for financial and banking contracts.",
    "Choice of law provision should explicitly waive NY General Obligations Law § 5-1401 requirements if under $250K.",
    "Attorneys' fees provisions are generally not enforceable unless statutory."
  ],
  
  // California - Tech and employment strictest
  CALIFORNIA: [
    "Non-compete clauses are void and unenforceable under Business & Professions Code § 16600.",
    "Employee invention assignment must comply with Labor Code § 2870 (personal inventions exemption).",
    "CCPA/CPRA compliance required for contracts involving California consumer data.",
    "California has strict employee classification rules (AB5) - independent contractor provisions need careful review.",
    "Prevailing party attorneys' fees clauses are enforceable in contract disputes."
  ],
  
  // Texas - Energy and business-friendly
  TEXAS: [
    "Non-compete clauses must be ancillary to an otherwise enforceable agreement.",
    "Texas Business & Commerce Code governs commercial transactions.",
    "Arbitration provisions strongly enforced under Texas Arbitration Act.",
    "No state income tax - may affect compensation structure provisions."
  ],
  
  // Florida - Real estate and consumer protection
  FLORIDA: [
    "Non-compete clauses are enforceable if reasonable in time, area, and scope.",
    "Florida Deceptive and Unfair Trade Practices Act (FDUTPA) applies to consumer contracts.",
    "Specific venue provisions required for enforceability.",
    "Hurricane/force majeure provisions critical for Florida operations."
  ],
  
  // Illinois - Employment law focus
  ILLINOIS: [
    "Illinois Freedom to Work Act restricts non-competes for employees earning under $75K.",
    "Biometric Information Privacy Act (BIPA) compliance required for biometric data.",
    "Illinois Consumer Fraud Act applies to business-to-consumer contracts.",
    "Prevailing party attorneys' fees not automatic - must be specified."
  ],
  
  // Massachusetts - Employee-friendly
  MASSACHUSETTS: [
    "Non-compete clauses limited to 12 months and require garden leave or other consideration.",
    "Massachusetts Data Privacy Law compliance required for personal data.",
    "Non-competes cannot be enforced against employees terminated without cause.",
    "Tip pooling and wage payment laws are strictly enforced."
  ],
  
  // Washington - Tech hub with strong employee protections
  WASHINGTON: [
    "Non-compete clauses void for employees earning under $116,593 (adjusted annually).",
    "Washington Privacy Act compliance required for consumer data.",
    "Independent contractor classification strictly scrutinized.",
    "Non-competes require 10+ days advance notice before employment."
  ],
  
  // Colorado - Privacy and non-compete restrictions
  COLORADO: [
    "Non-compete clauses limited to highly compensated employees and sale of business.",
    "Colorado Privacy Act (CPA) compliance required for consumer data processing.",
    "Non-competes require separate disclosure and acknowledgment.",
    "Equal pay transparency requirements affect compensation provisions."
  ],
  
  // Virginia - Growing tech hub
  VIRGINIA: [
    "Virginia Consumer Data Protection Act (VCDPA) compliance required for consumer data.",
    "Non-competes must be narrowly tailored and supported by legitimate business interest.",
    "Low-wage workers (under median income) cannot be bound by non-competes.",
    "Computer Crimes Act has broad application to tech contracts."
  ],
  
  // Nevada - Business formation and gaming
  NEVADA: [
    "Nevada does not recognize non-compete agreements that impose undue hardship.",
    "No state corporate income tax - affects entity structure provisions.",
    "Gaming and hospitality contracts have specific regulatory requirements.",
    "Nevada Revised Statutes Chapter 104 governs commercial transactions."
  ],
  
  // Georgia - Headquarters hub
  GEORGIA: [
    "Restrictive Covenants Act (2011) governs non-competes with specific requirements.",
    "Non-competes must be reasonable in time (2 years max for non-sales), scope, and geography.",
    "Blue pencil doctrine applies - courts may modify overbroad provisions.",
    "Georgia Consumer Protection Act applies to consumer contracts."
  ],
  
  // New Jersey - Strong employee protections
  NEW_JERSEY: [
    "Non-competes evaluated under three-prong reasonableness test.",
    "New Jersey Consumer Fraud Act provides broad consumer protections.",
    "Strong wage and hour enforcement - payment provisions carefully reviewed.",
    "ABC test for independent contractor classification."
  ],
  
  // Pennsylvania - Varied by region
  PENNSYLVANIA: [
    "Non-competes must be supported by adequate consideration beyond continued employment.",
    "Pennsylvania's Unfair Trade Practices and Consumer Protection Law applies broadly.",
    "Different procedural rules between state and federal courts.",
    "Philadelphia and Pittsburgh have additional local ordinances."
  ],
  
  // Arizona - Business-friendly
  ARIZONA: [
    "Non-competes generally enforceable if reasonable in duration and scope.",
    "Arizona Consumer Fraud Act applies to consumer transactions.",
    "Community property state - may affect acquisition structures.",
    "Strong arbitration enforcement."
  ],
  
  // North Carolina - Right to work state
  NORTH_CAROLINA: [
    "Non-competes must be in writing and part of employment contract.",
    "Five-year maximum duration for non-competes.",
    "Unfair and Deceptive Trade Practices Act has broad private right of action.",
    "Right to work state - union provisions limited."
  ],
  
  // Ohio - Manufacturing and healthcare hub  
  OHIO: [
    "Non-competes subject to reasonableness analysis on case-by-case basis.",
    "Ohio Consumer Sales Practices Act applies to consumer contracts.",
    "Physicians cannot be bound by non-competes under certain conditions.",
    "Strong trade secret protections under Ohio Uniform Trade Secrets Act."
  ],
  
  // Michigan - Auto industry and non-compete restrictions
  MICHIGAN: [
    "Michigan Antitrust Reform Act limits non-competes - must protect reasonable competitive business interest.",
    "Non-competes void for certain professionals (attorneys, physicians in some cases).",
    "Michigan Consumer Protection Act applies to consumer transactions.",
    "Right to work state since 2013."
  ],

  // Minnesota - Employee protections
  MINNESOTA: [
    "Non-compete ban effective July 2023 - non-competes are void for most employees.",
    "Non-solicitation and confidentiality agreements still permitted.",
    "Minnesota Consumer Fraud Act provides broad protections.",
    "Strong wage theft protections."
  ]
};

// Default playbook (US-focused for primary market)
export const defaultPlaybook = playbooksByRegion.US;

/**
 * Get the playbook rules for a given jurisdiction.
 * For US states, returns base US rules plus state-specific supplements.
 */
export function getPlaybookForJurisdiction(jurisdiction?: string): string[] {
  if (!jurisdiction) return defaultPlaybook;
  const normalized = jurisdiction.toUpperCase().trim();
  
  // Check for specific US states first
  for (const [state, rules] of Object.entries(usStateRules)) {
    if (normalized.includes(state) || normalized.includes(state.replace("_", " "))) {
      // Return base US rules plus state-specific rules
      return [...playbooksByRegion.US, ...rules];
    }
  }
  
  // Check common state abbreviations
  const stateAbbreviations: Record<string, string> = {
    "DE": "DELAWARE", "NY": "NEW_YORK", "CA": "CALIFORNIA", "TX": "TEXAS",
    "FL": "FLORIDA", "IL": "ILLINOIS", "MA": "MASSACHUSETTS", "WA": "WASHINGTON",
    "CO": "COLORADO", "VA": "VIRGINIA", "NV": "NEVADA", "GA": "GEORGIA",
    "NJ": "NEW_JERSEY", "PA": "PENNSYLVANIA", "AZ": "ARIZONA", "NC": "NORTH_CAROLINA",
    "OH": "OHIO", "MI": "MICHIGAN", "MN": "MINNESOTA"
  };
  
  for (const [abbr, state] of Object.entries(stateAbbreviations)) {
    // Match "TX" or "TX," or ", TX" patterns
    const pattern = new RegExp(`\\b${abbr}\\b`, "i");
    if (pattern.test(normalized)) {
      const stateRules = usStateRules[state];
      if (stateRules) {
        return [...playbooksByRegion.US, ...stateRules];
      }
    }
  }
  
  // General US match
  if (normalized.includes("US") || normalized.includes("UNITED STATES") || normalized.includes("USA")) {
    return playbooksByRegion.US;
  }
  
  // India
  if (normalized.includes("INDIA") || normalized.includes("MUMBAI") || 
      normalized.includes("DELHI") || normalized.includes("BANGALORE") ||
      normalized.includes("CHENNAI") || normalized.includes("HYDERABAD")) {
    return playbooksByRegion.India;
  }
  
  // UK
  if (normalized.includes("UK") || normalized.includes("UNITED KINGDOM") || 
      normalized.includes("ENGLAND") || normalized.includes("LONDON") ||
      normalized.includes("SCOTLAND") || normalized.includes("WALES")) {
    return playbooksByRegion.UK;
  }
  
  return playbooksByRegion.default;
}

/**
 * Get list of all supported US states
 */
export function getSupportedUSStates(): string[] {
  return Object.keys(usStateRules).map(s => s.replace("_", " "));
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

