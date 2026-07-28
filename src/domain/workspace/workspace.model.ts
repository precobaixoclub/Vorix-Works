/**
 * Workspace — Sprint 02 (Fase 3), fundação de domínio, sem regra de negócio complexa.
 *
 * Representa uma empresa, marca ou cliente — a unidade central de organização do produto,
 * distinta do Tenant (Valentina): um Tenant é a conta que paga e tem plano/créditos; um Workspace
 * é uma marca/cliente gerenciado por trás dessa conta. A relação é 1 Tenant : N Workspaces — uma
 * agência (1 Tenant) poderá gerenciar vários clientes/marcas (N Workspaces) sob a mesma conta,
 * algo que o modelo atual da Valentina (1 tenant : 1 clientId) não permite sozinho. Ver o
 * Relatório da Sprint 02 para o raciocínio completo.
 *
 * Todo campo "rico" (identidade, Creative DNA, campanhas, calendário, ativos, histórico,
 * conhecimento) é representado aqui como REFERÊNCIA (id/escopo), nunca como dado embutido — o
 * mesmo princípio já usado em todo o resto do projeto (ex.: Clara nunca duplica o que já vive em
 * Valentina). Quem quiser os dados completos consulta o módulo dono através da própria porta dele
 * (Clara para conhecimento/identidade, Campaign Manager para campanhas/calendário, Asset Library
 * — Fase 4 — para ativos). "Histórico" não é um campo aqui: é, por natureza, um log de eventos
 * (`ZunoEvent`) filtrado por `workspaceId`, não um array armazenado no próprio Workspace.
 */

export const WORKSPACE_STATUSES = ["active", "archived"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/**
 * Papel de um membro dentro do Workspace — vocabulário preparado para a Sprint 04 (usuários reais
 * / autenticação). Nenhuma verificação de permissão usa isso ainda; é só o formato do dado.
 */
export const WORKSPACE_MEMBER_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number];

/**
 * `userId` referencia um futuro `User` (ainda inexistente — ver Relatório da Sprint 01, "usuários
 * (plural) por tenant: confirmado que não existe"). Mantido como string opaca de propósito, para
 * não inventar um tipo `User` fora de contexto nesta sprint.
 */
export type WorkspaceMember = {
  userId: string;
  role: WorkspaceMemberRole;
  addedAt: string;
};

/**
 * Referência a uma integração de rede social conectada ao Workspace. `channel` espelha por
 * convenção o vocabulário de `SocialChannel` (`social-publisher.port.ts`) sem importar o tipo —
 * mesmo padrão de espelhamento já usado entre Sofia/Bianca/Pedro (ADR 0002 não se aplica aqui,
 * pois não são Skills, mas o espírito de baixo acoplamento se mantém).
 */
export type WorkspaceIntegrationRef = {
  channel: string;
  status: "connected" | "disconnected" | "pending";
  connectedAt?: string;
};

export type WorkspaceSettings = {
  timezone?: string;
  language?: string;
  defaultAspectRatio?: string;
};

/**
 * Referência ao escopo de conhecimento/identidade da Clara para este Workspace — nunca embute o
 * `ClaraKnowledgeRecord` em si. `clientId` é o mesmo campo que `ClaraKnowledgeBase.clientId` já
 * usa hoje; um Workspace real precisará decidir, numa sprint futura, se `clientId` da Clara passa
 * a ser o próprio `Workspace.id` ou continua um conceito à parte — decisão explicitamente adiada
 * (ver "Decisões tomadas" no relatório).
 */
export type WorkspaceKnowledgeRef = {
  clientId: string;
};

export type Workspace = {
  id: string;
  /** FK para `TenantRecord.id` (Valentina) — o Workspace sempre vive sob uma conta. */
  tenantId: string;
  name: string;
  /** Livre por enquanto ("empresa" | "marca" | "cliente", texto solto) — sem enum imposto nesta sprint. */
  kind?: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;

  /** Referência ao escopo de conhecimento/identidade na Clara — ver `WorkspaceKnowledgeRef`. */
  knowledge?: WorkspaceKnowledgeRef;
  /** Ids de `CampaignPlan` (Campaign Manager) pertencentes a este Workspace — calendário é derivado de lá, nunca duplicado aqui. */
  campaignIds: string[];
  /** Preenchido na Fase 4 desta mesma sprint — FK para `AssetLibrary.id`. */
  assetLibraryId?: string;
  integrations: WorkspaceIntegrationRef[];
  members: WorkspaceMember[];
  settings: WorkspaceSettings;
};
