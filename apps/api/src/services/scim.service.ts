import type { AuthSession } from "@legal-agent/shared";
import { randomUUID } from "node:crypto";
import { repository } from "../repository.js";
import { generateOpaqueToken, hashPassword } from "../security.js";
import { buildScimGroupFromRow, buildScimUserFromRow } from "./shared.js";

export const scimService = {
  async getScimServiceProviderConfig() {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer Token",
          description: "Tenant-scoped SCIM bearer token",
          specUri: "https://datatracker.ietf.org/doc/html/rfc7644"
        }
      ]
    };
  },

  async getScimResourceTypes() {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      Resources: [
        {
          id: "User",
          name: "User",
          endpoint: "/Users",
          description: "Law firm attorney accounts",
          schema: "urn:ietf:params:scim:schemas:core:2.0:User"
        },
        {
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          description: "Practice groups and provisioning groups",
          schema: "urn:ietf:params:scim:schemas:core:2.0:Group"
        }
      ],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2
    };
  },

  async getScimSchemas() {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      Resources: [
        {
          id: "urn:ietf:params:scim:schemas:core:2.0:User",
          name: "User",
          description: "Core SCIM User",
          attributes: [
            { name: "userName", type: "string", multiValued: false, required: true, mutability: "readWrite" },
            { name: "displayName", type: "string", multiValued: false, required: false, mutability: "readWrite" },
            { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite" },
            { name: "emails", type: "complex", multiValued: true, required: false, mutability: "readWrite" }
          ]
        },
        {
          id: "urn:ietf:params:scim:schemas:core:2.0:Group",
          name: "Group",
          description: "Core SCIM Group",
          attributes: [
            { name: "displayName", type: "string", multiValued: false, required: true, mutability: "readWrite" },
            { name: "members", type: "complex", multiValued: true, required: false, mutability: "readWrite" }
          ]
        }
      ],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2
    };
  },

  async listScimUsers(input: {
    tenantId: string;
    startIndex: number;
    count: number;
    filter?: string;
  }) {
    const emailFilterMatch = input.filter?.match(/userName eq "([^"]+)"/i);
    const emailFilter = emailFilterMatch?.[1];
    const result = await repository.listAttorneysForScim({
      tenantId: input.tenantId,
      startIndex: input.startIndex,
      count: input.count,
      email: emailFilter
    });

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: result.totalResults,
      startIndex: input.startIndex,
      itemsPerPage: result.attorneys.length,
      Resources: result.attorneys.map((row) => buildScimUserFromRow(row))
    };
  },

  async getScimUser(tenantId: string, attorneyId: string) {
    const attorney = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!attorney) {
      throw new Error("SCIM user not found.");
    }

    return buildScimUserFromRow(attorney);
  },

  async createScimUser(
    tenantId: string,
    input: {
      userName: string;
      displayName?: string;
      name?: { formatted?: string };
      emails?: Array<{ value?: string; primary?: boolean }>;
      active?: boolean;
      role?: AuthSession["role"];
      practiceArea?: string;
      isTenantAdmin?: boolean;
    }
  ) {
    const email =
      input.userName ||
      input.emails?.find((entry) => entry.primary)?.value ||
      input.emails?.[0]?.value ||
      "";
    if (!email) {
      throw new Error("SCIM userName or email is required.");
    }

    const attorney = await repository.createAttorney({
      id: randomUUID(),
      tenantId,
      email,
      fullName: input.displayName || input.name?.formatted || email,
      role: input.role ?? "associate",
      practiceArea: input.practiceArea ?? "Corporate",
      passwordHash: await hashPassword(generateOpaqueToken("scim")),
      isTenantAdmin: Boolean(input.isTenantAdmin),
      canLogin: Boolean(input.active ?? true),
      isActive: Boolean(input.active ?? true)
    });

    const created = await repository.getAttorneyByIdForTenant(attorney.id, tenantId);
    if (!created) {
      throw new Error("SCIM user could not be created.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_created",
      objectType: "attorney",
      objectId: attorney.id,
      metadata: {
        email
      }
    });

    return buildScimUserFromRow(created);
  },

  async replaceScimUser(
    tenantId: string,
    attorneyId: string,
    input: {
      userName: string;
      displayName?: string;
      name?: { formatted?: string };
      emails?: Array<{ value?: string; primary?: boolean }>;
      active?: boolean;
      role?: AuthSession["role"];
      practiceArea?: string;
      isTenantAdmin?: boolean;
    }
  ) {
    const existing = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!existing) {
      throw new Error("SCIM user not found.");
    }

    const email =
      input.userName ||
      input.emails?.find((entry) => entry.primary)?.value ||
      input.emails?.[0]?.value ||
      String(existing.email);
    const fullName = input.displayName || input.name?.formatted || String(existing.full_name);
    await repository.updateAttorneyIdentity({
      attorneyId,
      tenantId,
      email,
      fullName,
      role: (input.role ?? existing.role) as AuthSession["role"],
      practiceArea: input.practiceArea ?? String(existing.practice_area ?? ""),
      isTenantAdmin: Boolean(input.isTenantAdmin ?? existing.is_tenant_admin),
      canLogin: Boolean(input.active ?? existing.can_login),
      isActive: Boolean(input.active ?? existing.is_active)
    });

    const updated = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!updated) {
      throw new Error("SCIM user could not be updated.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_replaced",
      objectType: "attorney",
      objectId: attorneyId
    });

    return buildScimUserFromRow(updated);
  },

  async patchScimUser(
    tenantId: string,
    attorneyId: string,
    input: {
      Operations: Array<{
        op: string;
        path?: string;
        value?: unknown;
      }>;
    }
  ) {
    const existing = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!existing) {
      throw new Error("SCIM user not found.");
    }

    let nextEmail = String(existing.email);
    let nextFullName = String(existing.full_name);
    let nextRole = String(existing.role) as AuthSession["role"];
    let nextPracticeArea = String(existing.practice_area ?? "");
    let nextIsTenantAdmin = Boolean(existing.is_tenant_admin);
    let nextCanLogin = Boolean(existing.can_login);
    let nextIsActive = Boolean(existing.is_active);

    for (const operation of input.Operations) {
      const op = operation.op.toLowerCase();
      if (!["add", "replace"].includes(op)) {
        continue;
      }

      const path = operation.path?.toLowerCase();
      if (!path) {
        const value = operation.value as Record<string, unknown> | undefined;
        if (!value) {
          continue;
        }
        if (typeof value.active === "boolean") {
          nextCanLogin = value.active;
          nextIsActive = value.active;
        }
        if (typeof value.displayName === "string") {
          nextFullName = value.displayName;
        }
        if (typeof value.userName === "string") {
          nextEmail = value.userName;
        }
        continue;
      }

      if (path === "active" && typeof operation.value === "boolean") {
        nextCanLogin = operation.value;
        nextIsActive = operation.value;
      }

      if ((path === "username" || path === "userName".toLowerCase()) && typeof operation.value === "string") {
        nextEmail = operation.value;
      }

      if ((path === "displayname" || path === "name.formatted") && typeof operation.value === "string") {
        nextFullName = operation.value;
      }
    }

    await repository.updateAttorneyIdentity({
      attorneyId,
      tenantId,
      email: nextEmail,
      fullName: nextFullName,
      role: nextRole,
      practiceArea: nextPracticeArea,
      isTenantAdmin: nextIsTenantAdmin,
      canLogin: nextCanLogin,
      isActive: nextIsActive
    });

    const updated = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!updated) {
      throw new Error("SCIM user could not be updated.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_patched",
      objectType: "attorney",
      objectId: attorneyId
    });

    return buildScimUserFromRow(updated);
  },

  async deactivateScimUser(tenantId: string, attorneyId: string) {
    const existing = await repository.getAttorneyByIdForTenant(attorneyId, tenantId);
    if (!existing) {
      throw new Error("SCIM user not found.");
    }

    await repository.updateAttorneyIdentity({
      attorneyId,
      tenantId,
      email: String(existing.email),
      fullName: String(existing.full_name),
      role: String(existing.role) as AuthSession["role"],
      practiceArea: String(existing.practice_area ?? ""),
      isTenantAdmin: Boolean(existing.is_tenant_admin),
      canLogin: false,
      isActive: false
    });
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.user_deactivated",
      objectType: "attorney",
      objectId: attorneyId
    });

    return { ok: true };
  },

  async listScimGroups(input: {
    tenantId: string;
    startIndex: number;
    count: number;
    filter?: string;
  }) {
    const displayNameMatch = input.filter?.match(/displayName eq "([^"]+)"/i);
    const result = await repository.listScimGroups({
      tenantId: input.tenantId,
      startIndex: input.startIndex,
      count: input.count,
      displayName: displayNameMatch?.[1]
    });

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: result.totalResults,
      startIndex: input.startIndex,
      itemsPerPage: result.groups.length,
      Resources: await Promise.all(result.groups.map((row) => buildScimGroupFromRow(row)))
    };
  },

  async getScimGroup(tenantId: string, groupId: string) {
    const group = await repository.getScimGroup(groupId, tenantId);
    if (!group) {
      throw new Error("SCIM group not found.");
    }

    return buildScimGroupFromRow(group);
  },

  async createScimGroup(
    tenantId: string,
    input: {
      displayName: string;
      externalId?: string;
      description?: string;
      members?: Array<{ value: string }>;
    }
  ) {
    const group = await repository.createScimGroup({
      id: randomUUID(),
      tenantId,
      displayName: input.displayName,
      externalId: input.externalId,
      description: input.description
    });
    if (!group) {
      throw new Error("SCIM group could not be created.");
    }

    if (input.members?.length) {
      await repository.replaceScimGroupMembers(
        String(group.id),
        tenantId,
        input.members.map((member) => member.value)
      );
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_created",
      objectType: "group",
      objectId: String(group.id)
    });

    const created = await repository.getScimGroup(String(group.id), tenantId);
    if (!created) {
      throw new Error("SCIM group could not be reloaded.");
    }

    return buildScimGroupFromRow(created);
  },

  async replaceScimGroup(
    tenantId: string,
    groupId: string,
    input: {
      displayName: string;
      externalId?: string;
      description?: string;
      members?: Array<{ value: string }>;
    }
  ) {
    const updated = await repository.updateScimGroup({
      groupId,
      tenantId,
      displayName: input.displayName,
      externalId: input.externalId,
      description: input.description
    });
    if (!updated) {
      throw new Error("SCIM group not found.");
    }

    await repository.replaceScimGroupMembers(
      groupId,
      tenantId,
      input.members?.map((member) => member.value) ?? []
    );
    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_replaced",
      objectType: "group",
      objectId: groupId
    });

    return buildScimGroupFromRow(updated);
  },

  async patchScimGroup(
    tenantId: string,
    groupId: string,
    input: {
      Operations: Array<{
        op: string;
        path?: string;
        value?: unknown;
      }>;
    }
  ) {
    const existing = await repository.getScimGroup(groupId, tenantId);
    if (!existing) {
      throw new Error("SCIM group not found.");
    }

    let nextDisplayName = String(existing.display_name);
    let nextExternalId = existing.external_id ? String(existing.external_id) : undefined;
    let nextDescription = existing.description ? String(existing.description) : undefined;
    let replaceMembersWith: string[] | null = null;
    const addMembers: string[] = [];
    const removeMembers: string[] = [];

    for (const operation of input.Operations) {
      const op = operation.op.toLowerCase();
      const path = operation.path?.toLowerCase();

      if ((op === "replace" || op === "add") && (path === "displayname" || !path)) {
        const value = operation.value as string | Record<string, unknown> | undefined;
        if (typeof value === "string") {
          nextDisplayName = value;
        } else if (value && typeof value === "object" && typeof value.displayName === "string") {
          nextDisplayName = value.displayName;
        }
      }

      if ((op === "replace" || op === "add") && path === "externalid" && typeof operation.value === "string") {
        nextExternalId = operation.value;
      }

      if ((op === "replace" || op === "add") && path === "members") {
        const values = Array.isArray(operation.value) ? operation.value : [];
        const memberIds = values
          .map((entry) => (entry && typeof entry === "object" && "value" in entry ? String((entry as { value: unknown }).value) : ""))
          .filter(Boolean);
        if (op === "replace") {
          replaceMembersWith = memberIds;
        } else {
          addMembers.push(...memberIds);
        }
      }

      if (op === "remove" && path === "members") {
        const values = Array.isArray(operation.value) ? operation.value : [];
        removeMembers.push(
          ...values
            .map((entry) =>
              entry && typeof entry === "object" && "value" in entry
                ? String((entry as { value: unknown }).value)
                : ""
            )
            .filter(Boolean)
        );
      }
    }

    const updated = await repository.updateScimGroup({
      groupId,
      tenantId,
      displayName: nextDisplayName,
      externalId: nextExternalId,
      description: nextDescription
    });
    if (!updated) {
      throw new Error("SCIM group not found.");
    }

    if (replaceMembersWith) {
      await repository.replaceScimGroupMembers(groupId, tenantId, replaceMembersWith);
    } else {
      if (addMembers.length > 0) {
        await repository.addScimGroupMembers(groupId, tenantId, addMembers);
      }
      if (removeMembers.length > 0) {
        await repository.removeScimGroupMembers(groupId, removeMembers);
      }
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_patched",
      objectType: "group",
      objectId: groupId
    });

    const reloaded = await repository.getScimGroup(groupId, tenantId);
    if (!reloaded) {
      throw new Error("SCIM group could not be reloaded.");
    }

    return buildScimGroupFromRow(reloaded);
  },

  async deleteScimGroup(tenantId: string, groupId: string) {
    const deleted = await repository.deleteScimGroup(groupId, tenantId);
    if (!deleted) {
      throw new Error("SCIM group not found.");
    }

    await repository.recordAuditEvent({
      id: randomUUID(),
      tenantId,
      actorAttorneyId: undefined,
      eventType: "scim.group_deleted",
      objectType: "group",
      objectId: groupId
    });

    return { ok: true };
  },

};


