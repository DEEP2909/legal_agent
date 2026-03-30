import type {
  ApiKeySummary,
  Attorney,
  AuthSession,
  DashboardSnapshot,
  InvitationSummary,
  LoginSuccessResponse,
  LoginResponse,
  MfaSetupResponse,
  MfaStatus,
  PasskeySummary,
  ResearchResponse,
  ScimTokenSummary,
  SsoProviderSummary,
  Tenant
} from "@legal-agent/shared";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function withAuth(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    credentials: "include", // Include httpOnly cookies
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`
    }
  };
}

function withCredentials(init?: RequestInit): RequestInit {
  return {
    ...init,
    credentials: "include" // Include httpOnly cookies
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Request failed");
  }

  return response.json();
}

export async function login(email: string, password: string, tenantId?: string): Promise<LoginResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/login`, withCredentials({
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password, tenantId })
  }));

  return parseResponse<LoginResponse>(response);
}

export async function logout(token: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${apiBaseUrl}/auth/logout`, withAuth(token, {
    method: "POST"
  }));
  return parseResponse<{ ok: boolean }>(response);
}

export async function beginPasswordlessPasskeyLogin(input: {
  tenantId: string;
  email: string;
}): Promise<{ challengeId: string; options: Record<string, unknown> }> {
  const response = await fetch(`${apiBaseUrl}/auth/passkey/options`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<{ challengeId: string; options: Record<string, unknown> }>(response);
}

export async function finishPasswordlessPasskeyLogin(input: {
  tenantId: string;
  email: string;
  challengeId: string;
  response: Record<string, unknown>;
}): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/passkey/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<LoginSuccessResponse>(response);
}

export async function verifyMfaChallenge(input: {
  challengeToken: string;
  token?: string;
  recoveryCode?: string;
}): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/mfa/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<LoginSuccessResponse>(response);
}

export async function beginMfaPasskeyAuthentication(challengeToken: string): Promise<{
  challengeId: string;
  options: Record<string, unknown>;
}> {
  const response = await fetch(`${apiBaseUrl}/auth/mfa/webauthn/options`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ challengeToken })
  });

  return parseResponse<{ challengeId: string; options: Record<string, unknown> }>(response);
}

export async function finishMfaPasskeyAuthentication(input: {
  challengeToken: string;
  challengeId: string;
  response: Record<string, unknown>;
}): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/mfa/webauthn/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<LoginSuccessResponse>(response);
}

export async function exchangeAuthCode(code: string): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code })
  });

  return parseResponse<LoginSuccessResponse>(response);
}

export async function getMe(token: string): Promise<AuthSession> {
  const response = await fetch(`${apiBaseUrl}/auth/me`, withAuth(token, { cache: "no-store" }));
  return parseResponse<AuthSession>(response);
}

export async function startSamlLogout(
  token: string,
  input?: { providerName?: string; redirectPath?: string }
): Promise<{ logoutUrl: string }> {
  const response = await fetch(
    `${apiBaseUrl}/auth/sso/saml/logout`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input ?? {})
    })
  );

  return parseResponse<{ logoutUrl: string }>(response);
}

export async function getDashboard(token: string): Promise<DashboardSnapshot> {
  const response = await fetch(`${apiBaseUrl}/api/dashboard`, withAuth(token, { cache: "no-store" }));
  return parseResponse<DashboardSnapshot>(response);
}

export async function runResearch(question: string, token: string): Promise<ResearchResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/research/query`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question })
    })
  );

  return parseResponse<ResearchResponse>(response);
}

export async function uploadDocument(formData: FormData, token: string) {
  const response = await fetch(
    `${apiBaseUrl}/api/documents/upload`,
    withAuth(token, {
      method: "POST",
      body: formData
    })
  );

  return parseResponse<Record<string, unknown>>(response);
}

export async function getTenantAdmin(token: string): Promise<{
  tenant?: Tenant;
  attorneys: Attorney[];
  apiKeys: ApiKeySummary[];
  invitations: InvitationSummary[];
  ssoProviders: SsoProviderSummary[];
  scimTokens: ScimTokenSummary[];
}> {
  const response = await fetch(`${apiBaseUrl}/api/admin/tenant`, withAuth(token, { cache: "no-store" }));
  return parseResponse<{
    tenant?: Tenant;
    attorneys: Attorney[];
    apiKeys: ApiKeySummary[];
    invitations: InvitationSummary[];
    ssoProviders: SsoProviderSummary[];
    scimTokens: ScimTokenSummary[];
  }>(response);
}

export async function updateTenant(
  token: string,
  input: { name: string; region: string; plan: string }
): Promise<Tenant> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/tenant`,
    withAuth(token, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<Tenant>(response);
}

export async function createAttorney(
  token: string,
  input: {
    email: string;
    fullName: string;
    role: Attorney["role"];
    practiceArea: string;
    password: string;
    isTenantAdmin: boolean;
  }
): Promise<Attorney> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/attorneys`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<Attorney>(response);
}

export async function createApiKey(
  token: string,
  input: {
    attorneyId: string;
    name: string;
    role: Attorney["role"];
  }
): Promise<ApiKeySummary & { rawKey: string }> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/api-keys`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<ApiKeySummary & { rawKey: string }>(response);
}

export async function createScimToken(
  token: string,
  input: { name: string }
): Promise<ScimTokenSummary & { rawToken: string }> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/scim/tokens`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<ScimTokenSummary & { rawToken: string }>(response);
}

export async function createInvitation(
  token: string,
  input: {
    email: string;
    fullName?: string;
    role: Attorney["role"];
    practiceArea: string;
    isTenantAdmin: boolean;
  }
): Promise<InvitationSummary & { rawToken?: string }> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/invitations`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<InvitationSummary & { rawToken?: string }>(response);
}

export async function upsertSsoProvider(
  token: string,
  input: {
    providerType: SsoProviderSummary["providerType"];
    providerName: string;
    displayName: string;
    clientId?: string;
    clientSecret?: string;
    issuerUrl?: string;
    jwksUri?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    userinfoEndpoint?: string;
    entityId?: string;
    ssoUrl?: string;
    sloUrl?: string;
    x509Cert?: string;
    nameIdFormat?: string;
    scopes: string;
    enabled: boolean;
  }
): Promise<SsoProviderSummary> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/sso-providers`,
    withAuth(token, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<SsoProviderSummary>(response);
}

export async function forgotPassword(email: string): Promise<{ ok: boolean; resetToken?: string }> {
  const response = await fetch(`${apiBaseUrl}/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });

  return parseResponse<{ ok: boolean; resetToken?: string }>(response);
}

export async function getMfaStatus(token: string): Promise<MfaStatus> {
  const response = await fetch(`${apiBaseUrl}/api/security/mfa`, withAuth(token, { cache: "no-store" }));
  return parseResponse<MfaStatus>(response);
}

export async function listPasskeys(token: string): Promise<PasskeySummary[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys`,
    withAuth(token, {
      cache: "no-store"
    })
  );

  return parseResponse<PasskeySummary[]>(response);
}

export async function beginPasskeyRegistration(
  token: string,
  input?: { label?: string }
): Promise<{ challengeId: string; options: Record<string, unknown> }> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys/register/options`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input ?? {})
    })
  );

  return parseResponse<{ challengeId: string; options: Record<string, unknown> }>(response);
}

export async function finishPasskeyRegistration(
  token: string,
  input: { challengeId: string; response: Record<string, unknown>; label?: string }
): Promise<PasskeySummary[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys/register/verify`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<PasskeySummary[]>(response);
}

export async function deletePasskey(token: string, passkeyId: string): Promise<{ ok: boolean }> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys/${encodeURIComponent(passkeyId)}`,
    withAuth(token, {
      method: "DELETE"
    })
  );

  return parseResponse<{ ok: boolean }>(response);
}

export async function beginMfaEnrollment(token: string): Promise<MfaSetupResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/mfa/setup`,
    withAuth(token, {
      method: "POST"
    })
  );

  return parseResponse<MfaSetupResponse>(response);
}

export async function confirmMfaEnrollment(token: string, mfaToken: string): Promise<MfaStatus> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/mfa/confirm`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: mfaToken })
    })
  );

  return parseResponse<MfaStatus>(response);
}

export async function disableMfa(
  token: string,
  input: { token?: string; recoveryCode?: string }
): Promise<{ ok: boolean }> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/mfa/disable`,
    withAuth(token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<{ ok: boolean }>(response);
}

export async function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${apiBaseUrl}/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token, password })
  });

  return parseResponse<{ ok: boolean }>(response);
}

export async function acceptInvitation(input: {
  token: string;
  password: string;
  fullName?: string;
}): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/invitations/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<LoginSuccessResponse>(response);
}

export async function getPublicSsoProviders(tenantId: string): Promise<SsoProviderSummary[]> {
  const response = await fetch(
    `${apiBaseUrl}/auth/sso/providers?tenantId=${encodeURIComponent(tenantId)}`,
    {
      cache: "no-store"
    }
  );

  return parseResponse<SsoProviderSummary[]>(response);
}

export function getSsoStartUrl(input: { tenantId: string; providerName: string; redirectPath?: string }) {
  const search = new URLSearchParams({
    tenantId: input.tenantId,
    providerName: input.providerName
  });

  if (input.redirectPath) {
    search.set("redirectPath", input.redirectPath);
  }

  return `${apiBaseUrl}/auth/sso/start?${search.toString()}`;
}
