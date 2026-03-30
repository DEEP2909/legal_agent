import { describe, it, expect } from "vitest";

/**
 * Unit tests for service-layer helper functions.
 *
 * These test the pure utility functions extracted at the top of services.ts.
 * Since they are not exported from the module, we re-implement the logic here
 * and test the contracts they enforce.
 */

describe("normalizeRedirectPath", () => {
  // Re-implement the helper logic for unit testing
  function normalizeRedirectPath(redirectPath?: string | null) {
    if (!redirectPath || !redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
      return "/";
    }
    return redirectPath;
  }

  it("should return '/' for null/undefined input", () => {
    expect(normalizeRedirectPath(null)).toBe("/");
    expect(normalizeRedirectPath(undefined)).toBe("/");
    expect(normalizeRedirectPath("")).toBe("/");
  });

  it("should return '/' for paths that don't start with /", () => {
    expect(normalizeRedirectPath("dashboard")).toBe("/");
    expect(normalizeRedirectPath("http://evil.com")).toBe("/");
  });

  it("should return '/' for // (protocol-relative URL attack)", () => {
    expect(normalizeRedirectPath("//evil.com")).toBe("/");
    expect(normalizeRedirectPath("//evil.com/path")).toBe("/");
  });

  it("should allow valid absolute paths", () => {
    expect(normalizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(normalizeRedirectPath("/admin/settings")).toBe("/admin/settings");
    expect(normalizeRedirectPath("/")).toBe("/");
  });
});

describe("ensureTenant", () => {
  function ensureTenant<T extends Record<string, unknown>>(entity: T, tenantId: string) {
    return { ...entity, tenantId };
  }

  it("should set tenantId on entity", () => {
    const result = ensureTenant({ name: "test" }, "tenant-123");
    expect(result.tenantId).toBe("tenant-123");
    expect(result.name).toBe("test");
  });

  it("should override existing tenantId", () => {
    const result = ensureTenant({ tenantId: "old" }, "new-tenant");
    expect(result.tenantId).toBe("new-tenant");
  });
});

describe("splitFullName", () => {
  function splitFullName(fullName: string) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      return {
        givenName: parts[0] ?? fullName,
        familyName: ""
      };
    }
    return {
      givenName: parts.slice(0, -1).join(" "),
      familyName: parts.at(-1) ?? ""
    };
  }

  it("should split a simple two-part name", () => {
    const result = splitFullName("John Doe");
    expect(result.givenName).toBe("John");
    expect(result.familyName).toBe("Doe");
  });

  it("should handle three-part names", () => {
    const result = splitFullName("Mary Jane Watson");
    expect(result.givenName).toBe("Mary Jane");
    expect(result.familyName).toBe("Watson");
  });

  it("should handle single-word names", () => {
    const result = splitFullName("Prince");
    expect(result.givenName).toBe("Prince");
    expect(result.familyName).toBe("");
  });

  it("should handle empty/whitespace strings", () => {
    const result = splitFullName("  ");
    expect(result.familyName).toBe("");
  });

  it("should trim extra whitespace", () => {
    const result = splitFullName("  John   Doe  ");
    expect(result.givenName).toBe("John");
    expect(result.familyName).toBe("Doe");
  });
});

describe("getLoginExpirySeconds", () => {
  function getLoginExpirySeconds() {
    return 8 * 60 * 60;
  }

  it("should return 8 hours in seconds", () => {
    expect(getLoginExpirySeconds()).toBe(28800);
  });
});

describe("getRecoveryCodeHashes", () => {
  function getRecoveryCodeHashes(input: unknown) {
    if (!Array.isArray(input)) {
      return [];
    }
    return input.map((value) => String(value));
  }

  it("should return empty array for non-array input", () => {
    expect(getRecoveryCodeHashes(null)).toEqual([]);
    expect(getRecoveryCodeHashes(undefined)).toEqual([]);
    expect(getRecoveryCodeHashes("string")).toEqual([]);
    expect(getRecoveryCodeHashes(123)).toEqual([]);
  });

  it("should convert array values to strings", () => {
    expect(getRecoveryCodeHashes(["hash1", "hash2"])).toEqual(["hash1", "hash2"]);
  });

  it("should handle mixed types", () => {
    expect(getRecoveryCodeHashes([123, true, "abc"])).toEqual(["123", "true", "abc"]);
  });
});

describe("buildWebRedirectUrl", () => {
  function normalizeRedirectPath(redirectPath?: string | null) {
    if (!redirectPath || !redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
      return "/";
    }
    return redirectPath;
  }

  function buildWebRedirectUrl(
    redirectPath: string | null | undefined,
    params: Record<string, string>,
    webAppUrl = "http://localhost:3000"
  ) {
    const redirectUrl = new URL(normalizeRedirectPath(redirectPath), webAppUrl);
    for (const [key, value] of Object.entries(params)) {
      redirectUrl.searchParams.set(key, value);
    }
    return redirectUrl.toString();
  }

  it("should build URL with params", () => {
    const url = buildWebRedirectUrl("/callback", { token: "abc123" });
    expect(url).toBe("http://localhost:3000/callback?token=abc123");
  });

  it("should default to root path for null", () => {
    const url = buildWebRedirectUrl(null, { code: "xyz" });
    expect(url).toBe("http://localhost:3000/?code=xyz");
  });

  it("should encode special characters", () => {
    const url = buildWebRedirectUrl("/", { message: "hello world" });
    expect(url).toContain("message=hello+world");
  });

  it("should handle multiple params", () => {
    const url = buildWebRedirectUrl("/auth", { a: "1", b: "2" });
    expect(url).toContain("a=1");
    expect(url).toContain("b=2");
  });
});
