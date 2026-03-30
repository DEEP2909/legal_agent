import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  generateRawApiKey,
  getApiKeyPrefix,
  hashApiKey,
  generateRecoveryCodes,
  hashRecoveryCode,
  generateOpaqueToken,
  generatePkcePair,
  fromBase64Url,
  toBase64Url,
  encryptSecret,
  decryptSecret
} from "../security.js";

describe("Password Hashing", () => {
  it("should hash and verify a password", async () => {
    const password = "ChangeMe123!";
    const hash = await hashPassword(password);
    expect(hash).toBeTruthy();
    expect(hash).not.toBe(password);
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it("should reject wrong passwords", async () => {
    const hash = await hashPassword("ChangeMe123!");
    expect(await verifyPassword("WrongPassword!", hash)).toBe(false);
  });
});

describe("API Key Operations", () => {
  it("should generate a raw API key that contains the prefix", () => {
    const raw = generateRawApiKey();
    expect(raw.length).toBeGreaterThan(20);
    const prefix = getApiKeyPrefix(raw);
    expect(raw.startsWith(prefix)).toBe(true);
  });

  it("should produce consistent hashes for the same key", () => {
    const raw = generateRawApiKey();
    const hash1 = hashApiKey(raw);
    const hash2 = hashApiKey(raw);
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different keys", () => {
    const key1 = generateRawApiKey();
    const key2 = generateRawApiKey();
    expect(hashApiKey(key1)).not.toBe(hashApiKey(key2));
  });
});

describe("Recovery Codes", () => {
  it("should generate the requested number of codes", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    codes.forEach((code) => {
      expect(code.length).toBeGreaterThan(5);
    });
  });

  it("should produce different hashes for each code", () => {
    const codes = generateRecoveryCodes(4);
    const hashes = codes.map(hashRecoveryCode);
    const unique = new Set(hashes);
    expect(unique.size).toBe(4);
  });
});

describe("Opaque Token Generation", () => {
  it("should generate tokens with a given prefix", () => {
    const token = generateOpaqueToken("mfa");
    expect(token.startsWith("mfa_")).toBe(true);
    expect(token.length).toBeGreaterThan(10);
  });

  it("should generate unique tokens", () => {
    const t1 = generateOpaqueToken("test");
    const t2 = generateOpaqueToken("test");
    expect(t1).not.toBe(t2);
  });
});

describe("PKCE Pair Generation", () => {
  it("should generate a valid PKCE pair", () => {
    const pair = generatePkcePair();
    expect(pair.codeVerifier.length).toBeGreaterThan(40);
    expect(pair.codeChallenge.length).toBeGreaterThan(10);
  });
});

describe("Base64URL Encoding/Decoding", () => {
  it("should round-trip a buffer", () => {
    const original = Buffer.from("Hello, Legal Agent!");
    const encoded = toBase64Url(original);
    const decoded = fromBase64Url(encoded);
    expect(Buffer.from(decoded).toString()).toBe("Hello, Legal Agent!");
  });
});

describe("Secret Encryption/Decryption", () => {
  it("should encrypt and decrypt a secret", () => {
    const secret = "my-super-secret-value-12345";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toBe(secret);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it("should return empty string for empty input", () => {
    expect(decryptSecret("")).toBe("");
    expect(encryptSecret("")).toBe("");
  });
});
