"use client";

import { useState } from "react";

export interface MaskedSecretProps {
  label: string;
  value: string;
  copyLabel?: string;
  defaultHidden?: boolean;
}

export function MaskedSecret({ 
  label, 
  value, 
  copyLabel = "Copy",
  defaultHidden = true 
}: MaskedSecretProps) {
  const [isVisible, setIsVisible] = useState(!defaultHidden);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      // Show user feedback instead of using deprecated execCommand
      alert("Unable to copy automatically. Please select and copy manually.");
    }
  };

  const maskedValue = isVisible ? value : "•".repeat(Math.min(value.length, 32));

  return (
    <div className="masked-secret">
      <span className="masked-secret-label">{label}: </span>
      <code className="masked-secret-value">{maskedValue}</code>
      <div className="masked-secret-actions">
        <button 
          type="button"
          className="button small secondary" 
          onClick={() => setIsVisible(!isVisible)}
        >
          {isVisible ? "Hide" : "Show"}
        </button>
        <button 
          type="button"
          className="button small secondary" 
          onClick={handleCopy}
        >
          {copied ? "Copied!" : copyLabel}
        </button>
      </div>
    </div>
  );
}
