"use client";

import type {
  ApiKeySummary,
  Attorney,
  AuthSession,
  DashboardSnapshot,
  InvitationSummary,
  MfaMethod,
  MfaSetupResponse,
  MfaStatus,
  PasskeySummary,
  ScimTokenSummary,
  SsoProviderSummary,
  Tenant
} from "@legal-agent/shared";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  acceptInvitation,
  beginMfaPasskeyAuthentication,
  beginMfaEnrollment,
  beginPasswordlessPasskeyLogin,
  beginPasskeyRegistration,
  confirmMfaEnrollment,
  createApiKey,
  createAttorney,
  createInvitation,
  createScimToken,
  deletePasskey,
  disableMfa,
  exchangeAuthCode,
  finishMfaPasskeyAuthentication,
  finishPasswordlessPasskeyLogin,
  finishPasskeyRegistration,
  forgotPassword,
  getDashboard,
  getMfaStatus,
  getMe,
  getPublicSsoProviders,
  getSsoStartUrl,
  getTenantAdmin,
  listPasskeys,
  login,
  resetPassword,
  startSamlLogout,
  updateTenant,
  upsertSsoProvider,
  verifyMfaChallenge
} from "../lib/api";
import { ResearchPanel } from "./research-panel";
import { UploadPanel } from "./upload-panel";

const storageKey = "legal-agent-access-token";

// Password validation helper
function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("Password must contain at least one uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("Password must contain at least one lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("Password must contain at least one number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Password must contain at least one special character");
  return errors;
}

// Component to safely display sensitive data with copy functionality
function MaskedSecret({ 
  label, 
  value, 
  copyLabel = "Copy",
  defaultHidden = true 
}: { 
  label: string; 
  value: string; 
  copyLabel?: string;
  defaultHidden?: boolean;
}) {
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

type AdminSnapshot = {
  tenant?: Tenant;
  attorneys: Attorney[];
  apiKeys: ApiKeySummary[];
  invitations: InvitationSummary[];
  ssoProviders: SsoProviderSummary[];
  scimTokens: ScimTokenSummary[];
};

type AuthView = "login" | "forgot" | "reset" | "invite" | "mfa";

function clearAuthQueryParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("authExchange");
  url.searchParams.delete("authError");
  url.searchParams.delete("loggedOut");
  url.searchParams.delete("mfaChallenge");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function DashboardApp() {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [adminSnapshot, setAdminSnapshot] = useState<AdminSnapshot | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetupResponse | null>(null);
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [mfaAvailableMethods, setMfaAvailableMethods] = useState<MfaMethod[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authView, setAuthView] = useState<AuthView>("login");
  const [resetToken, setResetToken] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [tenantIdForSso, setTenantIdForSso] = useState("tenant-demo");
  const [ssoProviders, setSsoProviders] = useState<SsoProviderSummary[]>([]);
  const [isPending, startTransition] = useTransition();

  async function refreshAll(activeToken: string) {
    const [me, dashboardData, mfaData, passkeyData] = await Promise.all([
      getMe(activeToken),
      getDashboard(activeToken),
      getMfaStatus(activeToken),
      listPasskeys(activeToken)
    ]);
    setSession(me);
    setDashboard(dashboardData);
    setMfaStatus(mfaData);
    setPasskeys(passkeyData);

    if (me.isTenantAdmin) {
      setAdminSnapshot(await getTenantAdmin(activeToken));
    } else {
      setAdminSnapshot(null);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteQueryToken = params.get("inviteToken");
    const resetQueryToken = params.get("resetToken");
    const tenantQueryId = params.get("tenantId");
    const authExchange = params.get("authExchange");
    const authError = params.get("authError");
    const loggedOut = params.get("loggedOut");
    const mfaChallenge = params.get("mfaChallenge");

    if (inviteQueryToken) {
      setInviteToken(inviteQueryToken);
      setAuthView("invite");
    } else if (resetQueryToken) {
      setResetToken(resetQueryToken);
      setAuthView("reset");
    }

    if (tenantQueryId) {
      setTenantIdForSso(tenantQueryId);
    }

    if (authError) {
      setError(authError);
      clearAuthQueryParams();
    }

    if (loggedOut) {
      setError("Signed out.");
      clearAuthQueryParams();
    }

    if (mfaChallenge) {
      setMfaChallengeToken(mfaChallenge);
      setMfaAvailableMethods(["totp", "recovery_code", "webauthn"]);
      setAuthView("mfa");
      clearAuthQueryParams();
    }

    if (authExchange) {
      void exchangeAuthCode(authExchange)
        .then(async (result) => {
          window.localStorage.setItem(storageKey, result.accessToken);
          setToken(result.accessToken);
          await refreshAll(result.accessToken);
          clearAuthQueryParams();
        })
        .catch((exchangeError) => {
          setError(exchangeError instanceof Error ? exchangeError.message : "SSO sign-in failed.");
          clearAuthQueryParams();
        });
      return;
    }

    const storedToken = window.localStorage.getItem(storageKey);
    if (!storedToken) {
      return;
    }

    setToken(storedToken);
    void refreshAll(storedToken).catch((loadError) => {
      window.localStorage.removeItem(storageKey);
      setToken(null);
      setMfaStatus(null);
      setMfaSetup(null);
      setPasskeys([]);
      setError(loadError instanceof Error ? loadError.message : "Session expired.");
    });
  }, []);

  useEffect(() => {
    void getPublicSsoProviders(tenantIdForSso)
      .then(setSsoProviders)
      .catch((error) => {
        console.error("Failed to fetch SSO providers:", error);
        setSsoProviders([]);
      });
  }, [tenantIdForSso]);

  if (!token || !dashboard || !session) {
    return (
      <main className="page-shell">
        <section className="hero">
          <div className="panel">
            <div className="eyebrow">Identity and access</div>
            <h1 className="hero-title">Legal workspace sign in</h1>
            <p className="muted">
              Attorney login, invitation acceptance, password reset, and SSO discovery all live
              here now.
            </p>

            {authView === "login" ? (
              <LoginForm
                tenantId={tenantIdForSso}
                isPending={isPending}
                error={error}
                onForgotPassword={() => setAuthView("forgot")}
                onAcceptInvite={() => setAuthView("invite")}
                onTenantIdChange={setTenantIdForSso}
                onUsePasskey={(email) =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      const options = await beginPasswordlessPasskeyLogin({
                        tenantId: tenantIdForSso,
                        email
                      });
                      const assertion = await startAuthentication({
                        optionsJSON:
                          options.options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"]
                      });
                      const result = await finishPasswordlessPasskeyLogin({
                        tenantId: tenantIdForSso,
                        email,
                        challengeId: options.challengeId,
                        response: assertion as unknown as Record<string, unknown>
                      });
                      window.localStorage.setItem(storageKey, result.accessToken);
                      setToken(result.accessToken);
                      await refreshAll(result.accessToken);
                    } catch (passkeyError) {
                      setError(
                        passkeyError instanceof Error ? passkeyError.message : "Passkey sign-in failed."
                      );
                    }
                  })
                }
                onSubmit={(email, password) =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      const result = await login(email, password, tenantIdForSso);
                      if (result.mfaRequired) {
                        setMfaChallengeToken(result.challengeToken);
                        setMfaAvailableMethods(result.availableMethods);
                        setAuthView("mfa");
                        return;
                      }
                      window.localStorage.setItem(storageKey, result.accessToken);
                      setToken(result.accessToken);
                      await refreshAll(result.accessToken);
                    } catch (loginError) {
                      setError(loginError instanceof Error ? loginError.message : "Login failed.");
                    }
                  })
                }
              />
            ) : null}

            {authView === "mfa" ? (
              <MfaChallengeForm
                challengeToken={mfaChallengeToken}
                availableMethods={mfaAvailableMethods}
                error={error}
                isPending={isPending}
                onBack={() => setAuthView("login")}
                onUsePasskey={() =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      const options = await beginMfaPasskeyAuthentication(mfaChallengeToken);
                      const assertion = await startAuthentication({
                        optionsJSON:
                          options.options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"]
                      });
                      const result = await finishMfaPasskeyAuthentication({
                        challengeToken: mfaChallengeToken,
                        challengeId: options.challengeId,
                        response: assertion as unknown as Record<string, unknown>
                      });
                      window.localStorage.setItem(storageKey, result.accessToken);
                      setToken(result.accessToken);
                      setAuthView("login");
                      setMfaChallengeToken("");
                      setMfaAvailableMethods([]);
                      await refreshAll(result.accessToken);
                    } catch (passkeyError) {
                      setError(
                        passkeyError instanceof Error ? passkeyError.message : "Passkey verification failed."
                      );
                    }
                  })
                }
                onSubmit={(tokenValue, recoveryCode) =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      const result = await verifyMfaChallenge({
                        challengeToken: mfaChallengeToken,
                        token: tokenValue || undefined,
                        recoveryCode: recoveryCode || undefined
                      });
                      window.localStorage.setItem(storageKey, result.accessToken);
                      setToken(result.accessToken);
                      setAuthView("login");
                      setMfaChallengeToken("");
                      setMfaAvailableMethods([]);
                      await refreshAll(result.accessToken);
                    } catch (mfaError) {
                      setError(mfaError instanceof Error ? mfaError.message : "MFA verification failed.");
                    }
                  })
                }
              />
            ) : null}

            {authView === "forgot" ? (
              <ForgotPasswordForm
                error={error}
                isPending={isPending}
                onBack={() => setAuthView("login")}
                onSubmit={(email) =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      const result = await forgotPassword(email);
                      setError(
                        result.resetToken
                          ? `Reset token (dev mode): ${result.resetToken}`
                          : "If the email exists, a reset link has been issued."
                      );
                    } catch (forgotError) {
                      setError(
                        forgotError instanceof Error ? forgotError.message : "Reset request failed."
                      );
                    }
                  })
                }
              />
            ) : null}

            {authView === "reset" ? (
              <ResetPasswordForm
                defaultToken={resetToken}
                error={error}
                isPending={isPending}
                onBack={() => setAuthView("login")}
                onSubmit={(submittedToken, password) =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      await resetPassword(submittedToken, password);
                      setError("Password updated. Please sign in.");
                      setAuthView("login");
                    } catch (resetError) {
                      setError(resetError instanceof Error ? resetError.message : "Reset failed.");
                    }
                  })
                }
              />
            ) : null}

            {authView === "invite" ? (
              <InvitationAcceptForm
                defaultToken={inviteToken}
                error={error}
                isPending={isPending}
                onBack={() => setAuthView("login")}
                onSubmit={(submittedToken, password, fullName) =>
                  startTransition(async () => {
                    try {
                      setError(null);
                      const result = await acceptInvitation({
                        token: submittedToken,
                        password,
                        fullName
                      });
                      window.localStorage.setItem(storageKey, result.accessToken);
                      setToken(result.accessToken);
                      await refreshAll(result.accessToken);
                    } catch (inviteError) {
                      setError(
                        inviteError instanceof Error ? inviteError.message : "Invitation acceptance failed."
                      );
                    }
                  })
                }
              />
            ) : null}
          </div>
          <div className="panel">
            <div className="eyebrow">SSO</div>
            <p className="muted">
              Configure OIDC or SAML providers per tenant in the admin console. This screen now
              supports live tenant-specific discovery and redirect-based sign-in.
            </p>
            <input
              className="textarea"
              value={tenantIdForSso}
              onChange={(event) => setTenantIdForSso(event.target.value)}
            />
            <div className="list">
              {ssoProviders.length > 0 ? (
                ssoProviders.map((provider) => (
                  <div className="item" key={provider.id}>
                    <strong>{provider.displayName}</strong>
                    <p className="muted">
                      {provider.providerType.toUpperCase()} provider {provider.providerName} is
                      configured for tenant {tenantIdForSso}.
                    </p>
                    <div className="toolbar">
                      <a
                        className="button"
                        href={getSsoStartUrl({
                          tenantId: tenantIdForSso,
                          providerName: provider.providerName,
                          redirectPath: "/"
                        })}
                      >
                        Continue With {provider.displayName}
                      </a>
                    </div>
                  </div>
                ))
              ) : (
                <div className="item">
                  <p className="muted">No public SSO providers are enabled for this tenant yet.</p>
                </div>
              )}
            </div>
            <div className="item">
              <strong>Development Mode</strong>
              <p className="muted">Configure credentials via environment variables (DEMO_USER_EMAIL, DEMO_USER_PASSWORD).</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="panel">
          <div className="eyebrow">India-first legal workflow automation</div>
          <h1 className="hero-title">Matter intelligence for due diligence and contracts</h1>
          <p className="muted">
            Signed in as {session.fullName} ({session.role}) for tenant {dashboard.tenant?.name}.
          </p>
          <div className="toolbar">
            <button
              className="button secondary"
              onClick={async () => {
                const resetLocalSession = () => {
                  window.localStorage.removeItem(storageKey);
                  setToken(null);
                  setSession(null);
                  setDashboard(null);
                  setAdminSnapshot(null);
                  setMfaStatus(null);
                  setMfaSetup(null);
                  setMfaChallengeToken("");
                  setMfaAvailableMethods([]);
                  setPasskeys([]);
                  setAuthView("login");
                };

                if (session.federationProtocol === "saml" && session.identityProvider) {
                  try {
                    const result = await startSamlLogout(token, {
                      providerName: session.identityProvider,
                      redirectPath: "/"
                    });
                    resetLocalSession();
                    window.location.assign(result.logoutUrl);
                    return;
                  } catch {
                    resetLocalSession();
                    return;
                  }
                }

                resetLocalSession();
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="eyebrow">Operating signal</div>
          <div className="stats">
            <div className="stat">
              <span className="muted">Open matters</span>
              <strong>{dashboard.matters.length}</strong>
            </div>
            <div className="stat">
              <span className="muted">Documents</span>
              <strong>{dashboard.documents.length}</strong>
            </div>
            <div className="stat">
              <span className="muted">Open flags</span>
              <strong>{dashboard.flags.filter((flag) => flag.status === "open").length}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="stack">
          <div className="panel">
            <div className="eyebrow">Active matters</div>
            <div className="list">
              {dashboard.matters.map((matter) => (
                <article className="item" key={matter.id}>
                  <div className="pill">{matter.matterType}</div>
                  <h3>{matter.title}</h3>
                  <p className="muted">
                    {matter.clientName} - {matter.matterCode} - {matter.jurisdiction}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="eyebrow">Document review queue</div>
            <div className="list">
              {dashboard.documents.map((document) => (
                <article className="item" key={document.id}>
                  <div className="pill">{document.docType}</div>
                  <h3>{document.sourceName}</h3>
                  <p className="muted">
                    Status {document.ingestionStatus} - Relevance {Math.round(document.relevanceScore * 100)}% - Privilege{" "}
                    {Math.round(document.privilegeScore * 100)}%
                  </p>
                </article>
              ))}
            </div>
          </div>

          {session.isTenantAdmin && adminSnapshot ? (
            <AdminPanel
              token={token}
              snapshot={adminSnapshot}
              onRefresh={() => refreshAll(token)}
            />
          ) : null}

          {mfaStatus ? (
            <SecurityPanel
              token={token}
              mfaStatus={mfaStatus}
              mfaSetup={mfaSetup}
              passkeys={passkeys}
              onRefresh={async () => {
                setMfaStatus(await getMfaStatus(token));
                setPasskeys(await listPasskeys(token));
                await refreshAll(token);
              }}
              onSetupChange={setMfaSetup}
            />
          ) : null}
        </div>

        <div className="stack">
          <div className="panel">
            <div className="eyebrow">Critical flags</div>
            <div className="list">
              {dashboard.flags.map((flag) => (
                <article className="item" key={flag.id}>
                  <div className={`pill ${flag.severity}`}>{flag.severity}</div>
                  <h3>{flag.flagType}</h3>
                  <p className="muted">{flag.reason}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="eyebrow">Extracted clauses</div>
            <div className="list">
              {dashboard.clauses.map((clause) => (
                <article className="item" key={clause.id}>
                  <div className={`pill ${clause.riskLevel}`}>{clause.riskLevel} risk</div>
                  <h3>{clause.heading ?? clause.clauseType}</h3>
                  <p className="muted">{clause.textExcerpt}</p>
                </article>
              ))}
            </div>
          </div>

          <UploadPanel matters={dashboard.matters} token={token} onUploaded={() => refreshAll(token)} />
          <ResearchPanel token={token} />
        </div>
      </section>
    </main>
  );
}

function LoginForm({
  tenantId,
  error,
  isPending,
  onTenantIdChange,
  onForgotPassword,
  onAcceptInvite,
  onSubmit,
  onUsePasskey
}: {
  tenantId: string;
  error: string | null;
  isPending: boolean;
  onTenantIdChange: (tenantId: string) => void;
  onSubmit: (email: string, password: string) => void;
  onUsePasskey: (email: string) => void;
  onForgotPassword: () => void;
  onAcceptInvite: () => void;
}) {
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

function MfaChallengeForm({
  availableMethods,
  challengeToken,
  error,
  isPending,
  onBack,
  onUsePasskey,
  onSubmit
}: {
  availableMethods: MfaMethod[];
  challengeToken: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onUsePasskey: () => void;
  onSubmit: (token: string, recoveryCode: string) => void;
}) {
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

function ForgotPasswordForm({
  error,
  isPending,
  onBack,
  onSubmit
}: {
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (email: string) => void;
}) {
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

function SecurityPanel({
  token,
  mfaStatus,
  mfaSetup,
  passkeys,
  onRefresh,
  onSetupChange
}: {
  token: string;
  mfaStatus: MfaStatus;
  mfaSetup: MfaSetupResponse | null;
  passkeys: PasskeySummary[];
  onRefresh: () => Promise<void>;
  onSetupChange: (setup: MfaSetupResponse | null) => void;
}) {
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
                    const setup = await beginMfaEnrollment(token);
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
              />
              <div className="toolbar">
                <button
                  className="button"
                  onClick={() =>
                    startTransition(async () => {
                      await confirmMfaEnrollment(token, setupCode);
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
              />
              <input
                className="textarea"
                placeholder="Or recovery code"
                value={disableRecoveryCode}
                onChange={(event) => setDisableRecoveryCode(event.target.value)}
              />
              <div className="toolbar">
                <button
                  className="button secondary"
                  onClick={() =>
                    startTransition(async () => {
                      await disableMfa(token, {
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
            />
            <div className="toolbar">
              <button
                className="button"
                onClick={() =>
                  startTransition(async () => {
                    const options = await beginPasskeyRegistration(token, {
                      label: passkeyLabel || undefined
                    });
                    const credential = await startRegistration({
                      optionsJSON:
                        options.options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"]
                    });
                    await finishPasskeyRegistration(token, {
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
                            await deletePasskey(token, passkey.id);
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

function ResetPasswordForm({
  defaultToken,
  error,
  isPending,
  onBack,
  onSubmit
}: {
  defaultToken: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (token: string, password: string) => void;
}) {
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

function InvitationAcceptForm({
  defaultToken,
  error,
  isPending,
  onBack,
  onSubmit
}: {
  defaultToken: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (token: string, password: string, fullName?: string) => void;
}) {
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

function AdminPanel({
  token,
  snapshot,
  onRefresh
}: {
  token: string;
  snapshot: AdminSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const [tenantForm, setTenantForm] = useState({
    name: snapshot.tenant?.name ?? "",
    region: snapshot.tenant?.region ?? "IN",
    plan: snapshot.tenant?.plan ?? "growth"
  });
  const [attorneyForm, setAttorneyForm] = useState({
    email: "",
    fullName: "",
    role: "associate" as Attorney["role"],
    practiceArea: "Corporate",
    password: "",
    isTenantAdmin: false
  });
  const [attorneyFormErrors, setAttorneyFormErrors] = useState<string[]>([]);
  const [invitationForm, setInvitationForm] = useState({
    email: "",
    fullName: "",
    role: "associate" as Attorney["role"],
    practiceArea: "Corporate",
    isTenantAdmin: false
  });
  const [ssoForm, setSsoForm] = useState({
    providerType: snapshot.ssoProviders[0]?.providerType ?? ("oidc" as SsoProviderSummary["providerType"]),
    providerName: snapshot.ssoProviders[0]?.providerName ?? "google-workspace",
    displayName: snapshot.ssoProviders[0]?.displayName ?? "Google Workspace",
    clientId: snapshot.ssoProviders[0]?.clientId ?? "",
    clientSecret: "",
    issuerUrl: snapshot.ssoProviders[0]?.issuerUrl ?? "",
    jwksUri: snapshot.ssoProviders[0]?.jwksUri ?? "",
    authorizationEndpoint: snapshot.ssoProviders[0]?.authorizationEndpoint ?? "",
    tokenEndpoint: snapshot.ssoProviders[0]?.tokenEndpoint ?? "",
    userinfoEndpoint: snapshot.ssoProviders[0]?.userinfoEndpoint ?? "",
    entityId: snapshot.ssoProviders[0]?.entityId ?? "",
    ssoUrl: snapshot.ssoProviders[0]?.ssoUrl ?? "",
    sloUrl: snapshot.ssoProviders[0]?.sloUrl ?? "",
    x509Cert: snapshot.ssoProviders[0]?.x509Cert ?? "",
    nameIdFormat: snapshot.ssoProviders[0]?.nameIdFormat ?? "",
    scopes: snapshot.ssoProviders[0]?.scopes ?? "openid profile email",
    enabled: snapshot.ssoProviders[0]?.enabled ?? false
  });
  const [apiKeyForm, setApiKeyForm] = useState({
    attorneyId: snapshot.attorneys[0]?.id ?? "",
    name: "Integration Key",
    role: "admin" as Attorney["role"]
  });
  const [scimTokenForm, setScimTokenForm] = useState({
    name: "SCIM Provisioning"
  });
  const [newKey, setNewKey] = useState<string>("");
  const [newScimToken, setNewScimToken] = useState<string>("");
  const [newInvitationToken, setNewInvitationToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const samlMetadataUrl =
    ssoForm.providerType === "saml"
      ? `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/auth/sso/saml/metadata?tenantId=${encodeURIComponent(snapshot.tenant?.id ?? "")}&providerName=${encodeURIComponent(ssoForm.providerName)}`
      : null;
  const invitationLink = useMemo(
    () =>
      newInvitationToken
        ? `${typeof window !== "undefined" ? window.location.origin : ""}/?inviteToken=${encodeURIComponent(newInvitationToken)}`
        : null,
    [newInvitationToken]
  );

  return (
    <div className="panel">
      <div className="eyebrow">Tenant admin</div>
      <div className="list">
        <div className="item">
          <h3>Tenant settings</h3>
          <input
            className="textarea"
            value={tenantForm.name}
            onChange={(event) => setTenantForm((current) => ({ ...current, name: event.target.value }))}
          />
          <input
            className="textarea"
            value={tenantForm.region}
            onChange={(event) => setTenantForm((current) => ({ ...current, region: event.target.value }))}
          />
          <input
            className="textarea"
            value={tenantForm.plan}
            onChange={(event) => setTenantForm((current) => ({ ...current, plan: event.target.value }))}
          />
          <div className="toolbar">
            <button
              className="button"
              onClick={() =>
                startTransition(async () => {
                  await updateTenant(token, tenantForm);
                  await onRefresh();
                  setMessage("Tenant settings updated.");
                })
              }
            >
              {isPending ? "Saving..." : "Save Tenant"}
            </button>
          </div>
        </div>

        <div className="item">
          <h3>Attorneys</h3>
          {snapshot.attorneys.map((attorney) => (
            <p className="muted" key={attorney.id}>
              {attorney.fullName} - {attorney.email} - {attorney.role}
              {attorney.isTenantAdmin ? " - tenant admin" : ""}
            </p>
          ))}
          <div className="list">
            <input
              className="textarea"
              placeholder="Email"
              value={attorneyForm.email}
              onChange={(event) =>
                setAttorneyForm((current) => ({ ...current, email: event.target.value }))
              }
            />
            <input
              className="textarea"
              placeholder="Full name"
              value={attorneyForm.fullName}
              onChange={(event) =>
                setAttorneyForm((current) => ({ ...current, fullName: event.target.value }))
              }
            />
            <input
              className="textarea"
              placeholder="Practice area"
              value={attorneyForm.practiceArea}
              onChange={(event) =>
                setAttorneyForm((current) => ({ ...current, practiceArea: event.target.value }))
              }
            />
            <select
              className="textarea"
              value={attorneyForm.role}
              onChange={(event) =>
                setAttorneyForm((current) => ({
                  ...current,
                  role: event.target.value as Attorney["role"]
                }))
              }
            >
              <option value="associate">Associate</option>
              <option value="partner">Partner</option>
              <option value="paralegal">Paralegal</option>
              <option value="admin">Admin</option>
            </select>
            <input
              className="textarea"
              type="password"
              value={attorneyForm.password}
              onChange={(event) =>
                setAttorneyForm((current) => ({ ...current, password: event.target.value }))
              }
            />
            <label className="muted">
              <input
                type="checkbox"
                checked={attorneyForm.isTenantAdmin}
                onChange={(event) =>
                  setAttorneyForm((current) => ({
                    ...current,
                    isTenantAdmin: event.target.checked
                  }))
                }
              />{" "}
              Tenant admin
            </label>
            <div className="toolbar">
              <button
                className="button"
                onClick={() =>
                  startTransition(async () => {
                    await createAttorney(token, attorneyForm);
                    await onRefresh();
                    setMessage("Attorney created.");
                  })
                }
              >
                Add Attorney
              </button>
            </div>
          </div>
        </div>

        <div className="item">
          <h3>Invitations</h3>
          {snapshot.invitations.map((invitation) => (
            <p className="muted" key={invitation.id}>
              {invitation.email} - {invitation.role} - {invitation.status}
            </p>
          ))}
          <div className="list">
            <input
              className="textarea"
              placeholder="Invite email"
              value={invitationForm.email}
              onChange={(event) =>
                setInvitationForm((current) => ({ ...current, email: event.target.value }))
              }
            />
            <input
              className="textarea"
              placeholder="Full name"
              value={invitationForm.fullName}
              onChange={(event) =>
                setInvitationForm((current) => ({ ...current, fullName: event.target.value }))
              }
            />
            <input
              className="textarea"
              placeholder="Practice area"
              value={invitationForm.practiceArea}
              onChange={(event) =>
                setInvitationForm((current) => ({ ...current, practiceArea: event.target.value }))
              }
            />
            <select
              className="textarea"
              value={invitationForm.role}
              onChange={(event) =>
                setInvitationForm((current) => ({
                  ...current,
                  role: event.target.value as Attorney["role"]
                }))
              }
            >
              <option value="associate">Associate</option>
              <option value="partner">Partner</option>
              <option value="paralegal">Paralegal</option>
              <option value="admin">Admin</option>
            </select>
            <label className="muted">
              <input
                type="checkbox"
                checked={invitationForm.isTenantAdmin}
                onChange={(event) =>
                  setInvitationForm((current) => ({
                    ...current,
                    isTenantAdmin: event.target.checked
                  }))
                }
              />{" "}
              Tenant admin
            </label>
            <div className="toolbar">
              <button
                className="button"
                onClick={() =>
                  startTransition(async () => {
                    const result = await createInvitation(token, invitationForm);
                    setNewInvitationToken(result.rawToken ?? null);
                    await onRefresh();
                    setMessage("Invitation created.");
                  })
                }
              >
                Create Invitation
              </button>
            </div>
            {invitationLink ? (
              <div className="new-secret-container">
                <div className="sensitive-data-warning">
                  <strong>⚠️ Invitation Link - Share securely!</strong>
                  <p className="muted">Send this link to the invitee through a secure channel.</p>
                </div>
                <MaskedSecret label="Invite Link" value={invitationLink} copyLabel="Copy Link" defaultHidden={false} />
                <button className="button small secondary" onClick={() => setNewInvitationToken(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="item">
          <h3>API keys</h3>
          {snapshot.apiKeys.map((apiKey) => (
            <p className="muted" key={apiKey.id}>
              {apiKey.name} - {apiKey.keyPrefix} - {apiKey.role} - {apiKey.status}
            </p>
          ))}
          <select
            className="textarea"
            value={apiKeyForm.attorneyId}
            onChange={(event) =>
              setApiKeyForm((current) => ({ ...current, attorneyId: event.target.value }))
            }
          >
            {snapshot.attorneys.map((attorney) => (
              <option value={attorney.id} key={attorney.id}>
                {attorney.fullName}
              </option>
            ))}
          </select>
          <input
            className="textarea"
            value={apiKeyForm.name}
            onChange={(event) =>
              setApiKeyForm((current) => ({ ...current, name: event.target.value }))
            }
          />
          <select
            className="textarea"
            value={apiKeyForm.role}
            onChange={(event) =>
              setApiKeyForm((current) => ({
                ...current,
                role: event.target.value as Attorney["role"]
              }))
            }
          >
            <option value="admin">Admin</option>
            <option value="partner">Partner</option>
            <option value="associate">Associate</option>
            <option value="paralegal">Paralegal</option>
          </select>
          <div className="toolbar">
            <button
              className="button"
              onClick={() =>
                startTransition(async () => {
                  const result = await createApiKey(token, apiKeyForm);
                  setNewKey(result.rawKey);
                  await onRefresh();
                  setMessage("API key created.");
                })
              }
            >
              Create API Key
            </button>
          </div>
          {newKey ? (
            <div className="new-secret-container">
              <div className="sensitive-data-warning">
                <strong>⚠️ API Key - Copy now!</strong>
                <p className="muted">This key will only be shown once. Store it securely.</p>
              </div>
              <MaskedSecret label="API Key" value={newKey} copyLabel="Copy Key" defaultHidden={false} />
              <button className="button small secondary" onClick={() => setNewKey("")}>
                Dismiss
              </button>
            </div>
          ) : null}
        </div>

        <div className="item">
          <h3>SCIM provisioning</h3>
          <p className="muted">
            Use this bearer token with your IdP's SCIM connector against `/scim/v2/Users`.
          </p>
          {snapshot.scimTokens.map((scimToken) => (
            <p className="muted" key={scimToken.id}>
              {scimToken.name} - {scimToken.tokenPrefix}... - {scimToken.status}
            </p>
          ))}
          <input
            className="textarea"
            placeholder="Token name"
            value={scimTokenForm.name}
            onChange={(event) =>
              setScimTokenForm((current) => ({ ...current, name: event.target.value }))
            }
            maxLength={100}
          />
          <div className="toolbar">
            <button
              className="button"
              onClick={() =>
                startTransition(async () => {
                  const result = await createScimToken(token, scimTokenForm);
                  setNewScimToken(result.rawToken);
                  await onRefresh();
                  setMessage("SCIM token created.");
                })
              }
            >
              Create SCIM Token
            </button>
          </div>
          {newScimToken ? (
            <div className="new-secret-container">
              <div className="sensitive-data-warning">
                <strong>⚠️ SCIM Token - Copy now!</strong>
                <p className="muted">This token will only be shown once. Store it securely.</p>
              </div>
              <MaskedSecret label="SCIM Token" value={newScimToken} copyLabel="Copy Token" defaultHidden={false} />
              <button className="button small secondary" onClick={() => setNewScimToken("")}>
                Dismiss
              </button>
            </div>
          ) : null}
        </div>

        <div className="item">
          <h3>SSO providers</h3>
          {snapshot.ssoProviders.map((provider) => (
            <p className="muted" key={provider.id}>
              {provider.displayName} - {provider.providerType} - {provider.providerName} -{" "}
              {provider.enabled ? "enabled" : "disabled"}
            </p>
          ))}
          <div className="list">
            <select
              className="textarea"
              value={ssoForm.providerType}
              onChange={(event) =>
                setSsoForm((current) => ({
                  ...current,
                  providerType: event.target.value as SsoProviderSummary["providerType"]
                }))
              }
            >
              <option value="oidc">OIDC</option>
              <option value="saml">SAML</option>
            </select>
            <input
              className="textarea"
              placeholder="Provider name"
              value={ssoForm.providerName}
              onChange={(event) =>
                setSsoForm((current) => ({ ...current, providerName: event.target.value }))
              }
            />
            <input
              className="textarea"
              placeholder="Display name"
              value={ssoForm.displayName}
              onChange={(event) =>
                setSsoForm((current) => ({ ...current, displayName: event.target.value }))
              }
            />
            {ssoForm.providerType === "oidc" ? (
              <>
                <input
                  className="textarea"
                  placeholder="Client ID"
                  value={ssoForm.clientId}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, clientId: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  type="password"
                  placeholder="Client secret"
                  value={ssoForm.clientSecret}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, clientSecret: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="Issuer URL"
                  value={ssoForm.issuerUrl}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, issuerUrl: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="JWKS URI"
                  value={ssoForm.jwksUri}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, jwksUri: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="Authorization endpoint"
                  value={ssoForm.authorizationEndpoint}
                  onChange={(event) =>
                    setSsoForm((current) => ({
                      ...current,
                      authorizationEndpoint: event.target.value
                    }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="Token endpoint"
                  value={ssoForm.tokenEndpoint}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, tokenEndpoint: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="Userinfo endpoint"
                  value={ssoForm.userinfoEndpoint}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, userinfoEndpoint: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="Scopes"
                  value={ssoForm.scopes}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, scopes: event.target.value }))
                  }
                />
              </>
            ) : (
              <>
                <input
                  className="textarea"
                  placeholder="IdP Entity ID"
                  value={ssoForm.entityId}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, entityId: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="SSO URL"
                  value={ssoForm.ssoUrl}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, ssoUrl: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="SLO URL"
                  value={ssoForm.sloUrl}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, sloUrl: event.target.value }))
                  }
                />
                <textarea
                  className="textarea"
                  placeholder="X.509 certificate"
                  value={ssoForm.x509Cert}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, x509Cert: event.target.value }))
                  }
                />
                <input
                  className="textarea"
                  placeholder="NameID format"
                  value={ssoForm.nameIdFormat}
                  onChange={(event) =>
                    setSsoForm((current) => ({ ...current, nameIdFormat: event.target.value }))
                  }
                />
                {samlMetadataUrl ? <p className="muted">SP metadata URL: {samlMetadataUrl}</p> : null}
              </>
            )}
            <label className="muted">
              <input
                type="checkbox"
                checked={ssoForm.enabled}
                onChange={(event) =>
                  setSsoForm((current) => ({ ...current, enabled: event.target.checked }))
                }
              />{" "}
              Enabled
            </label>
            <div className="toolbar">
              <button
                className="button"
                onClick={() =>
                  startTransition(async () => {
                    await upsertSsoProvider(token, ssoForm);
                    await onRefresh();
                    setMessage("SSO provider saved.");
                  })
                }
              >
                Save SSO Provider
              </button>
            </div>
          </div>
        </div>

        {message ? <p className="muted">{message}</p> : null}
      </div>
    </div>
  );
}
