import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config.js";

const s3Client =
  config.storageBackend === "s3"
    ? new S3Client({
        region: config.s3Region,
        endpoint: config.s3Endpoint || undefined,
        credentials:
          config.s3AccessKey && config.s3SecretKey
            ? {
                accessKeyId: config.s3AccessKey,
                secretAccessKey: config.s3SecretKey
              }
            : undefined,
        forcePathStyle: Boolean(config.s3Endpoint)
      })
    : null;

const ALLOWED_PREFIXES = ["uploads", "quarantine"] as const;

async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function validateStoragePath(absolutePath: string) {
  const resolvedBase = resolve(config.fileStorageDir);
  const resolvedPath = resolve(absolutePath);
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error("Path traversal attempt detected");
  }
  return resolvedPath;
}

export async function ensureDirectories() {
  if (config.storageBackend === "local") {
    await mkdir(config.fileStorageDir, { recursive: true });
    await mkdir(join(config.fileStorageDir, "uploads"), { recursive: true });
    await mkdir(join(config.fileStorageDir, "quarantine"), { recursive: true });
  }
}

export async function persistUpload(input: {
  originalName: string;
  buffer: Buffer;
  mimeType: string;
  prefix?: "uploads" | "quarantine";
}): Promise<{ storagePath: string }> {
  // Sanitize filename - remove path traversal characters and other dangerous chars
  const safeName = input.originalName
    .replace(/\x00/g, "") // Remove null bytes
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 255); // Limit length
  
  const prefix = input.prefix ?? "uploads";
  
  // Runtime validation of prefix (defense in depth)
  if (!ALLOWED_PREFIXES.includes(prefix)) {
    throw new Error("Invalid storage prefix");
  }
  
  const key = `${prefix}/${randomUUID()}-${safeName}`;

  if (config.storageBackend === "s3") {
    if (!s3Client || !config.s3Bucket) {
      throw new Error("S3 storage is enabled but S3 client configuration is incomplete.");
    }

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType
      })
    );

    return { storagePath: key };
  }

  const absolutePath = join(config.fileStorageDir, key);
  // Validate the path is within storage directory (prevent path traversal)
  validateStoragePath(absolutePath);
  
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.buffer);
  return { storagePath: absolutePath };
}

export async function readStoredObject(storagePath: string) {
  if (config.storageBackend === "s3") {
    if (!s3Client || !config.s3Bucket) {
      throw new Error("S3 storage is enabled but S3 client configuration is incomplete.");
    }

    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: storagePath
      })
    );

    if (!response.Body || !(response.Body instanceof Readable)) {
      throw new Error("Unable to read stored object from S3.");
    }

    return streamToBuffer(response.Body);
  }

  // Validate the path is within storage directory (prevent path traversal)
  validateStoragePath(storagePath);
  return readFile(storagePath);
}

export async function moveStoredObject(input: { fromPath: string; toPath: string }) {
  if (input.fromPath === input.toPath) {
    return { storagePath: input.toPath };
  }

  if (config.storageBackend === "s3") {
    if (!s3Client || !config.s3Bucket) {
      throw new Error("S3 storage is enabled but S3 client configuration is incomplete.");
    }

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: config.s3Bucket,
        CopySource: `${config.s3Bucket}/${input.fromPath}`,
        Key: input.toPath
      })
    );
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.s3Bucket,
        Key: input.fromPath
      })
    );

    return { storagePath: input.toPath };
  }

  await mkdir(dirname(input.toPath), { recursive: true });
  try {
    await rename(input.fromPath, input.toPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      // Cross-filesystem move: copy then delete
      await copyFile(input.fromPath, input.toPath);
      await unlink(input.fromPath);
    } else {
      throw err;
    }
  }
  return { storagePath: input.toPath };
}

export async function checkStorageHealth() {
  if (config.storageBackend === "s3") {
    if (!s3Client || !config.s3Bucket) {
      throw new Error("S3 storage is enabled but S3 client configuration is incomplete.");
    }

    await s3Client.send(
      new HeadBucketCommand({
        Bucket: config.s3Bucket
      })
    );
    return { backend: "s3", bucket: config.s3Bucket };
  }

  await mkdir(config.fileStorageDir, { recursive: true });
  return { backend: "local", path: config.fileStorageDir };
}
