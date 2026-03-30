export type Severity = "info" | "warn" | "critical";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type RiskLevel = "low" | "medium" | "high";
export type MfaMethod = "totp" | "recovery_code" | "webauthn";
export type DocumentSecurityStatus = "pending_scan" | "clean" | "quarantined";

export interface Attorney {
  id: string;
  fullName: string;
  email: string;
  role: "partner" | "associate" | "paralegal" | "admin";
  practiceArea: string;
  isTenantAdmin?: boolean;
  canLogin?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  region: string;
  plan: string;
}

export interface Matter {
  id: string;
  matterCode: string;
  title: string;
  clientName: string;
  matterType: string;
  status: "open" | "closed";
  jurisdiction: string;
  responsibleAttorneyId: string;
}

export interface DocumentRecord {
  id: string;
  tenantId?: string;
  matterId: string;
  sourceName: string;
  mimeType: string;
  docType: string;
  ingestionStatus: "uploaded" | "processing" | "normalized" | "reviewed" | "failed";
  securityStatus: DocumentSecurityStatus;
  securityReason?: string;
  normalizedText: string;
  privilegeScore: number;
  relevanceScore: number;
  storagePath?: string;
  embedding?: number[];
  createdAt?: string;
  sha256?: string;
}

export interface ClauseRecord {
  id: string;
  documentId: string;
  clauseType: string;
  heading: string | null;
  textExcerpt: string;
  pageFrom: number;
  pageTo: number;
  riskLevel: RiskLevel;
  confidence: number;
  reviewerStatus: ReviewStatus;
}

export interface FlagRecord {
  id: string;
  matterId: string;
  documentId: string;
  clauseId?: string;
  flagType: string;
  severity: Severity;
  reason: string;
  confidence: number;
  status: "open" | "resolved";
}

export interface DashboardSnapshot {
  tenant?: Tenant;
  matters: Matter[];
  documents: DocumentRecord[];
  clauses: ClauseRecord[];
  flags: FlagRecord[];
  attorneys: Attorney[];
}

export interface UploadDocumentRequest {
  matterId: string;
  sourceName: string;
  mimeType: string;
  docType: string;
  normalizedText?: string;
}

export interface AuthSession {
  tenantId: string;
  attorneyId: string;
  role: Attorney["role"];
  apiKeyId?: string; // ID of the API key used (not the raw key for security)
  email?: string;
  fullName?: string;
  isTenantAdmin?: boolean;
  authMethod?: "api_key" | "jwt";
  federationProtocol?: "oidc" | "saml";
  identityProvider?: string;
}

export interface LoginSuccessResponse {
  mfaRequired: false;
  accessToken: string;
  expiresInSeconds: number;
  session: AuthSession;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
  session: AuthSession;
  availableMethods: MfaMethod[];
}

export type LoginResponse = LoginSuccessResponse | MfaChallengeResponse;

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  role: Attorney["role"];
  status: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface InvitationSummary {
  id: string;
  email: string;
  fullName?: string;
  role: Attorney["role"];
  practiceArea: string;
  isTenantAdmin: boolean;
  status: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

export interface SsoProviderSummary {
  id: string;
  providerName: string;
  providerType: "oidc" | "saml";
  displayName: string;
  clientId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface MfaStatus {
  enabled: boolean;
  totpEnabled: boolean;
  pendingEnrollment: boolean;
  recoveryCodesRemaining: number;
  passkeyCount: number;
  availableMethods: MfaMethod[];
  enabledAt?: string;
}

export interface MfaSetupResponse {
  secretBase32: string;
  otpAuthUrl: string;
  recoveryCodes: string[];
  expiresAt: string;
}

export interface PasskeySummary {
  id: string;
  credentialId: string;
  label?: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export interface ScimTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  status: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface ResearchResponse {
  answer: string;
  citations: Array<{
    title: string;
    citation: string;
    relevance: number;
  }>;
}

export interface ClauseExtractionRequest {
  documentId: string;
  documentType: string;
  normalizedText?: string;
}

export interface RiskAssessmentRequest {
  clauseText: string;
  playbook: string[];
}
