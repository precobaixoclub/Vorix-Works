import { apiClient } from "@/lib/api-client";
import type { AuthUser, TenantMembership, TenantRole } from "./types";

/** Estas, diferente de login/refresh/logout (`lib/auth-api.ts`), usam Bearer access token normal — passam pelo `apiClient` como qualquer outra chamada de negócio. */

export async function listMemberships(): Promise<TenantMembership[]> {
  return apiClient.get<TenantMembership[]>("/v1/auth/memberships");
}

/** `permissions`/`teams` (0173): acesso EFETIVO atual — perfil + exceções + equipes. */
export type MyAccess = { permissions: string[]; isAccountOwner: boolean; teams: { teamId: string; role: TenantRole; isManager: boolean }[] };

export async function getMe(): Promise<{ user: AuthUser; tenantId: string; role: TenantRole } & Partial<MyAccess>> {
  return apiClient.get("/v1/auth/me");
}

export async function switchTenant(tenantId: string): Promise<{ accessToken: string; expiresIn: number; tenantId: string; role: TenantRole }> {
  return apiClient.post("/v1/auth/switch-tenant", { tenantId });
}
