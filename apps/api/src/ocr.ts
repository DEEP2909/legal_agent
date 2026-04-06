import OpenAI from "openai";
import { extractText } from "unpdf";
import { config } from "./config.js";
import { readStoredObject } from "./storage.js";

const client = config.openAiApiKey ? new OpenAI({ apiKey: config.openAiApiKey }) : null;

// Maximum file size for OpenAI Vision API (18MB with headroom for base64 overhead)
const MAX_VISION_BYTES = 18 * 1024 * 1024;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOpenAiImageOcr(buffer: Buffer, mimeType: string) {
  if (!client) {
    throw new Error("OPENAI_API_KEY is required for OCR_PROVIDER=openai.");
  }

  if (buffer.length > MAX_VISION_BYTES) {
    throw new Error(
      `File too large for Vision OCR (${buffer.length} bytes). ` +
      `Use Azure Document Intelligence for large files.`
    );
  }

  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const response = await client.responses.create({
    model: config.openAiModel,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract the text exactly as it appears in this legal document image. Preserve headings and clause boundaries where possible."
          },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "high"
          }
        ]
      }
    ]
  });

  return response.output_text;
}

async function runAzureDocumentIntelligenceOcr(buffer: Buffer, mimeType: string) {
  if (!config.azureDocumentIntelligenceEndpoint || !config.azureDocumentIntelligenceKey) {
    throw new Error("Azure Document Intelligence is not configured.");
  }

  const endpoint = config.azureDocumentIntelligenceEndpoint.replace(/\/+$/, "");
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(config.azureDocumentIntelligenceModel)}:analyze?api-version=${encodeURIComponent(config.azureDocumentIntelligenceApiVersion)}`;
  const analyzeResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Ocp-Apim-Subscription-Key": config.azureDocumentIntelligenceKey
    },
    body: new Uint8Array(buffer)
  });

  if (!analyzeResponse.ok) {
    throw new Error("Azure Document Intelligence analyze request failed.");
  }

  const operationLocation = analyzeResponse.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Azure Document Intelligence did not return an operation-location header.");
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1500);
    
    // Add timeout to prevent indefinite hangs
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    
    let resultResponse: Response;
    try {
      resultResponse = await fetch(operationLocation, {
        signal: controller.signal,
        headers: {
          "Ocp-Apim-Subscription-Key": config.azureDocumentIntelligenceKey
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resultResponse.ok) {
      throw new Error("Azure Document Intelligence result polling failed.");
    }

    const payload = (await resultResponse.json()) as {
      status?: string;
      analyzeResult?: {
        content?: string;
        pages?: Array<{
          lines?: Array<{ content?: string }>;
        }>;
      };
    };

    const status = String(payload.status ?? "").toLowerCase();
    if (status === "succeeded") {
      const content = payload.analyzeResult?.content?.trim();
      if (content) {
        return content;
      }

      const lines =
        payload.analyzeResult?.pages
          ?.flatMap((page) => page.lines ?? [])
          .map((line) => line.content?.trim() ?? "")
          .filter(Boolean) ?? [];

      return lines.join("\n");
    }

    if (status === "failed") {
      throw new Error("Azure Document Intelligence OCR failed.");
    }
  }

  throw new Error("Azure Document Intelligence OCR timed out.");
}

async function runVisionOcr(buffer: Buffer, mimeType: string) {
  if (config.ocrProvider === "azure_document_intelligence") {
    return runAzureDocumentIntelligenceOcr(buffer, mimeType);
  }

  if (config.ocrProvider === "hybrid") {
    try {
      return await runAzureDocumentIntelligenceOcr(buffer, mimeType);
    } catch {
      return runOpenAiImageOcr(buffer, mimeType);
    }
  }

  return runOpenAiImageOcr(buffer, mimeType);
}

export interface ExtractionResult {
  text: string;
  pageCount: number | null;
}

export async function extractTextForIngestion(storagePath: string, mimeType: string): Promise<ExtractionResult> {
  const buffer = await readStoredObject(storagePath);

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return { text: buffer.toString("utf8"), pageCount: null };
  }

  if (mimeType === "application/pdf") {
    const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
    if (text.trim()) {
      return { text, pageCount: totalPages ?? null };
    }

    // Scanned PDF — fall back to OCR provider
    if (["azure_document_intelligence", "hybrid"].includes(config.ocrProvider)) {
      const ocrText = await runAzureDocumentIntelligenceOcr(buffer, mimeType);
      return { text: ocrText, pageCount: totalPages ?? null };
    }

    // For openai provider, use vision OCR on scanned PDFs
    if (config.ocrProvider === "openai") {
      const ocrText = await runOpenAiImageOcr(buffer, mimeType);
      return { text: ocrText, pageCount: totalPages ?? null };
    }
  }

  if (mimeType.startsWith("image/")) {
    const ocrText = await runVisionOcr(buffer, mimeType);
    return { text: ocrText, pageCount: 1 };
  }

  throw new Error(
    `No OCR extractor is configured for mime type ${mimeType}. Provide normalizedText directly or upload a digital PDF/image.`
  );
}
