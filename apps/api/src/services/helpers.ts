/**
 * Shared helper functions used across services
 */
export const defaultPlaybook = [
  "Indemnity cap must not exceed 20% of purchase price.",
  "Governing law must be Indian law for domestic deals.",
  "Counterparty assignment requires prior written consent.",
  "Confidentiality clauses must survive termination for at least 3 years.",
  "Dispute resolution should prefer arbitration seated in Mumbai."
];

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

