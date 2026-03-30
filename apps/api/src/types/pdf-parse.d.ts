declare module "pdf-parse" {
  export default function pdfParse(
    dataBuffer: Buffer
  ): Promise<{
    text: string;
    numpages: number;
    numrender: number;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    version?: string;
  }>;
}
