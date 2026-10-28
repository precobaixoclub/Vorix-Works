/**
 * Perfis, direitos de acesso e escopo (migration 0173). Três dimensões, nunca só o nome do perfil:
 *
 *   Perfil base (preset)  +  Exceções individuais  +  Escopo de equipes
 *
 * - Perfil: `TenantRole` já existente (owner = Administrador, admin = Gerente, editor = Atendente,
 *   viewer = Visualizador legado). Só o padrão inicial — ver `ROLE_PERMISSIONS`.
 * - Exceções: `TenantMembership.permissionGrants/Revokes`; a permissão efetiva sai de
 *   `effectivePermissions` e é recalculada a cada requisição (troca vale na hora).
 * - Escopo de equipes: `team_memberships` — participar de uma equipe define o que "dados da
 *   equipe" significa para quem tem `*:view_team`; ser GERENTE da equipe (papel `owner`/`admin`
 *   na equipe) define onde a pessoa pode CONFIGURAR (kanbans, metas de equipe).
 *
 * Puro: sem I/O. As regras de proteção (autoelevação, autobloqueio, administrador principal)
 * vivem aqui para serem testáveis isoladamente; quem aplica é `access-control-use-cases.ts`.
 */

import { effectivePermissions, PERMISSIONS, ROLE_PERMISSIONS, type Permission, type TenantMembership, type TenantRole } from "./identity.model.js";

export const ACCESS_PROFILE_LABELS: Record<TenantRole, string> = {
  owner: "Administrador",
  admin: "Gerente",
  editor: "Atendente",
  viewer: "Visualizador",
};

/** Papel dentro de uma equipe: gerente (`owner`/`admin`, vocabulário já existente) ou membro. */
export function isTeamManagerRole(role: TenantRole): boolean {
  return role === "owner" || role === "admin";
}

export type PermissionCatalogEntry = { permission: Permission; label: string; description?: string; sensitive?: boolean };
export type PermissionCategory = { key: string; label: string; description: string; permissions: PermissionCatalogEntry[] };

/**
 * Permissões apresentadas na tela de edição do usuário, agrupadas por domínio. Só as que fazem
 * sentido de negócio ajustar por pessoa — as técnicas (execução, publicação, analytics...) seguem
 * o perfil e não poluem a tela. Qualquer permissão de `PERMISSIONS` continua válida via API.
 */
export const PERMISSION_CATALOG: readonly PermissionCategory[] = [
  {
    key: "users",
    label: "Usuários e equipes",
    description: "Quem pode ver e mudar a estrutura de acesso da empresa.",
    permissions: [
      { permission: "tenant_member:read", label: "Ver membros das equipes", description: "Gerente vê os membros das equipes que gerencia." },
      { permission: "tenant_member:manage", label: "Gerenciar usuários", description: "Criar, editar e desativar usuários.", sensitive: true },
      { permission: "tenant_member:manage_permissions", label: "Gerenciar perfis e permissões", description: "Alterar perfil, permissões e equipes de outras pessoas.", sensitive: true },
      { permission: "team:read", label: "Ver equipes" },
      { permission: "team:manage", label: "Gerenciar equipes", description: "Criar equipes e definir membros e gerentes.", sensitive: true },
    ],
  },
  {
    key: "attendance",
    label: "Atendimentos e conversas",
    description: "Sem permissão de escopo, a pessoa vê só os próprios atendimentos e a fila.",
    permissions: [
      { permission: "inbox:reply", label: "Responder conversas" },
      { permission: "inbox:assign", label: "Atribuir, transferir, finalizar e reabrir" },
      { permission: "inbox:view_team", label: "Ver atendimentos da equipe" },
      { permission: "inbox:view_all", label: "Ver todos os atendimentos" },
      { permission: "inbox:waive_csat", label: "Dispensar pesquisa de satisfação" },
      { permission: "inbox:manage_ai", label: "Ligar/pausar a IA de atendimento" },
      { permission: "inbox:delete_conversations", label: "Excluir conversas", sensitive: true },
    ],
  },
  {
    key: "deals",
    label: "Oportunidades",
    description: "Sem permissão de escopo, a pessoa vê as próprias oportunidades.",
    permissions: [
      { permission: "deal:manage", label: "Criar e editar oportunidades" },
      { permission: "deal:view_team", label: "Ver oportunidades da equipe" },
      { permission: "deal:view_all", label: "Ver todas as oportunidades" },
      { permission: "deal:win", label: "Marcar como ganha" },
      { permission: "deal:lose", label: "Marcar como perdida" },
      { permission: "deal:reopen", label: "Reabrir oportunidade" },
      { permission: "deal:edit_closed", label: "Corrigir oportunidade fechada" },
      { permission: "deal:approve_discount", label: "Aprovar desconto e margem" },
      { permission: "deal:view_margin", label: "Ver margem" },
      { permission: "product:view_cost", label: "Ver custo dos produtos" },
    ],
  },
  {
    key: "kanban",
    label: "Kanbans",
    description: "Configurar vale só nas equipes que a pessoa gerencia — ou em todas, para o Administrador.",
    permissions: [
      { permission: "inbox:configure_kanban", label: "Configurar Kanban de Atendimento" },
      { permission: "pipeline:configure", label: "Configurar Kanban de Oportunidades" },
    ],
  },
  {
    key: "goals",
    label: "Metas e dashboards",
    description: "Toda pessoa vê a própria meta e a própria performance.",
    permissions: [
      { permission: "goal:read_team", label: "Ver metas da equipe" },
      { permission: "goal:read_all", label: "Ver todas as metas" },
      { permission: "goal:manage", label: "Definir metas", sensitive: true },
      { permission: "sales_report:read_team", label: "Dashboard da equipe" },
      { permission: "sales_report:read_all", label: "Dashboard global" },
    ],
  },
  {
    key: "site",
    label: "Site, produtos e loja",
    description: "Catálogo, estoque, site público, pedidos e configuração da loja online.",
    permissions: [
      { permission: "product:manage", label: "Cadastrar e editar produtos" },
      { permission: "marketplace:read", label: "Visualizar marketplaces e anúncios" },
      { permission: "marketplace:manage", label: "Conectar e gerenciar marketplaces", sensitive: true },
      { permission: "inventory:manage", label: "Movimentar estoque" },
      { permission: "site:manage", label: "Editar a estrutura do site", description: "Modelos, páginas, seções, catálogo e contato." },
      { permission: "site:publish", label: "Publicar o site e configurar domínio", sensitive: true },
      { permission: "order:read", label: "Ver pedidos da loja" },
      { permission: "order:manage", label: "Operar pedidos", description: "Avançar status, registrar envio e devoluções." },
      { permission: "order:cancel", label: "Cancelar pedidos", description: "Cancela no Site ou no marketplace (no escopo das equipes para quem não é global).", sensitive: true },
      { permission: "payment:refund", label: "Estornar pagamentos", description: "Devolve dinheiro ao cliente, total ou parcial.", sensitive: true },
      { permission: "commerce:manage", label: "Configurar vendas, pagamento e frete", description: "Como vender, gateway de pagamento, métodos de entrega.", sensitive: true },
    ],
  },
  {
    key: "settings",
    label: "Configurações",
    description: "Configurações administrativas da empresa.",
    permissions: [
      { permission: "inbox:manage_service", label: "Tipos de finalização e regras de atendimento" },
      { permission: "inbox:manage_connections", label: "Configurar canais e filas" },
      { permission: "inbox:delete_connections", label: "Excluir canais", sensitive: true },
      { permission: "automation:manage", label: "Configurar automações" },
      { permission: "credential:connect", label: "Conectar integrações" },
      { permission: "workspace:update", label: "Configurações gerais" },
    ],
  },
];

/** Permissões que o Administrador principal nunca perde (nem por ele mesmo): sem elas a empresa
 * poderia ficar sem ninguém capaz de recuperar acessos. */
export const ACCOUNT_OWNER_PROTECTED_PERMISSIONS: readonly Permission[] = ["tenant_member:manage", "tenant_member:manage_permissions", "team:manage"];

export type AccessChange = { role: TenantRole; grants: readonly string[]; revokes: readonly string[] };

/** Limpa as exceções: só permissões válidas, sem duplicar o que o preset já dá (grant) ou já não
 * dá (revoke), e nunca a mesma permissão nas duas listas. */
export function normalizeAccessChange(change: AccessChange): AccessChange {
  const valid = new Set<string>(PERMISSIONS);
  const preset = new Set<string>(ROLE_PERMISSIONS[change.role]);
  const revokes = [...new Set(change.revokes)].filter((permission) => valid.has(permission) && preset.has(permission)).sort();
  const revoked = new Set(revokes);
  const grants = [...new Set(change.grants)].filter((permission) => valid.has(permission) && !preset.has(permission) && !revoked.has(permission)).sort();
  for (const permission of change.grants) if (!valid.has(permission)) throw new Error(`ACCESS_PERMISSION_UNKNOWN: permissão "${permission}" não existe.`);
  for (const permission of change.revokes) if (!valid.has(permission)) throw new Error(`ACCESS_PERMISSION_UNKNOWN: permissão "${permission}" não existe.`);
  return { role: change.role, grants, revokes };
}

export type AccessActor = { userId: string; role: TenantRole; permissions: readonly Permission[]; isAccountOwner: boolean };

/**
 * Regras de proteção de uma alteração de perfil/permissões. Lança `ACCESS_*` (403/409/422 na
 * borda). Ninguém altera o próprio acesso; ninguém concede o que não tem; só Administrador cria
 * Administrador; o Administrador principal nunca perde o perfil nem a gestão de acessos; a
 * empresa nunca fica sem Administrador ativo.
 */
export function assertAccessChangeAllowed(input: {
  actor: AccessActor;
  target: Pick<TenantMembership, "userId" | "role" | "isAccountOwner" | "status" | "permissionGrants" | "permissionRevokes">;
  next: AccessChange;
  activeOwnerCount: number;
}): void {
  const { actor, target, next } = input;
  if (!actor.permissions.includes("tenant_member:manage_permissions")) throw new Error("ACCESS_FORBIDDEN: você não pode alterar perfis e permissões.");
  if (actor.userId === target.userId) throw new Error("ACCESS_SELF_CHANGE_FORBIDDEN: ninguém pode alterar o próprio perfil ou as próprias permissões. Peça a outro administrador.");
  if ((next.role === "owner" || target.role === "owner") && actor.role !== "owner") throw new Error("ACCESS_FORBIDDEN: só um Administrador pode criar ou alterar outro Administrador.");
  const nextEffective = effectivePermissions(next.role, next.grants, next.revokes);
  // Só o que a alteração ACRESCENTA conta: o que a pessoa já tinha não é elevação de quem edita.
  const current = new Set(effectivePermissions(target.role, target.permissionGrants, target.permissionRevokes));
  const beyondActor = nextEffective.filter((permission) => !current.has(permission) && !actor.permissions.includes(permission));
  if (beyondActor.length) throw new Error(`ACCESS_ESCALATION_FORBIDDEN: você não pode conceder permissões que não possui (${beyondActor.slice(0, 3).join(", ")}).`);
  if (target.isAccountOwner) {
    if (next.role !== "owner") throw new Error("ACCESS_ACCOUNT_OWNER_PROTECTED: o Administrador principal não pode deixar de ser Administrador.");
    const lost = ACCOUNT_OWNER_PROTECTED_PERMISSIONS.filter((permission) => !nextEffective.includes(permission));
    if (lost.length) throw new Error("ACCESS_ACCOUNT_OWNER_PROTECTED: o Administrador principal não pode perder a gestão de usuários e acessos.");
  }
  if (target.role === "owner" && target.status === "active" && next.role !== "owner" && input.activeOwnerCount <= 1) {
    throw new Error("ACCESS_LAST_OWNER: a empresa precisa de pelo menos um Administrador ativo.");
  }
}

/** Desativar/remover: nunca o próprio usuário, nunca o Administrador principal, nunca o último Administrador ativo. */
export function assertMemberDeactivationAllowed(input: {
  actor: AccessActor;
  target: Pick<TenantMembership, "userId" | "role" | "isAccountOwner" | "status">;
  activeOwnerCount: number;
}): void {
  if (!input.actor.permissions.includes("tenant_member:manage")) throw new Error("ACCESS_FORBIDDEN: você não pode desativar ou remover usuários.");
  if (input.actor.userId === input.target.userId) throw new Error("ACCESS_SELF_CHANGE_FORBIDDEN: você não pode desativar nem remover o próprio usuário.");
  if (input.target.isAccountOwner) throw new Error("ACCESS_ACCOUNT_OWNER_PROTECTED: o Administrador principal não pode ser desativado nem removido.");
  if (input.target.role === "owner" && input.actor.role !== "owner") throw new Error("ACCESS_FORBIDDEN: só um Administrador pode desativar ou remover outro Administrador.");
  if (input.target.role === "owner" && input.target.status === "active" && input.activeOwnerCount <= 1) throw new Error("ACCESS_LAST_OWNER: a empresa precisa de pelo menos um Administrador ativo.");
}

/** De onde vem cada permissão efetiva — para a UI mostrar "do perfil", "adicionada" ou "removida". */
export function describeAccess(membership: Pick<TenantMembership, "role" | "permissionGrants" | "permissionRevokes">): { permission: Permission; enabled: boolean; origin: "profile" | "granted" | "revoked" | "none" }[] {
  const preset = new Set<string>(ROLE_PERMISSIONS[membership.role]);
  const grants = new Set(membership.permissionGrants);
  const revokes = new Set(membership.permissionRevokes);
  return PERMISSIONS.map((permission) => {
    if (revokes.has(permission)) return { permission, enabled: false, origin: "revoked" as const };
    if (grants.has(permission)) return { permission, enabled: true, origin: "granted" as const };
    if (preset.has(permission)) return { permission, enabled: true, origin: "profile" as const };
    return { permission, enabled: false, origin: "none" as const };
  });
}
