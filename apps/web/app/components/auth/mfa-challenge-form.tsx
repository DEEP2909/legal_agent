"use client";

import type { MfaMethod } from "@legal-agent/shared";
import { useState } from "react";

export interface MfaChallengeFormProps {
  availableMethods: MfaMethod[];
  challengeToken: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onUsePasskey: () => void;
  onSubmit: (token: string, recoveryCode: string) => void;
}

export function MfaChallengeForm({
  availableMethods,
  challengeToken,
  error,
  isPending,
  onBack,
  onUsePasskey,
  onSubmit
}: MfaChallengeFormProps) {
  const [token, setToken] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  return (
    <form
      className="list"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(token, recoveryCode);
      }}
    >
      {availableMethods.includes("totp") ? (
        <input
          className="textarea"
          placeholder="Authenticator code"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      ) : null}
      {availableMethods.includes("recovery_code") ? (
        <input
          className="textarea"
          placeholder="Or recovery code"
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
        />
      ) : null}
      <div className="toolbar">
        {availableMethods.some((method) => method === "totp" || method === "recovery_code") ? (
          <button className="button" type="submit">
            {isPending ? "Verifying..." : "Verify MFA"}
          </button>
        ) : null}
        {availableMethods.includes("webauthn") ? (
          <button className="button secondary" type="button" onClick={onUsePasskey}>
            {isPending ? "Waiting..." : "Use Passkey"}
          </button>
        ) : null}
        <button className="button secondary" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
    </form>
  );
}
