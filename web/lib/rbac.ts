import type { TenantRole } from "@/features/auth/types";

export function canManageTenant(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canOperateWorkspace(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

export function canManageBilling(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

export const RBAC_COPY = {
  manageTenant: "Apenas owner e admin podem gerenciar usuários e equipes.",
  operateConversations: "Apenas owner, admin e editor podem operar conversas.",
  manageBilling: "Apenas owner e admin podem gerenciar plano e cobranca.",
} as const;
