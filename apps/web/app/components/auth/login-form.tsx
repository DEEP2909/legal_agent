"use client";

import { useState } from "react";

export interface LoginFormProps {
  tenantId: string;
  error: string | null;
  isPending: boolean;
  onTenantIdChange: (tenantId: string) => void;
  onSubmit: (email: string, password: string) => void;
  onUsePasskey: (email: string) => void;
  onForgotPassword: () => void;
  onAcceptInvite: () => void;
}

export function LoginForm({
  tenantId,
  error,
  isPending,
  onTenantIdChange,
  onForgotPassword,
  onAcceptInvite,
  onSubmit,
  onUsePasskey
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function validateForm(): boolean {
    const errors: string[] = [];
    
    if (!email.trim()) {
      errors.push("Email is required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Please enter a valid email address");
    }
    
    if (!password) {
      errors.push("Password is required");
    } else if (password.length < 12) {
      errors.push("Password must be at least 12 characters");
    }
    
    setValidationErrors(errors);
    return errors.length === 0;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (validateForm()) {
      onSubmit(email, password);
    }
  }

  return (
    <form className="list" onSubmit={handleSubmit}>
      <input
        className="textarea"
        placeholder="Tenant ID"
        value={tenantId}
        onChange={(event) => onTenantIdChange(event.target.value)}
        maxLength={100}
      />
      <input 
        className="textarea" 
        type="email"
        placeholder="Email address"
        value={email} 
        onChange={(event) => setEmail(event.target.value)}
        required
        maxLength={255}
      />
      <input
        className="textarea"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={12}
        maxLength={128}
      />
      <div className="toolbar">
        <button className="button" type="submit" disabled={isPending}>
          {isPending ? "Signing in..." : "Sign In"}
        </button>
        <button className="button secondary" type="button" onClick={() => onUsePasskey(email)} disabled={!email}>
          Use Passkey
        </button>
        <button className="button secondary" type="button" onClick={onForgotPassword}>
          Forgot Password
        </button>
        <button className="button secondary" type="button" onClick={onAcceptInvite}>
          Accept Invite
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
