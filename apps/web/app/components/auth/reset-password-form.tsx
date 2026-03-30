"use client";

import { useState } from "react";
import { validatePassword } from "../../../lib/helpers";

export interface ResetPasswordFormProps {
  defaultToken: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (token: string, password: string) => void;
}

export function ResetPasswordForm({
  defaultToken,
  error,
  isPending,
  onBack,
  onSubmit
}: ResetPasswordFormProps) {
  const [token, setToken] = useState(defaultToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors = validatePassword(password);
    
    if (password !== confirmPassword) {
      errors.push("Passwords do not match");
    }
    
    setValidationErrors(errors);
    if (errors.length === 0) {
      onSubmit(token, password);
    }
  }

  return (
    <form className="list" onSubmit={handleSubmit}>
      <input 
        className="textarea" 
        placeholder="Reset token"
        value={token} 
        onChange={(event) => setToken(event.target.value)}
        required
      />
      <input
        className="textarea"
        type="password"
        placeholder="New password (min 12 chars, uppercase, lowercase, number, special)"
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
          {isPending ? "Updating..." : "Set New Password"}
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
