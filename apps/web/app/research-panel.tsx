"use client";

import { useState, useTransition } from "react";
import { runResearch } from "../lib/api";

export function ResearchPanel({ token }: { token: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(
    "Ask a research question to generate a grounded answer using the current matter corpus."
  );
  const [citations, setCitations] = useState<Array<{ title: string; citation: string }>>([]);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="panel">
      <div className="eyebrow">Research assistant</div>
      <textarea
        className="textarea"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="What are the main negotiation risks in this SPA for an Indian domestic acquisition?"
        aria-label="Research question"
      />
      <div className="toolbar">
        <button
          className="button"
          disabled={isPending || !question.trim()}
          onClick={() =>
            startTransition(async () => {
              const response = await runResearch(question, token);
              setAnswer(response.answer);
              setCitations(
                response.citations.map((citation) => ({
                  title: citation.title,
                  citation: citation.citation
                }))
              );
            })
          }
        >
          {isPending ? "Researching..." : "Run Research"}
        </button>
      </div>
      <div className="research-answer">
        {isPending ? (
          <p className="muted">Searching for relevant information...</p>
        ) : (
          <p>{answer}</p>
        )}
      </div>
      {citations.length > 0 ? (
        <div className="list">
          {citations.map((citation, index) => (
            <div key={`citation-${index}`} className="item">
              <strong>{citation.title}</strong>
              <p className="muted">{citation.citation}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
