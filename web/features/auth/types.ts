/** Espelha `src/domain/identity/identity.model.ts` (backend). */

export const TENANT_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  /** Superadmin da plataforma — Sprint 25. Único papel que abre `/admin`. */
  isPlatformAdmin: boolean;
};

export type TenantMembership = {
  id: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  createdAt: string;
  updatedAt: string;
};
