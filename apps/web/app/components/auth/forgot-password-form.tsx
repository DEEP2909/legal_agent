"use client";

import { useState } from "react";

export interface ForgotPasswordFormProps {
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (email: string) => void;
}

export function ForgotPasswordForm({
  error,
  isPending,
  onBack,
  onSubmit
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState("");

  return (
    <form
      className="list"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(email);
      }}
    >
      <label htmlFor="forgot-password-email">
        <span className="muted">Email address</span>
      </label>
      <input
        id="forgot-password-email"
        className="textarea"
        type="email"
        value={email}
        placeholder="attorney@firm.example"
        onChange={(event) => setEmail(event.target.value)}
        required
        aria-describedby="forgot-password-help"
      />
      <p id="forgot-password-help" className="muted">
        Enter your email to receive a password reset link.
      </p>
      <div className="toolbar">
        <button className="button" type="submit" disabled={isPending || !email.trim()}>
          {isPending ? "Submitting..." : "Request Reset"}
        </button>
        <button className="button secondary" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
    </form>
  );
}
