import { SAML, type CacheProvider, ValidateInResponseTo } from "@node-saml/node-saml";
import type { ParsedQs } from "qs";
import { config } from "./config.js";
import { repository } from "./repository.js";
import { normalizePem, validateAndNormalizeCertificate } from "./security.js";

export type SamlProviderConfig = {
  tenantId: string;
  providerName: string;
  displayName: string;
  entityId?: string;
  ssoUrl?: string;
  logoutUrl?: string;
  x509Cert?: string;
  nameIdFormat?: string;
};

function getSpEntityId(provider: SamlProviderConfig) {
  return `${config.publicApiBaseUrl}/auth/sso/saml/metadata/${encodeURIComponent(provider.tenantId)}/${encodeURIComponent(provider.providerName)}`;
}

function getLogoutCallbackUrl(provider: SamlProviderConfig) {
  const url = new URL("/auth/sso/saml/logout/callback", config.publicApiBaseUrl);
  url.searchParams.set("tenantId", provider.tenantId);
  url.searchParams.set("providerName", provider.providerName);
  return url.toString();
}

function createCacheProvider(): CacheProvider {
  return {
    async saveAsync(key, value) {
      const stored = await repository.saveSamlRequest(key, value);
      return stored ? { value: stored, createdAt: Date.now() } : null;
    },
    async getAsync(key) {
      return repository.getSamlRequest(key);
    },
    async removeAsync(key) {
      return repository.consumeSamlRequest(key);
    }
  };
}

function buildSamlClient(provider: SamlProviderConfig) {
  if (!provider.ssoUrl || !provider.x509Cert) {
    throw new Error("SAML provider is missing SSO URL or X.509 certificate.");
  }

  const signingEnabled = config.samlSignAuthnRequests || config.samlSignMetadata;
  const privateKey = signingEnabled && config.samlSpPrivateKey ? normalizePem(config.samlSpPrivateKey) : undefined;
  const publicCert = config.samlSpPublicCert ? normalizePem(config.samlSpPublicCert) : undefined;
  
  // Validate IdP certificate
  const certValidation = validateAndNormalizeCertificate(provider.x509Cert);
  if (!certValidation.valid) {
    throw new Error(`SAML IdP certificate validation failed: ${certValidation.error}`);
  }
  const idpCert = certValidation.normalized!;

  return new SAML({
    issuer: getSpEntityId(provider),
    callbackUrl: `${config.publicApiBaseUrl}/auth/sso/saml/acs`,
    entryPoint: provider.ssoUrl,
    logoutUrl: provider.logoutUrl || provider.ssoUrl,
    logoutCallbackUrl: getLogoutCallbackUrl(provider),
    idpCert,
    idpIssuer: provider.entityId,
    audience: getSpEntityId(provider),
    identifierFormat: provider.nameIdFormat ?? null,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: 15 * 60 * 1000,
    disableRequestedAuthnContext: true,
    privateKey,
    publicCert,
    signatureAlgorithm: config.samlSignatureAlgorithm,
    authnRequestBinding: "HTTP-Redirect",
    signMetadata: config.samlSignMetadata,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    acceptedClockSkewMs: 10_000,
    cacheProvider: createCacheProvider()
  });
}

export async function buildSamlAuthorizeUrl(input: {
  provider: SamlProviderConfig;
  relayState: string;
}) {
  const samlClient = buildSamlClient(input.provider);
  return samlClient.getAuthorizeUrlAsync(input.relayState, undefined, {});
}

export async function validateSamlPostResponse(input: {
  provider: SamlProviderConfig;
  samlResponse: string;
  relayState: string;
}) {
  const samlClient = buildSamlClient(input.provider);
  return samlClient.validatePostResponseAsync({
    SAMLResponse: input.samlResponse,
    RelayState: input.relayState
  });
}

export async function buildSamlLogoutUrl(input: {
  provider: SamlProviderConfig;
  relayState: string;
  profile: {
    issuer: string;
    nameID: string;
    nameIDFormat: string;
    sessionIndex?: string;
  };
}) {
  const samlClient = buildSamlClient(input.provider);
  return samlClient.getLogoutUrlAsync(input.profile, input.relayState, {});
}

export async function buildSamlLogoutResponseUrl(input: {
  provider: SamlProviderConfig;
  relayState: string;
  logoutRequest: {
    issuer: string;
    nameID: string;
    nameIDFormat: string;
    sessionIndex?: string;
    ID?: string;
  };
  success: boolean;
}) {
  const samlClient = buildSamlClient(input.provider);
  return samlClient.getLogoutResponseUrlAsync(input.logoutRequest, input.relayState, {}, input.success);
}

export async function validateSamlRedirect(input: {
  provider: SamlProviderConfig;
  query: ParsedQs;
  originalQuery: string;
}) {
  const samlClient = buildSamlClient(input.provider);
  return samlClient.validateRedirectAsync(input.query, input.originalQuery);
}

export function generateSamlMetadata(provider: SamlProviderConfig) {
  const publicCert = config.samlSpPublicCert ? normalizePem(config.samlSpPublicCert) : null;
  return buildSamlClient(provider).generateServiceProviderMetadata(null, publicCert);
}
