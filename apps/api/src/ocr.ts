import OpenAI from "openai";
import { extractText } from "unpdf";
import { config } from "./config.js";
import { readStoredObject } from "./storage.js";

const client = config.openAiApiKey ? new OpenAI({ apiKey: config.openAiApiKey }) : null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOpenAiImageOcr(buffer: Buffer, mimeType: string) {
  if (!client) {
    throw new Error("OPENAI_API_KEY is required for OCR_PROVIDER=openai.");
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
    const resultResponse = await fetch(operationLocation, {
      headers: {
        "Ocp-Apim-Subscription-Key": config.azureDocumentIntelligenceKey
      }
    });

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

export async function extractTextForIngestion(storagePath: string, mimeType: string) {
  const buffer = await readStoredObject(storagePath);

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return buffer.toString("utf8");
  }

  if (mimeType === "application/pdf") {
    const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
    if (text.trim()) {
      return text;
    }

    // Scanned PDF — fall back to OCR provider
    if (["azure_document_intelligence", "hybrid"].includes(config.ocrProvider)) {
      return runAzureDocumentIntelligenceOcr(buffer, mimeType);
    }

    // For openai provider, use vision OCR on scanned PDFs
    if (config.ocrProvider === "openai") {
      return runOpenAiImageOcr(buffer, mimeType);
    }
  }

  if (mimeType.startsWith("image/")) {
    return runVisionOcr(buffer, mimeType);
  }

  throw new Error(
    `No OCR extractor is configured for mime type ${mimeType}. Provide normalizedText directly or upload a digital PDF/image.`
  );
}
