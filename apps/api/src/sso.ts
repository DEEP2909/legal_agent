import { createRemoteJWKSet, jwtVerify } from "jose";
import { URLSearchParams } from "node:url";
import { config } from "./config.js";

const SSO_FETCH_TIMEOUT_MS = 10000; // 10 seconds

function createFetchWithTimeout(timeoutMs: number) {
  return async (url: URL | string, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

const fetchWithTimeout = createFetchWithTimeout(SSO_FETCH_TIMEOUT_MS);

type SsoProviderConfig = {
  providerName: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  issuerUrl?: string;
  jwksUri?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  scopes: string;
  enabled: boolean;
};

type OidcMetadata = {
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
};

async function resolveMetadata(provider: SsoProviderConfig): Promise<OidcMetadata> {
  if (provider.issuerUrl) {
    const wellKnownUrl = new URL(".well-known/openid-configuration", provider.issuerUrl.endsWith("/")
      ? provider.issuerUrl
      : `${provider.issuerUrl}/`);
    const response = await fetchWithTimeout(wellKnownUrl);
    if (!response.ok) {
      throw new Error("Unable to fetch OIDC discovery document.");
    }

    const discovery = (await response.json()) as Record<string, string>;
    return {
      issuer: discovery.issuer,
      authorizationEndpoint: provider.authorizationEndpoint || discovery.authorization_endpoint,
      tokenEndpoint: provider.tokenEndpoint || discovery.token_endpoint,
      userinfoEndpoint: provider.userinfoEndpoint || discovery.userinfo_endpoint,
      jwksUri: provider.jwksUri || discovery.jwks_uri
    };
  }

  if (!provider.authorizationEndpoint || !provider.tokenEndpoint) {
    throw new Error("SSO provider is missing authorization or token endpoint.");
  }

  return {
    authorizationEndpoint: provider.authorizationEndpoint,
    tokenEndpoint: provider.tokenEndpoint,
    userinfoEndpoint: provider.userinfoEndpoint,
    jwksUri: provider.jwksUri
  };
}

export async function buildAuthorizationUrl(input: {
  provider: SsoProviderConfig;
  state: string;
  nonce: string;
  codeChallenge: string;
}) {
  const metadata = await resolveMetadata(input.provider);
  const callbackUrl = `${config.publicApiBaseUrl}/auth/sso/callback`;

  const params = new URLSearchParams({
    client_id: input.provider.clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: input.provider.scopes,
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256"
  });

  return `${metadata.authorizationEndpoint}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(input: {
  provider: SsoProviderConfig;
  code: string;
  codeVerifier: string;
}) {
  const metadata = await resolveMetadata(input.provider);
  const callbackUrl = `${config.publicApiBaseUrl}/auth/sso/callback`;

  const response = await fetchWithTimeout(metadata.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.provider.clientId,
      client_secret: input.provider.clientSecret,
      redirect_uri: callbackUrl,
      code_verifier: input.codeVerifier
    })
  });

  if (!response.ok) {
    throw new Error("Failed to exchange SSO authorization code.");
  }

  return {
    metadata,
    tokens: (await response.json()) as Record<string, string>
  };
}

export async function verifyIdToken(input: {
  metadata: OidcMetadata;
  provider: SsoProviderConfig;
  idToken: string;
  nonce: string;
}) {
  if (!input.metadata.jwksUri) {
    throw new Error("SSO provider JWKS URI is not configured.");
  }

  const jwks = createRemoteJWKSet(new URL(input.metadata.jwksUri));
  const verification = await jwtVerify(input.idToken, jwks, {
    issuer: input.metadata.issuer,
    audience: input.provider.clientId
  });

  if (verification.payload.nonce !== input.nonce) {
    throw new Error("SSO ID token nonce did not match the authentication request.");
  }

  return verification.payload;
}

export async function fetchUserInfo(input: {
  metadata: OidcMetadata;
  accessToken: string;
}) {
  if (!input.metadata.userinfoEndpoint) {
    return null;
  }

  const response = await fetch(input.metadata.userinfoEndpoint, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Failed to fetch SSO userinfo.");
  }

  return (await response.json()) as Record<string, unknown>;
}
