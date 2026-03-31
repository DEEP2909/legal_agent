"use client";

import type {
  ApiKeySummary,
  Attorney,
  InvitationSummary,
  ScimTokenSummary,
  SsoProviderSummary,
  Tenant
} from "@legal-agent/shared";
import { useMemo, useState, useTransition } from "react";
import {
  createApiKey,
  createAttorney,
  createInvitation,
  createScimToken,
  updateTenant,
  upsertSsoProvider
} from "../../../lib/api";
import { MaskedSecret } from "../shared/masked-secret";

export interface AdminSnapshot {
  tenant?: Tenant;
  attorneys: Attorney[];
  apiKeys: ApiKeySummary[];
  invitations: InvitationSummary[];
  ssoProviders: SsoProviderSummary[];
  scimTokens: ScimTokenSummary[];
}

export interface AdminPanelProps {
  token: string;
  snapshot: AdminSnapshot;
  onRefresh: () => Promise<void>;
}

export function AdminPanel({ token, snapshot, onRefresh }: AdminPanelProps) {
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
        {/* Tenant Settings */}
        <div className="item">
          <h3>Tenant settings</h3>
          <input
            className="textarea"
            value={tenantForm.name}
            onChange={(event) => setTenantForm((current) => ({ ...current, name: event.target.value }))}
            aria-label="Tenant name"
          />
          <input
            className="textarea"
            value={tenantForm.region}
            onChange={(event) => setTenantForm((current) => ({ ...current, region: event.target.value }))}
            aria-label="Region"
          />
          <input
            className="textarea"
            value={tenantForm.plan}
            onChange={(event) => setTenantForm((current) => ({ ...current, plan: event.target.value }))}
            aria-label="Plan"
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

        {/* Attorneys */}
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
              onChange={(event) => setAttorneyForm((current) => ({ ...current, email: event.target.value }))}
              aria-label="Email"
            />
            <input
              className="textarea"
              placeholder="Full name"
              value={attorneyForm.fullName}
              onChange={(event) => setAttorneyForm((current) => ({ ...current, fullName: event.target.value }))}
              aria-label="Full name"
            />
            <input
              className="textarea"
              placeholder="Practice area"
              value={attorneyForm.practiceArea}
              onChange={(event) => setAttorneyForm((current) => ({ ...current, practiceArea: event.target.value }))}
              aria-label="Practice area"
            />
            <select
              className="textarea"
              value={attorneyForm.role}
              onChange={(event) => setAttorneyForm((current) => ({ ...current, role: event.target.value as Attorney["role"] }))}
              aria-label="Role"
            >
              <option value="associate">Associate</option>
              <option value="partner">Partner</option>
              <option value="paralegal">Paralegal</option>
              <option value="admin">Admin</option>
            </select>
            <input
              className="textarea"
              type="password"
              placeholder="Password"
              value={attorneyForm.password}
              onChange={(event) => setAttorneyForm((current) => ({ ...current, password: event.target.value }))}
              aria-label="Password"
            />
            <label className="muted">
              <input
                type="checkbox"
                checked={attorneyForm.isTenantAdmin}
                onChange={(event) => setAttorneyForm((current) => ({ ...current, isTenantAdmin: event.target.checked }))}
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

        {/* Invitations */}
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
              onChange={(event) => setInvitationForm((current) => ({ ...current, email: event.target.value }))}
              aria-label="Invite email"
            />
            <input
              className="textarea"
              placeholder="Full name"
              value={invitationForm.fullName}
              onChange={(event) => setInvitationForm((current) => ({ ...current, fullName: event.target.value }))}
              aria-label="Full name"
            />
            <input
              className="textarea"
              placeholder="Practice area"
              value={invitationForm.practiceArea}
              onChange={(event) => setInvitationForm((current) => ({ ...current, practiceArea: event.target.value }))}
              aria-label="Practice area"
            />
            <select
              className="textarea"
              value={invitationForm.role}
              onChange={(event) => setInvitationForm((current) => ({ ...current, role: event.target.value as Attorney["role"] }))}
              aria-label="Role"
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
                onChange={(event) => setInvitationForm((current) => ({ ...current, isTenantAdmin: event.target.checked }))}
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

        {/* API Keys */}
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
            onChange={(event) => setApiKeyForm((current) => ({ ...current, attorneyId: event.target.value }))}
            aria-label="Attorney"
          >
            {snapshot.attorneys.map((attorney) => (
              <option value={attorney.id} key={attorney.id}>
                {attorney.fullName}
              </option>
            ))}
          </select>
          <input
            className="textarea"
            placeholder="Key name"
            value={apiKeyForm.name}
            onChange={(event) => setApiKeyForm((current) => ({ ...current, name: event.target.value }))}
            aria-label="Key name"
          />
          <select
            className="textarea"
            value={apiKeyForm.role}
            onChange={(event) => setApiKeyForm((current) => ({ ...current, role: event.target.value as Attorney["role"] }))}
            aria-label="Key role"
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

        {/* SCIM Tokens */}
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
            onChange={(event) => setScimTokenForm((current) => ({ ...current, name: event.target.value }))}
            maxLength={100}
            aria-label="Token name"
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

        {/* SSO Providers */}
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
              onChange={(event) => setSsoForm((current) => ({ ...current, providerType: event.target.value as SsoProviderSummary["providerType"] }))}
              aria-label="Provider type"
            >
              <option value="oidc">OIDC</option>
              <option value="saml">SAML</option>
            </select>
            <input
              className="textarea"
              placeholder="Provider name"
              value={ssoForm.providerName}
              onChange={(event) => setSsoForm((current) => ({ ...current, providerName: event.target.value }))}
              aria-label="Provider name"
            />
            <input
              className="textarea"
              placeholder="Display name"
              value={ssoForm.displayName}
              onChange={(event) => setSsoForm((current) => ({ ...current, displayName: event.target.value }))}
              aria-label="Display name"
            />
            {ssoForm.providerType === "oidc" ? (
              <>
                <input className="textarea" placeholder="Client ID" value={ssoForm.clientId} onChange={(event) => setSsoForm((current) => ({ ...current, clientId: event.target.value }))} aria-label="Client ID" />
                <input className="textarea" type="password" placeholder="Client secret" value={ssoForm.clientSecret} onChange={(event) => setSsoForm((current) => ({ ...current, clientSecret: event.target.value }))} aria-label="Client secret" />
                <input className="textarea" placeholder="Issuer URL" value={ssoForm.issuerUrl} onChange={(event) => setSsoForm((current) => ({ ...current, issuerUrl: event.target.value }))} aria-label="Issuer URL" />
                <input className="textarea" placeholder="JWKS URI" value={ssoForm.jwksUri} onChange={(event) => setSsoForm((current) => ({ ...current, jwksUri: event.target.value }))} aria-label="JWKS URI" />
                <input className="textarea" placeholder="Authorization endpoint" value={ssoForm.authorizationEndpoint} onChange={(event) => setSsoForm((current) => ({ ...current, authorizationEndpoint: event.target.value }))} aria-label="Authorization endpoint" />
                <input className="textarea" placeholder="Token endpoint" value={ssoForm.tokenEndpoint} onChange={(event) => setSsoForm((current) => ({ ...current, tokenEndpoint: event.target.value }))} aria-label="Token endpoint" />
                <input className="textarea" placeholder="Userinfo endpoint" value={ssoForm.userinfoEndpoint} onChange={(event) => setSsoForm((current) => ({ ...current, userinfoEndpoint: event.target.value }))} aria-label="Userinfo endpoint" />
                <input className="textarea" placeholder="Scopes" value={ssoForm.scopes} onChange={(event) => setSsoForm((current) => ({ ...current, scopes: event.target.value }))} aria-label="Scopes" />
              </>
            ) : (
              <>
                <input className="textarea" placeholder="IdP Entity ID" value={ssoForm.entityId} onChange={(event) => setSsoForm((current) => ({ ...current, entityId: event.target.value }))} aria-label="IdP Entity ID" />
                <input className="textarea" placeholder="SSO URL" value={ssoForm.ssoUrl} onChange={(event) => setSsoForm((current) => ({ ...current, ssoUrl: event.target.value }))} aria-label="SSO URL" />
                <input className="textarea" placeholder="SLO URL" value={ssoForm.sloUrl} onChange={(event) => setSsoForm((current) => ({ ...current, sloUrl: event.target.value }))} aria-label="SLO URL" />
                <textarea className="textarea" placeholder="X.509 certificate" value={ssoForm.x509Cert} onChange={(event) => setSsoForm((current) => ({ ...current, x509Cert: event.target.value }))} aria-label="X.509 certificate" />
                <input className="textarea" placeholder="NameID format" value={ssoForm.nameIdFormat} onChange={(event) => setSsoForm((current) => ({ ...current, nameIdFormat: event.target.value }))} aria-label="NameID format" />
                {samlMetadataUrl ? <p className="muted">SP metadata URL: {samlMetadataUrl}</p> : null}
              </>
            )}
            <label className="muted">
              <input
                type="checkbox"
                checked={ssoForm.enabled}
                onChange={(event) => setSsoForm((current) => ({ ...current, enabled: event.target.checked }))}
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
