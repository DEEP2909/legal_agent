import { randomUUID } from "node:crypto";
import { repository } from "../repository.js";
import { generateRawApiKey, getApiKeyPrefix, hashApiKey, hashPassword } from "../security.js";
import { withTransaction } from "../transaction.js";

export const platformService = {
  async listTenants(options?: { limit?: number; cursor?: string }) {
    return repository.listTenants(options);
  },

  async createTenant(input: {
    name: string;
    region: string;
    plan: string;
    adminEmail: string;
    adminFullName: string;
    adminPassword: string;
  }) {
    const tenantId = randomUUID();
    const attorneyId = randomUUID();
    const passwordHash = await hashPassword(input.adminPassword);
    const rawKey = generateRawApiKey();

    return withTransaction(async () => {
      const tenant = await repository.createTenant({
        id: tenantId,
        name: input.name,
        region: input.region,
        plan: input.plan
      });

      const attorney = await repository.createAttorney({
        id: attorneyId,
        tenantId,
        email: input.adminEmail,
        fullName: input.adminFullName,
        role: "admin",
        practiceArea: "Firm Administration",
        passwordHash,
        isTenantAdmin: true
      });

      const apiKey = await repository.createApiKey({
        id: randomUUID(),
        tenantId,
        attorneyId,
        name: "Initial Tenant Key",
        keyPrefix: getApiKeyPrefix(rawKey),
        keyHash: hashApiKey(rawKey),
        role: "admin"
      });

      return {
        tenant,
        attorney,
        apiKey: {
          ...apiKey,
          rawKey
        }
      };
    });
  }
};


