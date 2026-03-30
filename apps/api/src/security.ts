import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";

const scrypt = promisify(scryptCallback);
const secretPrefix = "enc:v1";

export function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function getApiKeyPrefix(apiKey: string) {
  return apiKey.slice(0, 8);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedKeyBuffer = Buffer.from(key, "hex");

  if (storedKeyBuffer.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(storedKeyBuffer, derivedKey);
}

export function generateRawApiKey() {
  return `la_${randomBytes(24).toString("hex")}`;
}

export function generateOpaqueToken(prefix = "lt") {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function toBase64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

export function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

export function validateAndNormalizeCertificate(value: string): { valid: boolean; error?: string; normalized?: string } {
  const normalized = normalizePem(value);
  
  // Check basic PEM format
  if (!normalized.includes("-----BEGIN CERTIFICATE-----") || !normalized.includes("-----END CERTIFICATE-----")) {
    return { valid: false, error: "Invalid certificate format: missing PEM headers" };
  }
  
  try {
    // Extract the base64 content between headers
    const base64Content = normalized
      .replace("-----BEGIN CERTIFICATE-----", "")
      .replace("-----END CERTIFICATE-----", "")
      .replace(/\s/g, "");
    
    // Decode to verify it's valid base64
    const derBuffer = Buffer.from(base64Content, "base64");
    
    // Basic DER structure validation - certificates start with SEQUENCE tag (0x30)
    if (derBuffer.length < 10 || derBuffer[0] !== 0x30) {
      return { valid: false, error: "Invalid certificate: not a valid DER-encoded certificate" };
    }
    
    // Parse certificate to extract validity dates using basic ASN.1 parsing
    // Note: For production, consider using a proper X.509 library like @peculiar/x509
    const certInfo = parseBasicCertInfo(derBuffer);
    
    if (certInfo.notBefore && certInfo.notAfter) {
      const now = new Date();
      if (now < certInfo.notBefore) {
        return { valid: false, error: `Certificate is not yet valid (valid from ${certInfo.notBefore.toISOString()})` };
      }
      if (now > certInfo.notAfter) {
        return { valid: false, error: `Certificate has expired (expired on ${certInfo.notAfter.toISOString()})` };
      }
    }
    
    return { valid: true, normalized };
  } catch (error) {
    return { valid: false, error: `Certificate validation failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

function parseBasicCertInfo(derBuffer: Buffer): { notBefore?: Date; notAfter?: Date } {
  // Basic ASN.1 DER parsing to find validity dates
  // X.509 structure: SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
  // tbsCertificate contains: version, serialNumber, signature, issuer, validity, subject, ...
  // validity is: SEQUENCE { notBefore, notAfter }
  
  try {
    let offset = 0;
    
    // Skip outer SEQUENCE
    if (derBuffer[offset] !== 0x30) return {};
    offset = skipTag(derBuffer, offset);
    
    // Skip tbsCertificate SEQUENCE header
    if (derBuffer[offset] !== 0x30) return {};
    offset = skipTag(derBuffer, offset);
    
    // Skip version (context tag 0, optional)
    if (derBuffer[offset] === 0xa0) {
      offset = skipTagAndContent(derBuffer, offset);
    }
    
    // Skip serialNumber (INTEGER)
    offset = skipTagAndContent(derBuffer, offset);
    
    // Skip signature algorithm (SEQUENCE)
    offset = skipTagAndContent(derBuffer, offset);
    
    // Skip issuer (SEQUENCE)
    offset = skipTagAndContent(derBuffer, offset);
    
    // Validity SEQUENCE
    if (derBuffer[offset] !== 0x30) return {};
    offset = skipTag(derBuffer, offset);
    
    // Parse notBefore
    const notBefore = parseTime(derBuffer, offset);
    if (notBefore.date) {
      offset = notBefore.nextOffset;
    } else {
      return {};
    }
    
    // Parse notAfter
    const notAfter = parseTime(derBuffer, offset);
    
    return {
      notBefore: notBefore.date,
      notAfter: notAfter.date
    };
  } catch {
    return {};
  }
}

function skipTag(buffer: Buffer, offset: number): number {
  offset++; // Skip tag byte
  const length = buffer[offset];
  if (length < 0x80) {
    return offset + 1;
  }
  const numOctets = length & 0x7f;
  return offset + 1 + numOctets;
}

function skipTagAndContent(buffer: Buffer, offset: number): number {
  const tag = buffer[offset];
  offset++;
  let length = buffer[offset];
  offset++;
  
  if (length >= 0x80) {
    const numOctets = length & 0x7f;
    length = 0;
    for (let i = 0; i < numOctets; i++) {
      length = (length << 8) | buffer[offset + i];
    }
    offset += numOctets;
  }
  
  return offset + length;
}

function parseTime(buffer: Buffer, offset: number): { date?: Date; nextOffset: number } {
  const tag = buffer[offset];
  offset++;
  let length = buffer[offset];
  offset++;
  
  if (length >= 0x80) {
    const numOctets = length & 0x7f;
    length = 0;
    for (let i = 0; i < numOctets; i++) {
      length = (length << 8) | buffer[offset + i];
    }
    offset += numOctets;
  }
  
  const timeStr = buffer.subarray(offset, offset + length).toString("ascii");
  offset += length;
  
  let date: Date | undefined;
  
  if (tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    const year = parseInt(timeStr.substring(0, 2), 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    date = new Date(Date.UTC(
      fullYear,
      parseInt(timeStr.substring(2, 4), 10) - 1,
      parseInt(timeStr.substring(4, 6), 10),
      parseInt(timeStr.substring(6, 8), 10),
      parseInt(timeStr.substring(8, 10), 10),
      parseInt(timeStr.substring(10, 12), 10)
    ));
  } else if (tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    date = new Date(Date.UTC(
      parseInt(timeStr.substring(0, 4), 10),
      parseInt(timeStr.substring(4, 6), 10) - 1,
      parseInt(timeStr.substring(6, 8), 10),
      parseInt(timeStr.substring(8, 10), 10),
      parseInt(timeStr.substring(10, 12), 10),
      parseInt(timeStr.substring(12, 14), 10)
    ));
  }
  
  return { date, nextOffset: offset };
}

function getEncryptionKey() {
  return createHash("sha256").update(config.appEncryptionKey).digest();
}

export function encryptSecret(value: string) {
  if (!value) {
    return value;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${secretPrefix}:${toBase64Url(iv)}:${toBase64Url(encrypted)}:${toBase64Url(tag)}`;
}

export function decryptSecret(value: string) {
  if (!value || !value.startsWith(`${secretPrefix}:`)) {
    return value;
  }

  const parts = value.split(":");
  // Format is "enc:v1:iv:encrypted:tag", so we need the last 3 parts
  if (parts.length !== 5) {
    throw new Error("Encrypted secret payload is malformed.");
  }
  const [, , ivPart, encryptedPart, tagPart] = parts;
  if (!ivPart || !encryptedPart || !tagPart) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), fromBase64Url(ivPart));
  decipher.setAuthTag(fromBase64Url(tagPart));
  const decrypted = Buffer.concat([
    decipher.update(fromBase64Url(encryptedPart)),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function formatRecoveryCode(bytes: Buffer) {
  const code = bytes.toString("hex").toUpperCase();
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export function normalizeRecoveryCode(value: string) {
  return value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function hashRecoveryCode(value: string) {
  return hashApiKey(normalizeRecoveryCode(value));
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => formatRecoveryCode(randomBytes(4)));
}

export function generatePkcePair() {
  const codeVerifier = toBase64Url(randomBytes(32));
  const codeChallenge = toBase64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}
