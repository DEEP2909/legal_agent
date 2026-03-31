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
import { validatePassword } from "@legal-agent/shared";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  acceptInvitation,
  ApiError,
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
  logout,
  resetPassword,
  startSamlLogout,
  updateTenant,
  upsertSsoProvider,
  verifyMfaChallenge
} from "../lib/api";
import { AdminPanel, type AdminSnapshot } from "./components/admin";
import { SecurityPanel } from "./components/security";
import { MaskedSecret } from "./components/shared/masked-secret";
import { ResearchPanel } from "./research-panel";
import { UploadPanel } from "./upload-panel";

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
  // Authentication is now tracked via httpOnly cookies - no token stored in JS
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
  const [tenantIdForSso, setTenantIdForSso] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? ""
  );
  const [ssoProviders, setSsoProviders] = useState<SsoProviderSummary[]>([]);
  const [isPending, startTransition] = useTransition();

  // Refresh all user data - uses httpOnly cookie automatically
  async function refreshAll() {
    const [me, dashboardData, mfaData, passkeyData] = await Promise.all([
      getMe(),
      getDashboard(),
      getMfaStatus(),
      listPasskeys()
    ]);
    setSession(me);
    setDashboard(dashboardData);
    setMfaStatus(mfaData);
    setPasskeys(passkeyData);
    setIsAuthenticated(true);

    if (me.isTenantAdmin) {
      setAdminSnapshot(await getTenantAdmin());
    } else {
      setAdminSnapshot(null);
    }
  }

  // Clear all local state on logout
  function clearSession() {
    setIsAuthenticated(false);
    setSession(null);
    setDashboard(null);
    setAdminSnapshot(null);
    setMfaStatus(null);
    setMfaSetup(null);
    setMfaChallengeToken("");
    setMfaAvailableMethods([]);
    setPasskeys([]);
    setAuthView("login");
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
      // SSO callback - exchange code and cookie will be set by server
      void exchangeAuthCode(authExchange)
        .then(async () => {
          await refreshAll();
          clearAuthQueryParams();
        })
        .catch((exchangeError) => {
          setError(exchangeError instanceof Error ? exchangeError.message : "SSO sign-in failed.");
          clearAuthQueryParams();
        });
      return;
    }

    // Try to load session from existing httpOnly cookie
    void refreshAll().catch((loadError) => {
      // 401 means no valid session - this is expected for unauthenticated users
      if (loadError instanceof ApiError && loadError.status === 401) {
        return; // Silently stay on login page
      }
      setError(loadError instanceof Error ? loadError.message : "Session expired.");
    });
  }, []);

  useEffect(() => {
    if (tenantIdForSso) {
      void getPublicSsoProviders(tenantIdForSso)
        .then(setSsoProviders)
        .catch((error) => {
          console.error("Failed to fetch SSO providers:", error);
          setSsoProviders([]);
        });
    }
  }, [tenantIdForSso]);

  if (!isAuthenticated || !dashboard || !session) {
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
                      await finishPasswordlessPasskeyLogin({
                        tenantId: tenantIdForSso,
                        email,
                        challengeId: options.challengeId,
                        response: assertion as unknown as Record<string, unknown>
                      });
                      // Cookie is set by server - just refresh session
                      await refreshAll();
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
                      // Cookie is set by server - just refresh session
                      await refreshAll();
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
                      await finishMfaPasskeyAuthentication({
                        challengeToken: mfaChallengeToken,
                        challengeId: options.challengeId,
                        response: assertion as unknown as Record<string, unknown>
                      });
                      // Cookie is set by server - just refresh session
                      setAuthView("login");
                      setMfaChallengeToken("");
                      setMfaAvailableMethods([]);
                      await refreshAll();
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
                      await verifyMfaChallenge({
                        challengeToken: mfaChallengeToken,
                        token: tokenValue || undefined,
                        recoveryCode: recoveryCode || undefined
                      });
                      // Cookie is set by server - just refresh session
                      setAuthView("login");
                      setMfaChallengeToken("");
                      setMfaAvailableMethods([]);
                      await refreshAll();
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
                      await acceptInvitation({
                        token: submittedToken,
                        password,
                        fullName
                      });
                      // Cookie is set by server - just refresh session
                      await refreshAll();
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
                if (session.federationProtocol === "saml" && session.identityProvider) {
                  try {
                    const result = await startSamlLogout({
                      providerName: session.identityProvider,
                      redirectPath: "/"
                    });
                    await logout();
                    clearSession();
                    window.location.assign(result.logoutUrl);
                    return;
                  } catch {
                    await logout().catch(() => {});
                    clearSession();
                    return;
                  }
                }

                // Regular logout - server clears the cookie
                await logout().catch(() => {});
                clearSession();
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
              snapshot={adminSnapshot}
              onRefresh={() => refreshAll()}
            />
          ) : null}

          {mfaStatus ? (
            <SecurityPanel
              mfaStatus={mfaStatus}
              mfaSetup={mfaSetup}
              passkeys={passkeys}
              onRefresh={async () => {
                setMfaStatus(await getMfaStatus());
                setPasskeys(await listPasskeys());
                await refreshAll();
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

          <UploadPanel matters={dashboard.matters} onUploaded={() => refreshAll()} />
          <ResearchPanel />
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

