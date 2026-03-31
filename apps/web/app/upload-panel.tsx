"use client";

import type { Matter } from "@legal-agent/shared";
import { useState, useTransition } from "react";
import { uploadDocument } from "../lib/api";

export function UploadPanel({
  matters,
  onUploaded
}: {
  matters: Matter[];
  onUploaded: () => Promise<void> | void;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("Upload a document or paste normalized text for ingestion.");

  return (
    <div className="panel">
      <div className="eyebrow">Ingestion</div>
      <form
        className="list"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);

          startTransition(async () => {
            try {
              const result = await uploadDocument(formData);
              setMessage(`Queued ${result.sourceName} with status ${result.ingestionStatus}.`);
              form.reset();
              await onUploaded();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Upload failed.");
            }
          });
        }}
      >
        <label>
          <div className="muted">Matter</div>
          <select className="textarea" name="matterId" defaultValue={matters[0]?.id}>
            {matters.map((matter) => (
              <option value={matter.id} key={matter.id}>
                {matter.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div className="muted">Document type</div>
          <input className="textarea" name="docType" defaultValue="Share Purchase Agreement" />
        </label>

        <label>
          <div className="muted">Optional normalized text</div>
          <textarea
            className="textarea"
            name="normalizedText"
            placeholder="Paste OCR text here if you already have it."
          />
        </label>

        <label>
          <div className="muted">File</div>
          <input name="file" type="file" />
        </label>

        <div className="toolbar">
          <button className="button" type="submit">
            {isPending ? "Uploading..." : "Queue Upload"}
          </button>
        </div>
      </form>
      <p className="muted">{message}</p>
    </div>
  );
}
