/** Espelha `src/domain/identity/identity.model.ts` (backend). */

export const TENANT_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type TenantMembership = {
  id: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  createdAt: string;
  updatedAt: string;
};
