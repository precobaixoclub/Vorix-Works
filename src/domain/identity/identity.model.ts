/**
 * Domínio de Identidade — Sprint 05 (Fase 1). O Zuno deixa de operar em modo de desenvolvimento
 * (DEV_PRINCIPAL fixo por processo, Sprint 03) e passa a ter identidade própria: usuários reais,
 * com senha, sessão e papel por conta. Nenhum tipo aqui depende de Fastify, JWT ou qualquer
 * biblioteca — é puro domínio; a borda HTTP (Fase 3/4) e os adapters (bcrypt/jsonwebtoken) vivem
 * em `src/infrastructure/auth/`, nunca aqui.
 *
 * RESPONSABILIDADES DE CADA ENTIDADE:
 *
 * - `User`: identidade real, autenticável — quem faz login. Dona de credenciais (email + hash de
 *   senha). Não pertence a nenhum Tenant por si só; ganha acesso a Tenants através de `Membership`.
 *   Um `User` sem nenhuma `Membership` consegue fazer login (senha válida), mas não enxerga
 *   nenhum Workspace — autenticação e autorização são camadas distintas de propósito.
 *
 * - `Tenant`: NÃO é um tipo novo desta sprint — continua sendo o `TenantRecord` da Valentina
 *   (`src/application/tenancy/`), em JSON, fora de escopo para migrar aqui. Identidade só
 *   referencia `tenantId` como string solta (mesmo padrão já usado por `Workspace.tenantId` desde
 *   a Sprint 02) — nunca uma FK real, porque a tabela `tenants` não existe em Postgres.
 *
 * - `TenantMembership`: a relação entre `User` e Tenant, carregando o `TenantRole`. Responde "a
 *   quais Tenants este usuário tem acesso, e com que autoridade em cada um". Um usuário pode
 *   pertencer a vários Tenants (ex.: freelancer que atende duas agências) — é essa pluralidade que
 *   justifica o Workspace/Tenant Switcher da Fase 6. Distinta de `WorkspaceMember`
 *   (`workspace.model.ts`, Sprint 02) — aquela é uma granularidade mais fina (por Workspace
 *   individual) que nenhum caso de uso ainda usa; `TenantMembership` é o nível que esta sprint
 *   realmente aplica (RBAC por conta, não por Workspace dentro da conta).
 *
 * - `UserSession`: um "episódio" de login contínuo (um navegador/dispositivo autenticado).
 *   Responsabilidade: permitir logout, "sair de todos os lugares", e trilha de auditoria de
 *   instâncias de login. Todo `RefreshToken` pertence a exatamente uma `UserSession` — revogar a
 *   sessão revoga todos os refresh tokens dela de uma vez.
 *
 * - `RefreshToken`: credencial opaca de longa duração que sustenta uma sessão além da expiração
 *   do access token (JWT), sem exigir novo login. Sempre armazenado com HASH (nunca o valor bruto)
 *   — mesmo raciocínio de segurança de senha. Rotacionado a cada uso (ver `refresh.usecase.ts`):
 *   usar um refresh token já revogado é tratado como reuse/replay e revoga a sessão inteira.
 *
 * - `Permission`: a menor unidade de "o que pode ser feito" (ex.: `workspace:create`). NÃO é uma
 *   tabela no banco nesta sprint — é um enum de código mais um mapa fixo `ROLE_PERMISSIONS`,
 *   porque o conjunto de papéis é fechado (Owner/Admin/Editor/Viewer, exatamente os 4 pedidos no
 *   PROMPT 05) e não existe hoje nenhum requisito de permissão customizada por conta. Decisão
 *   deliberada — ver Relatório da Sprint 05, "Decisões tomadas".
 *
 * - `TenantRole`: o papel atribuído a uma `TenantMembership`, que determina o pacote de
 *   `Permission`s daquele usuário naquele Tenant. Mesmo raciocínio de `Permission`: enum fixo
 *   (constraint `check` no banco), não uma tabela `roles` — não há necessidade de papéis
 *   dinâmicos ainda.
 *
 * - `AuthPrincipal`: NUNCA persistido. É o valor efêmero, por requisição, reconstruído a partir de
 *   um access token (JWT) válido — quem está fazendo esta requisição, em qual Tenant, com que
 *   papel. Por ser derivado de um JWT assinado, sua reconstrução é uma operação pura e sem acesso
 *   a banco a cada requisição (só o refresh token é consultado no banco a cada uso — é essa
 *   assimetria que justifica JWT para o access token e token opaco para o refresh).
 */

export const TENANT_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const PERMISSIONS = [
  "workspace:read",
  "workspace:create",
  "workspace:update",
  "workspace:transition",
  // Sprint 06 — Conversation é a interface principal do produto (PROMPT 06, Objetivo); liberada
  // para os 4 papéis, inclusive viewer. Diferente de Workspace (gestão de conta), conversar não é
  // uma ação administrativa.
  "conversation:read",
  "conversation:create",
  "conversation:message",
  // Sprint 09 — Planning é só leitura (nenhum caso de uso cria/atualiza/executa nada), mesmo
  // raciocínio de Conversation: visualizar um plano não é uma ação administrativa, liberada para
  // os 4 papéis.
  "planning:read",
  // Sprint 10 — Runtime é só leitura, mesmo raciocínio de Planning: visualizar um RuntimePlan
  // traduzido não é uma ação administrativa.
  "runtime:read",
  // Sprint 12 — ExecutionRun pode ser dry_run ou real controlado por feature flag. Leitura é
  // ampla; criação/início/cancelamento/aprovação ficam restritos a papéis que operam o Workspace.
  "execution:read",
  "execution:create",
  "execution:start",
  "execution:cancel",
  "execution:approve",
  "publication:read",
  "publication:create",
  "publication:approve",
  "publication:publish",
  "publication:cancel",
  "publication:operate",
  "publication:reconcile",
  "publication:admin",
  "credential:read",
  "credential:update",
  "credential:rotate",
  "credential:revoke",
  "credential:connect",
  "credential:disconnect",
  "audit:read",
  "provider:operate",
  "schedule:read",
  "schedule:create",
  "schedule:update",
  "schedule:cancel",
  "schedule:pause",
  "schedule:resume",
  "schedule:reprocess",
  "calendar:read",
  "scheduling:operate",
  "scheduling:dead_letter:read",
  "scheduling:dead_letter:reprocess",
  "analytics:read",
  "analytics:query",
  "analytics:export",
  "analytics:operate",
  "analytics:rebuild",
  "analytics:data_quality:read",
  "analytics:alerts:read",
  "analytics:alerts:update",
  "analytics:admin",
  "system:operate",
  "asset:read",
  "asset:create",
  "asset:update",
  // Módulo Meta Ads Manager (Fase 1) — deliberadamente separado de `publication:*`: uma conta de
  // anúncios não é um canal de conteúdo, e conectar/gerenciar anúncios pagos merece um degrau de
  // permissão mais alto que "criar uma publicação" (mesmo raciocínio de `credential:connect`
  // ficar só em admin/owner — ver `CREDENTIAL_OPERATOR_PERMISSIONS`).
  "ads:read",
  "ads:connect",
  "ads:disconnect",
  "ads:sync",
  "ads:manage",
  // Módulo Instagram DM Automation (Fase 5) — ler/responder DM é mais parecido com operar
  // publicação (`publication:*`) do que com Ads; `automation_manage` fica num degrau acima porque
  // uma regra mal configurada manda mensagem automática pra clientes reais sem revisão humana.
  "instagram_dm:read",
  "instagram_dm:reply",
  "instagram_dm:automation_manage",
  // Módulo Conversas (Fase 1) — inbox de WhatsApp via WuzAPI. `manage_connections` fica num degrau
  // acima de `reply`/`assign` porque criar/desconectar uma conexão WhatsApp é uma ação de
  // infraestrutura da conta (mesmo raciocínio de `credential:connect` ficar só em admin/owner);
  // `manage_ai` também fica restrito porque decide se uma automação responde clientes reais sem
  // revisão humana (mesmo raciocínio de `instagram_dm:automation_manage`).
  "inbox:read",
  "inbox:reply",
  "inbox:assign",
  "inbox:manage_connections",
  "inbox:manage_ai",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CONVERSATION_PERMISSIONS: readonly Permission[] = ["conversation:read", "conversation:create", "conversation:message"];
const PLANNING_PERMISSIONS: readonly Permission[] = ["planning:read"];
const RUNTIME_PERMISSIONS: readonly Permission[] = ["runtime:read"];
const EXECUTION_READ_PERMISSIONS: readonly Permission[] = ["execution:read"];
const EXECUTION_WRITE_PERMISSIONS: readonly Permission[] = ["execution:create", "execution:start", "execution:cancel", "execution:approve"];
const PUBLICATION_READ_PERMISSIONS: readonly Permission[] = ["publication:read"];
const PUBLICATION_EDITOR_PERMISSIONS: readonly Permission[] = ["publication:create"];
const PUBLICATION_OPERATOR_PERMISSIONS: readonly Permission[] = ["publication:approve", "publication:publish", "publication:cancel", "publication:operate", "publication:reconcile"];
const PUBLICATION_ADMIN_PERMISSIONS: readonly Permission[] = ["publication:admin"];
const CREDENTIAL_READ_PERMISSIONS: readonly Permission[] = ["credential:read"];
const CREDENTIAL_OPERATOR_PERMISSIONS: readonly Permission[] = ["credential:update", "credential:rotate", "credential:revoke", "credential:connect", "credential:disconnect", "provider:operate"];
const AUDIT_READ_PERMISSIONS: readonly Permission[] = ["audit:read"];
const SCHEDULING_READ_PERMISSIONS: readonly Permission[] = ["schedule:read", "calendar:read"];
const SCHEDULING_EDITOR_PERMISSIONS: readonly Permission[] = ["schedule:create", "schedule:update"];
const SCHEDULING_OPERATOR_PERMISSIONS: readonly Permission[] = ["schedule:cancel", "schedule:pause", "schedule:resume", "schedule:reprocess", "scheduling:operate", "scheduling:dead_letter:read", "scheduling:dead_letter:reprocess"];
const ANALYTICS_READ_PERMISSIONS: readonly Permission[] = ["analytics:read", "analytics:query", "analytics:data_quality:read", "analytics:alerts:read"];
const ANALYTICS_OPERATOR_PERMISSIONS: readonly Permission[] = ["analytics:export", "analytics:operate", "analytics:rebuild", "analytics:alerts:update", "analytics:admin"];
const SYSTEM_OPERATOR_PERMISSIONS: readonly Permission[] = ["system:operate"];
const ASSET_READ_PERMISSIONS: readonly Permission[] = ["asset:read"];
const ASSET_EDITOR_PERMISSIONS: readonly Permission[] = ["asset:create", "asset:update"];
const ADS_READ_PERMISSIONS: readonly Permission[] = ["ads:read"];
const ADS_OPERATOR_PERMISSIONS: readonly Permission[] = ["ads:sync"];
const ADS_ADMIN_PERMISSIONS: readonly Permission[] = ["ads:connect", "ads:disconnect", "ads:manage"];
const INSTAGRAM_DM_READ_PERMISSIONS: readonly Permission[] = ["instagram_dm:read"];
const INSTAGRAM_DM_OPERATOR_PERMISSIONS: readonly Permission[] = ["instagram_dm:reply"];
const INSTAGRAM_DM_ADMIN_PERMISSIONS: readonly Permission[] = ["instagram_dm:automation_manage"];
const INBOX_READ_PERMISSIONS: readonly Permission[] = ["inbox:read"];
const INBOX_OPERATOR_PERMISSIONS: readonly Permission[] = ["inbox:reply", "inbox:assign"];
const INBOX_ADMIN_PERMISSIONS: readonly Permission[] = ["inbox:manage_connections", "inbox:manage_ai"];

/**
 * Permissões mínimas pedidas na Fase 4 (Sprint 05). Gradiente deliberado para que RBAC seja
 * testável de forma significativa: viewer só lê Workspace; editor lê e atualiza; admin/owner
 * fazem tudo, incluindo criar Workspace e executar transições de status. Conversation (Sprint 06)
 * é igual para todos os papéis — ver comentário acima de `PERMISSIONS`.
 */
export const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  viewer: ["workspace:read", ...CONVERSATION_PERMISSIONS, ...PLANNING_PERMISSIONS, ...RUNTIME_PERMISSIONS, ...EXECUTION_READ_PERMISSIONS, ...PUBLICATION_READ_PERMISSIONS, ...SCHEDULING_READ_PERMISSIONS, ...ANALYTICS_READ_PERMISSIONS, ...ASSET_READ_PERMISSIONS, ...ADS_READ_PERMISSIONS, ...INSTAGRAM_DM_READ_PERMISSIONS, ...INBOX_READ_PERMISSIONS],
  editor: ["workspace:read", "workspace:update", ...CONVERSATION_PERMISSIONS, ...PLANNING_PERMISSIONS, ...RUNTIME_PERMISSIONS, ...EXECUTION_READ_PERMISSIONS, ...EXECUTION_WRITE_PERMISSIONS, ...PUBLICATION_READ_PERMISSIONS, ...PUBLICATION_EDITOR_PERMISSIONS, ...SCHEDULING_READ_PERMISSIONS, ...SCHEDULING_EDITOR_PERMISSIONS, ...ANALYTICS_READ_PERMISSIONS, ...ASSET_READ_PERMISSIONS, ...ASSET_EDITOR_PERMISSIONS, ...ADS_READ_PERMISSIONS, ...ADS_OPERATOR_PERMISSIONS, ...INSTAGRAM_DM_READ_PERMISSIONS, ...INSTAGRAM_DM_OPERATOR_PERMISSIONS, ...INBOX_READ_PERMISSIONS, ...INBOX_OPERATOR_PERMISSIONS],
  admin: ["workspace:read", "workspace:create", "workspace:update", "workspace:transition", ...CONVERSATION_PERMISSIONS, ...PLANNING_PERMISSIONS, ...RUNTIME_PERMISSIONS, ...EXECUTION_READ_PERMISSIONS, ...EXECUTION_WRITE_PERMISSIONS, ...PUBLICATION_READ_PERMISSIONS, ...PUBLICATION_EDITOR_PERMISSIONS, ...PUBLICATION_OPERATOR_PERMISSIONS, ...PUBLICATION_ADMIN_PERMISSIONS, ...CREDENTIAL_READ_PERMISSIONS, ...CREDENTIAL_OPERATOR_PERMISSIONS, ...AUDIT_READ_PERMISSIONS, ...SCHEDULING_READ_PERMISSIONS, ...SCHEDULING_EDITOR_PERMISSIONS, ...SCHEDULING_OPERATOR_PERMISSIONS, ...ANALYTICS_READ_PERMISSIONS, ...ANALYTICS_OPERATOR_PERMISSIONS, ...SYSTEM_OPERATOR_PERMISSIONS, ...ASSET_READ_PERMISSIONS, ...ASSET_EDITOR_PERMISSIONS, ...ADS_READ_PERMISSIONS, ...ADS_OPERATOR_PERMISSIONS, ...ADS_ADMIN_PERMISSIONS, ...INSTAGRAM_DM_READ_PERMISSIONS, ...INSTAGRAM_DM_OPERATOR_PERMISSIONS, ...INSTAGRAM_DM_ADMIN_PERMISSIONS, ...INBOX_READ_PERMISSIONS, ...INBOX_OPERATOR_PERMISSIONS, ...INBOX_ADMIN_PERMISSIONS],
  owner: ["workspace:read", "workspace:create", "workspace:update", "workspace:transition", ...CONVERSATION_PERMISSIONS, ...PLANNING_PERMISSIONS, ...RUNTIME_PERMISSIONS, ...EXECUTION_READ_PERMISSIONS, ...EXECUTION_WRITE_PERMISSIONS, ...PUBLICATION_READ_PERMISSIONS, ...PUBLICATION_EDITOR_PERMISSIONS, ...PUBLICATION_OPERATOR_PERMISSIONS, ...PUBLICATION_ADMIN_PERMISSIONS, ...CREDENTIAL_READ_PERMISSIONS, ...CREDENTIAL_OPERATOR_PERMISSIONS, ...AUDIT_READ_PERMISSIONS, ...SCHEDULING_READ_PERMISSIONS, ...SCHEDULING_EDITOR_PERMISSIONS, ...SCHEDULING_OPERATOR_PERMISSIONS, ...ANALYTICS_READ_PERMISSIONS, ...ANALYTICS_OPERATOR_PERMISSIONS, ...SYSTEM_OPERATOR_PERMISSIONS, ...ASSET_READ_PERMISSIONS, ...ASSET_EDITOR_PERMISSIONS, ...ADS_READ_PERMISSIONS, ...ADS_OPERATOR_PERMISSIONS, ...ADS_ADMIN_PERMISSIONS, ...INSTAGRAM_DM_READ_PERMISSIONS, ...INSTAGRAM_DM_OPERATOR_PERMISSIONS, ...INSTAGRAM_DM_ADMIN_PERMISSIONS, ...INBOX_READ_PERMISSIONS, ...INBOX_OPERATOR_PERMISSIONS, ...INBOX_ADMIN_PERMISSIONS],
};

export function hasPermission(role: TenantRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(role: TenantRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`IDENTITY_FORBIDDEN: papel "${role}" não tem a permissão "${permission}".`);
  }
}

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export type User = {
  id: string;
  email: string;
  /** Hash (bcrypt) — nunca a senha em texto puro. Ver `PasswordHasherPort`. */
  passwordHash: string;
  name: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  /** Superadmin da plataforma — cross-tenant. ÚNICO papel que enxerga `/admin` e mexe em
   * billing/plano/créditos de outros tenants. Ortogonal ao `TenantRole` (que é escopo
   * Tenant/Workspace). Sprint 25. */
  isPlatformAdmin: boolean;
};

export type TenantMembership = {
  id: string;
  userId: string;
  /** Referência solta ao Tenant da Valentina (JSON) — ver nota da entidade acima. */
  tenantId: string;
  role: TenantRole;
  createdAt: string;
  updatedAt: string;
};

export type UserSession = {
  id: string;
  userId: string;
  /** Tenant "ativo" desta sessão — o que o próximo `refresh` (e qualquer novo access token) vai
   * usar. Atualizado pelo Tenant Switcher (Fase 6); nunca lido diretamente por uma rota de
   * negócio — só existe para o fluxo de autenticação saber "em qual tenant este refresh deve
   * emitir o próximo token", sem precisar decodificar um access token expirado para descobrir. */
  activeTenantId: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string;
  userAgent?: string;
  ipAddress?: string;
};

export type RefreshToken = {
  id: string;
  sessionId: string;
  userId: string;
  /** SHA-256 do valor bruto do token — o valor bruto nunca é persistido, só devolvido uma vez ao cliente no momento da emissão. */
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  /** Preenchido quando este token é rotacionado — aponta para o token que o substituiu. Usado para detectar replay. */
  replacedByTokenId?: string;
};

/**
 * Reconstruído a partir de um JWT válido (ver `AuthPort.verifyToken`, `infrastructure/auth/jwt-auth-adapter.ts`).
 * `sessionId` permite correlacionar a requisição com a `UserSession`/auditoria sem consultar o
 * usuário/membership no banco a cada chamada.
 */
export type AuthPrincipal = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  sessionId: string;
  /** Superadmin da plataforma — propaga do JWT para rotas `/v1/admin/*`. Default `false`
   * quando o claim não veio no token (compatibilidade com tokens antigos). Sprint 25. */
  isPlatformAdmin: boolean;
};
