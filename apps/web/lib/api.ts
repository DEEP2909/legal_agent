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

// Custom error class that preserves HTTP status codes
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// All authenticated requests use httpOnly cookies - no token in JS memory
function withAuth(init?: RequestInit): RequestInit {
  return {
    ...init,
    credentials: "include" // httpOnly cookie sent automatically
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
    throw new ApiError(response.status, body?.error || "Request failed");
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

export async function logout(): Promise<{ ok: boolean }> {
  const response = await fetch(`${apiBaseUrl}/auth/logout`, withAuth({
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
  const response = await fetch(`${apiBaseUrl}/auth/passkey/verify`, withCredentials({
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  }));

  return parseResponse<LoginSuccessResponse>(response);
}

export async function verifyMfaChallenge(input: {
  challengeToken: string;
  token?: string;
  recoveryCode?: string;
}): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/mfa/verify`, withCredentials({
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  }));

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
  const response = await fetch(`${apiBaseUrl}/auth/mfa/webauthn/verify`, withCredentials({
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  }));

  return parseResponse<LoginSuccessResponse>(response);
}

export async function exchangeAuthCode(code: string): Promise<LoginSuccessResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/exchange`, withCredentials({
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code })
  }));

  return parseResponse<LoginSuccessResponse>(response);
}

// All authenticated API calls use httpOnly cookie - no token parameter needed
export async function getMe(): Promise<AuthSession> {
  const response = await fetch(`${apiBaseUrl}/auth/me`, withAuth({ cache: "no-store" }));
  return parseResponse<AuthSession>(response);
}

export async function startSamlLogout(
  input?: { providerName?: string; redirectPath?: string }
): Promise<{ logoutUrl: string }> {
  const response = await fetch(
    `${apiBaseUrl}/auth/sso/saml/logout`,
    withAuth({
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input ?? {})
    })
  );

  return parseResponse<{ logoutUrl: string }>(response);
}

export async function getDashboard(): Promise<DashboardSnapshot> {
  const response = await fetch(`${apiBaseUrl}/api/dashboard`, withAuth({ cache: "no-store" }));
  return parseResponse<DashboardSnapshot>(response);
}

export async function runResearch(question: string): Promise<ResearchResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/research/query`,
    withAuth({
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question })
    })
  );

  return parseResponse<ResearchResponse>(response);
}

export async function uploadDocument(formData: FormData) {
  const response = await fetch(
    `${apiBaseUrl}/api/documents/upload`,
    withAuth({
      method: "POST",
      body: formData
    })
  );

  return parseResponse<Record<string, unknown>>(response);
}

export async function getTenantAdmin(): Promise<{
  tenant?: Tenant;
  attorneys: Attorney[];
  apiKeys: ApiKeySummary[];
  invitations: InvitationSummary[];
  ssoProviders: SsoProviderSummary[];
  scimTokens: ScimTokenSummary[];
}> {
  const response = await fetch(`${apiBaseUrl}/api/admin/tenant`, withAuth({ cache: "no-store" }));
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
  input: { name: string; region: string; plan: string }
): Promise<Tenant> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/tenant`,
    withAuth({
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
    withAuth({
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
  input: {
    attorneyId: string;
    name: string;
    role: Attorney["role"];
  }
): Promise<ApiKeySummary & { rawKey: string }> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/api-keys`,
    withAuth({
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
  input: { name: string }
): Promise<ScimTokenSummary & { rawToken: string }> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/scim/tokens`,
    withAuth({
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
    withAuth({
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
    withAuth({
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

export async function getMfaStatus(): Promise<MfaStatus> {
  const response = await fetch(`${apiBaseUrl}/api/security/mfa`, withAuth({ cache: "no-store" }));
  return parseResponse<MfaStatus>(response);
}

export async function listPasskeys(): Promise<PasskeySummary[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys`,
    withAuth({
      cache: "no-store"
    })
  );

  return parseResponse<PasskeySummary[]>(response);
}

export async function beginPasskeyRegistration(
  input?: { label?: string }
): Promise<{ challengeId: string; options: Record<string, unknown> }> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys/register/options`,
    withAuth({
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
  input: { challengeId: string; response: Record<string, unknown>; label?: string }
): Promise<PasskeySummary[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys/register/verify`,
    withAuth({
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return parseResponse<PasskeySummary[]>(response);
}

export async function deletePasskey(passkeyId: string): Promise<{ ok: boolean }> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/passkeys/${encodeURIComponent(passkeyId)}`,
    withAuth({
      method: "DELETE"
    })
  );

  return parseResponse<{ ok: boolean }>(response);
}

export async function beginMfaEnrollment(): Promise<MfaSetupResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/mfa/setup`,
    withAuth({
      method: "POST"
    })
  );

  return parseResponse<MfaSetupResponse>(response);
}

export async function confirmMfaEnrollment(mfaToken: string): Promise<MfaStatus> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/mfa/confirm`,
    withAuth({
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
  input: { token?: string; recoveryCode?: string }
): Promise<{ ok: boolean }> {
  const response = await fetch(
    `${apiBaseUrl}/api/security/mfa/disable`,
    withAuth({
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
