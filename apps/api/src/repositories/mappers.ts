import type {
  ApiKeySummary,
  Attorney,
  ClauseRecord,
  DocumentRecord,
  FlagRecord,
  InvitationSummary,
  Matter,
  PasskeySummary,
  ScimTokenSummary,
  SsoProviderSummary,
  Tenant
} from "@legal-agent/shared";

export function mapAttorney(row: Record<string, unknown>): Attorney {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    canLogin: Boolean(row.can_login),
    isActive: Boolean(row.is_active),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : undefined
  };
}

export function mapTenant(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    name: String(row.name),
    region: String(row.region),
    plan: String(row.plan)
  };
}

export function mapMatter(row: Record<string, unknown>): Matter {
  return {
    id: String(row.id),
    matterCode: String(row.matter_code),
    title: String(row.title),
    clientName: String(row.client_name ?? ""),
    matterType: String(row.matter_type),
    status: row.status as Matter["status"],
    jurisdiction: String(row.jurisdiction),
    responsibleAttorneyId: String(row.responsible_attorney_id ?? "")
  };
}

export function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    matterId: String(row.matter_id),
    sourceName: String(row.source_name),
    mimeType: String(row.mime_type),
    docType: String(row.doc_type ?? ""),
    ingestionStatus: row.ingestion_status as DocumentRecord["ingestionStatus"],
    securityStatus: (row.security_status as DocumentRecord["securityStatus"]) ?? "clean",
    securityReason: row.security_reason ? String(row.security_reason) : undefined,
    normalizedText: String(row.normalized_text ?? ""),
    privilegeScore: Number(row.privilege_score ?? 0),
    relevanceScore: Number(row.relevance_score ?? 0),
    storagePath: String(row.file_uri ?? ""),
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    sha256: String(row.sha256 ?? "")
  };
}

export function mapClause(row: Record<string, unknown>): ClauseRecord {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    clauseType: String(row.clause_type),
    heading: row.heading ? String(row.heading) : null,
    textExcerpt: String(row.text_excerpt),
    pageFrom: Number(row.page_from ?? 1),
    pageTo: Number(row.page_to ?? 1),
    riskLevel: row.risk_level as ClauseRecord["riskLevel"],
    confidence: Number(row.confidence ?? 0),
    reviewerStatus: row.reviewer_status as ClauseRecord["reviewerStatus"]
  };
}

export function mapFlag(row: Record<string, unknown>): FlagRecord {
  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    documentId: String(row.document_id),
    clauseId: row.clause_id ? String(row.clause_id) : undefined,
    flagType: String(row.flag_type),
    severity: row.severity as FlagRecord["severity"],
    reason: String(row.reason),
    confidence: Number(row.confidence ?? 0),
    status: row.status as FlagRecord["status"]
  };
}

export function mapApiKey(row: Record<string, unknown>): ApiKeySummary {
  return {
    id: String(row.id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    role: row.role as Attorney["role"],
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : undefined
  };
}

export function mapInvitation(row: Record<string, unknown>): InvitationSummary {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: row.full_name ? String(row.full_name) : undefined,
    role: row.role as Attorney["role"],
    practiceArea: String(row.practice_area ?? ""),
    isTenantAdmin: Boolean(row.is_tenant_admin),
    status: String(row.status),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    acceptedAt: row.accepted_at ? new Date(String(row.accepted_at)).toISOString() : undefined,
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

export function mapPasskey(row: Record<string, unknown>): PasskeySummary {
  return {
    id: String(row.id),
    credentialId: String(row.credential_id),
    label: row.label ? String(row.label) : undefined,
    deviceType: row.device_type as PasskeySummary["deviceType"],
    backedUp: Boolean(row.backed_up),
    transports: Array.isArray(row.transports) ? row.transports.map(String) : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : undefined
  };
}

export function mapScimToken(row: Record<string, unknown>): ScimTokenSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : undefined
  };
}

export function mapSsoProvider(row: Record<string, unknown>): SsoProviderSummary {
  return {
    id: String(row.id),
    providerName: String(row.provider_name),
    providerType: (row.provider_type as SsoProviderSummary["providerType"]) ?? "oidc",
    displayName: String(row.display_name),
    clientId: String(row.client_id),
    issuerUrl: row.issuer_url ? String(row.issuer_url) : undefined,
    jwksUri: row.jwks_uri ? String(row.jwks_uri) : undefined,
    authorizationEndpoint: row.authorization_endpoint ? String(row.authorization_endpoint) : undefined,
    tokenEndpoint: row.token_endpoint ? String(row.token_endpoint) : undefined,
    userinfoEndpoint: row.userinfo_endpoint ? String(row.userinfo_endpoint) : undefined,
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    ssoUrl: row.sso_url ? String(row.sso_url) : undefined,
    sloUrl: row.slo_url ? String(row.slo_url) : undefined,
    x509Cert: row.x509_cert ? String(row.x509_cert) : undefined,
    nameIdFormat: row.name_id_format ? String(row.name_id_format) : undefined,
    scopes: String(row.scopes),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}
