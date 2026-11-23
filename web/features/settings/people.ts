import type { TenantRole } from "@/features/auth/types";
import type { TenantMembership } from "@/features/identity/types";
import type { SolutionKey } from "@/lib/solutions";
import { canManageBilling, canManageTenant, canOperateWorkspace } from "@/lib/rbac";

/** Perfis (0173): owner = Administrador, admin = Gerente, editor = Atendente; viewer é legado. */
export const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gerente", editor: "Atendente", viewer: "Visualizador" };

/** O que o papel permite por padrão — derivado das MESMAS regras de `lib/rbac.ts` (o servidor decide). */
function summary(role: TenantRole): string {
  const parts: string[] = [];
  if (canManageTenant(role)) parts.push("gerencia usuários e equipes");
  if (canManageBilling(role)) parts.push("cuida do plano e da cobrança");
  if (canOperateWorkspace(role)) parts.push("opera as ferramentas contratadas");
  else parts.push("só consulta");
  return `${ROLE_LABEL[role]}: ${parts.join(", ")}. Exceções por pessoa ficam em "Acesso".`;
}
export const ROLE_SUMMARY: Record<TenantRole, string> = { owner: summary("owner"), admin: summary("admin"), editor: summary("editor"), viewer: summary("viewer") };

export const TOOL_LABEL: Record<SolutionKey, string> = { conversations: "Conversas", site: "Site", marketing: "Marketing", meetings: "Reuniões" };

export type AccessSummary = { active: number; disabled: number; administrators: number; byRole: Record<TenantRole, number>; accountOwner?: string };

/** Quem tem acesso, contado sobre a lista de membros que a tela já carrega (sem consulta nova). */
export function accessSummary(members: readonly Pick<TenantMembership, "role" | "status" | "isAccountOwner" | "name" | "email">[]): AccessSummary {
  const byRole: Record<TenantRole, number> = { owner: 0, admin: 0, editor: 0, viewer: 0 };
  let active = 0;
  let disabled = 0;
  for (const member of members) {
    if (member.status === "disabled") {
      disabled += 1;
      continue;
    }
    active += 1;
    byRole[member.role] += 1;
  }
  const owner = members.find((member) => member.isAccountOwner);
  return { active, disabled, administrators: byRole.owner + byRole.admin, byRole, accountOwner: owner ? owner.name ?? owner.email : undefined };
}
