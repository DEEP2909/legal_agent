"use client";

import { useState } from "react";
import { validatePassword } from "../../../lib/helpers";

export interface InvitationAcceptFormProps {
  defaultToken: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (token: string, password: string, fullName?: string) => void;
}

export function InvitationAcceptForm({
  defaultToken,
  error,
  isPending,
  onBack,
  onSubmit
}: InvitationAcceptFormProps) {
  const [token, setToken] = useState(defaultToken);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors = validatePassword(password);
    
    if (password !== confirmPassword) {
      errors.push("Passwords do not match");
    }
    
    if (fullName && fullName.length < 2) {
      errors.push("Full name must be at least 2 characters");
    }
    
    setValidationErrors(errors);
    if (errors.length === 0) {
      onSubmit(token, password, fullName || undefined);
    }
  }

  return (
    <form className="list" onSubmit={handleSubmit}>
      <input 
        className="textarea" 
        placeholder="Invitation token"
        value={token} 
        onChange={(event) => setToken(event.target.value)}
        required
      />
      <input
        className="textarea"
        placeholder="Full name"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        maxLength={200}
      />
      <input
        className="textarea"
        type="password"
        placeholder="Password (min 12 chars, uppercase, lowercase, number, special)"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={12}
        maxLength={128}
      />
      <input
        className="textarea"
        type="password"
        placeholder="Confirm password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        required
      />
      <div className="toolbar">
        <button className="button" type="submit" disabled={isPending}>
          {isPending ? "Accepting..." : "Accept Invitation"}
        </button>
        <button className="button secondary" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      {validationErrors.length > 0 && (
        <div className="validation-errors">
          {validationErrors.map((err, i) => (
            <p key={i} className="muted error">{err}</p>
          ))}
        </div>
      )}
      {error ? <p className="muted error">{error}</p> : null}
    </form>
  );
}
