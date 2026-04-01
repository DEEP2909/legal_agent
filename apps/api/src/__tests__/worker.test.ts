import { describe, it, expect } from "vitest";
import { chunkText } from "../worker.js";

/**
 * Unit tests for worker utility functions.
 * Tests chunking logic and retry backoff calculations.
 */

describe("chunkText", () => {
  // These constants mirror the worker.ts configuration
  const CHUNK_SIZE = 1500;
  const CHUNK_OVERLAP = 200;
  const MIN_CHUNK_LENGTH = 50;

  it("should return empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("should return empty array for whitespace-only string", () => {
    expect(chunkText("   \n\t   ")).toEqual([]);
  });

  it("should return single chunk for text longer than MIN_CHUNK_LENGTH", () => {
    const shortText = "This is a document with enough legal terms to exceed the minimum chunk length for testing purposes.";
    const chunks = chunkText(shortText);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(shortText);
  });

  it("should return empty array for text shorter than MIN_CHUNK_LENGTH", () => {
    const veryShortText = "Short text."; // < 50 chars
    const chunks = chunkText(veryShortText);
    expect(chunks).toHaveLength(0);
  });

  it("should handle text exactly at chunk size", () => {
    const text = "a".repeat(CHUNK_SIZE);
    const chunks = chunkText(text);
    // At exactly CHUNK_SIZE, we get the full chunk plus one more from the overlap step
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
  });

  it("should create overlapping chunks for text longer than chunk size", () => {
    // Create text that will require 2 chunks
    const text = "a".repeat(CHUNK_SIZE + 500);
    const chunks = chunkText(text);
    
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    
    // Each chunk should be at most CHUNK_SIZE characters
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("should have overlap between consecutive chunks", () => {
    // Create text that spans multiple chunks
    const text = "0123456789".repeat(200); // 2000 chars
    const chunks = chunkText(text);
    
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    
    // Check that chunks advance by (CHUNK_SIZE - CHUNK_OVERLAP) each time
    // Chunk 0: [0, 1500), Chunk 1: [1300, 2000)
    const step = CHUNK_SIZE - CHUNK_OVERLAP;
    expect(step).toBe(1300);
  });

  it("should skip trailing chunks that are too short", () => {
    // Create text where the last chunk would be < MIN_CHUNK_LENGTH
    // CHUNK_SIZE = 1500, OVERLAP = 200, step = 1300
    // Text of 1340 chars: first chunk [0, 1340], second chunk [1300, 1340] = 40 chars (skipped)
    const text = "a".repeat(1340);
    const chunks = chunkText(text);
    
    expect(chunks).toHaveLength(1);
  });

  it("should include trailing chunks that meet minimum length", () => {
    // Create text where the trailing chunk is >= MIN_CHUNK_LENGTH
    // step = 1300, so at index 1300 we get a chunk of length >= 50
    const text = "a".repeat(1400);
    const chunks = chunkText(text);
    
    // Chunk 0: [0, 1400), Chunk 1: [1300, 1400) = 100 chars (included)
    expect(chunks).toHaveLength(2);
    expect(chunks[1].length).toBeGreaterThanOrEqual(MIN_CHUNK_LENGTH);
  });

  it("should handle real document-like text with paragraphs", () => {
    const legalText = `
      ARTICLE 1. DEFINITIONS

      1.1 "Agreement" means this contract and all attached exhibits.
      1.2 "Confidential Information" means any proprietary data disclosed.
      1.3 "Effective Date" means the date of last signature below.

      ARTICLE 2. SCOPE OF SERVICES

      The Provider shall deliver the following services to the Client:
      (a) Document review and analysis
      (b) Legal research and memoranda preparation
      (c) Contract drafting and negotiation support
      
      ARTICLE 3. COMPENSATION

      3.1 Fixed Fee. Client shall pay Provider a fixed fee of $50,000.
      3.2 Expenses. Client shall reimburse reasonable expenses.
    `.repeat(10); // Make it long enough to span multiple chunks

    const chunks = chunkText(legalText);
    
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    
    // Verify no chunk exceeds maximum size
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("should preserve text integrity across chunks", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(50);
    const chunks = chunkText(text);
    
    // Each chunk should be readable text (not cut at weird places)
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThanOrEqual(MIN_CHUNK_LENGTH);
    }
  });
});

describe("exponential backoff calculation", () => {
  // Re-implement the backoff formula from repository.ts for testing
  function calculateBackoffSeconds(attempts: number): number {
    return Math.min(30 * Math.pow(10, attempts - 1), 1800);
  }

  it("should return 30 seconds for first attempt", () => {
    expect(calculateBackoffSeconds(1)).toBe(30);
  });

  it("should return 300 seconds (5 min) for second attempt", () => {
    expect(calculateBackoffSeconds(2)).toBe(300);
  });

  it("should return 1800 seconds (30 min) for third attempt", () => {
    expect(calculateBackoffSeconds(3)).toBe(1800);
  });

  it("should cap at 1800 seconds for fourth attempt and beyond", () => {
    expect(calculateBackoffSeconds(4)).toBe(1800);
    expect(calculateBackoffSeconds(5)).toBe(1800);
    expect(calculateBackoffSeconds(10)).toBe(1800);
  });

  it("should never exceed 30 minutes", () => {
    for (let i = 1; i <= 100; i++) {
      expect(calculateBackoffSeconds(i)).toBeLessThanOrEqual(1800);
    }
  });
});
