"use client";

import type { MfaSetupResponse, MfaStatus, PasskeySummary } from "@legal-agent/shared";
import { startRegistration } from "@simplewebauthn/browser";
import { useState, useTransition } from "react";
import {
  beginMfaEnrollment,
  beginPasskeyRegistration,
  confirmMfaEnrollment,
  deletePasskey,
  disableMfa,
  finishPasskeyRegistration
} from "../../../lib/api";
import { MaskedSecret } from "../shared/masked-secret";

export interface SecurityPanelProps {
  mfaStatus: MfaStatus;
  mfaSetup: MfaSetupResponse | null;
  passkeys: PasskeySummary[];
  onRefresh: () => Promise<void>;
  onSetupChange: (setup: MfaSetupResponse | null) => void;
}

export function SecurityPanel({
  mfaStatus,
  mfaSetup,
  passkeys,
  onRefresh,
  onSetupChange
}: SecurityPanelProps) {
  const [setupCode, setSetupCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableRecoveryCode, setDisableRecoveryCode] = useState("");
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="panel">
      <div className="eyebrow">Security</div>
      <div className="list">
        <div className="item">
          <h3>Multi-factor authentication</h3>
          <p className="muted">
            Status: {mfaStatus.enabled ? "enabled" : "disabled"}.
            {" "}TOTP: {mfaStatus.totpEnabled ? "enabled" : "disabled"}.
            {" "}Passkeys: {mfaStatus.passkeyCount}.
            {" "}Recovery codes remaining: {mfaStatus.recoveryCodesRemaining}.
          </p>
          {!mfaStatus.enabled ? (
            <div className="toolbar">
              <button
                className="button"
                onClick={() =>
                  startTransition(async () => {
                    const setup = await beginMfaEnrollment();
                    onSetupChange(setup);
                    setMessage("Scan the OTP URI or copy the secret, then confirm with a current code.");
                  })
                }
              >
                {isPending ? "Preparing..." : "Set Up MFA"}
              </button>
            </div>
          ) : null}
          {mfaSetup ? (
            <div className="list">
              <MaskedSecret 
                label="Secret" 
                value={mfaSetup.secretBase32} 
                copyLabel="Copy Secret"
              />
              <MaskedSecret 
                label="OTP URI" 
                value={mfaSetup.otpAuthUrl} 
                copyLabel="Copy OTP URI"
              />
              <div className="sensitive-data-warning">
                <strong>⚠️ Recovery Codes - Save these securely!</strong>
                <p className="muted">These codes can only be viewed once. Store them in a safe place.</p>
              </div>
              <MaskedSecret 
                label="Recovery Codes" 
                value={mfaSetup.recoveryCodes.join(", ")} 
                copyLabel="Copy Codes"
                defaultHidden={false}
              />
              <input
                className="textarea"
                placeholder="Authenticator code"
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                maxLength={10}
                aria-label="Authenticator code"
              />
              <div className="toolbar">
                <button
                  className="button"
                  onClick={() =>
                    startTransition(async () => {
                      await confirmMfaEnrollment(setupCode);
                      onSetupChange(null);
                      setSetupCode("");
                      setMessage("MFA enabled.");
                      await onRefresh();
                    })
                  }
                >
                  Confirm MFA
                </button>
                <button className="button secondary" onClick={() => onSetupChange(null)}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
          {mfaStatus.enabled ? (
            <div className="list">
              <input
                className="textarea"
                placeholder="Current authenticator code"
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value)}
                aria-label="Current authenticator code"
              />
              <input
                className="textarea"
                placeholder="Or recovery code"
                value={disableRecoveryCode}
                onChange={(event) => setDisableRecoveryCode(event.target.value)}
                aria-label="Recovery code"
              />
              <div className="toolbar">
                <button
                  className="button secondary"
                  onClick={() =>
                    startTransition(async () => {
                      await disableMfa({
                        token: disableCode || undefined,
                        recoveryCode: disableRecoveryCode || undefined
                      });
                      setDisableCode("");
                      setDisableRecoveryCode("");
                      setMessage("MFA disabled.");
                      await onRefresh();
                    })
                  }
                >
                  Disable MFA
                </button>
              </div>
            </div>
          ) : null}
          <div className="list">
            <h3>Passkeys</h3>
            <p className="muted">
              Register a WebAuthn passkey for stronger MFA and smoother SSO step-up.
            </p>
            <input
              className="textarea"
              placeholder="Optional device label"
              value={passkeyLabel}
              onChange={(event) => setPasskeyLabel(event.target.value)}
              aria-label="Device label"
            />
            <div className="toolbar">
              <button
                className="button"
                onClick={() =>
                  startTransition(async () => {
                    const options = await beginPasskeyRegistration({
                      label: passkeyLabel || undefined
                    });
                    const credential = await startRegistration({
                      optionsJSON:
                        options.options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"]
                    });
                    await finishPasskeyRegistration({
                      challengeId: options.challengeId,
                      response: credential as unknown as Record<string, unknown>,
                      label: passkeyLabel || undefined
                    });
                    setPasskeyLabel("");
                    setMessage("Passkey registered.");
                    await onRefresh();
                  })
                }
              >
                {isPending ? "Registering..." : "Register Passkey"}
              </button>
            </div>
            <div className="list">
              {passkeys.length > 0 ? (
                passkeys.map((passkey) => (
                  <div className="item" key={passkey.id}>
                    <strong>{passkey.label || "Unnamed passkey"}</strong>
                    <p className="muted">
                      {passkey.deviceType} | backed up: {passkey.backedUp ? "yes" : "no"} | transports:{" "}
                      {passkey.transports.join(", ") || "not reported"}
                    </p>
                    <div className="toolbar">
                      <button
                        className="button secondary"
                        onClick={() =>
                          startTransition(async () => {
                            await deletePasskey(passkey.id);
                            setMessage("Passkey removed.");
                            await onRefresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No passkeys registered yet.</p>
              )}
            </div>
          </div>
          {message ? <p className="muted">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
