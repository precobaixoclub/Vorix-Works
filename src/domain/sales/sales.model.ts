import type { ApprovalReason, BillingType } from "./pricing.js";

/**
 * Sales Engine (Vorix Conversas) — entidades que evoluem o CRM existente (Product/Deal/Proposal)
 * em vez de criar módulos paralelos. Tudo multi-tenant: toda linha carrega `tenantId` +
 * `workspaceId` e todo acesso passa por guard de tenant/workspace (404, nunca 403).
 */

export type ProductVariant = {
  /** Variantes legadas mantêm preço próprio; grades novas podem herdar o preço atual do Product. */
  priceOverride?:boolean;
  optionValues?: Record<string, string>;
  stockQuantity?: number;
  reservedQuantity?: number;
  imageUrl?: string;
  id: string;
  tenantId: string;
  workspaceId: string;
  productId: string;
  name: string;
  code?: string;
  costCents?: number;
  listPriceCents: number;
  minimumPriceCents?: number;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type PriceBook = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  description?: string;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PriceBookItem = {
  id: string;
  priceBookId: string;
  productId: string;
  variantId?: string;
  listPriceCents: number;
  minimumPriceCents?: number;
};

/** Item da oportunidade com SNAPSHOT comercial: mudar o catálogo depois nunca altera o histórico. */
export type DealItem = {
  productContextSnapshot?: { attributes?:Record<string,string|number|boolean>; options?:Record<string,string>;optionLabels?:Record<string,string>; imageUrl?:string };
  id: string;
  tenantId: string;
  workspaceId: string;
  dealId: string;
  productId?: string;
  variantId?: string;
  position: number;
  productNameSnapshot: string;
  productCodeSnapshot?: string;
  billingTypeSnapshot: BillingType;
  unitSnapshot?: string;
  quantity: number;
  unitCostCentsSnapshot?: number;
  listPriceCentsSnapshot: number;
  minimumPriceCentsSnapshot?: number;
  proposedUnitPriceCents: number;
  subtotalListCents: number;
  subtotalProposedCents: number;
  subtotalCostCents?: number;
  discountCents: number;
  grossProfitCents?: number;
  grossMarginBp?: number;
  commissionTypeSnapshot?: "percent" | "fixed";
  commissionValueSnapshot?: number;
  createdAt: string;
  updatedAt: string;
};

export const PARTICIPANT_ROLES = ["decision_maker", "influencer", "user", "financial", "other"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export type DealParticipant = {
  id: string;
  dealId: string;
  contactId: string;
  role: ParticipantRole;
  createdAt: string;
};

export const CUSTOM_FIELD_TYPES = ["text", "number", "currency", "date", "select", "multi_select", "boolean"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type DealCustomFieldDefinition = {
  id: string;
  tenantId: string;
  workspaceId: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: readonly string[];
  position: number;
  active: boolean;
};

export const CLOSE_REASON_KINDS = ["won", "lost", "proposal_decline"] as const;
export type CloseReasonKind = (typeof CLOSE_REASON_KINDS)[number];

export type CloseReason = {
  id: string;
  workspaceId: string;
  kind: CloseReasonKind;
  label: string;
  position: number;
  active: boolean;
};

/** Motivos iniciais — semeados na primeira leitura do workspace, depois 100% editáveis. */
export const DEFAULT_CLOSE_REASONS: Record<CloseReasonKind, readonly string[]> = {
  lost: ["Preço", "Concorrente", "Sem orçamento", "Sem retorno", "Projeto adiado", "Produto não atende", "Decisão interna", "Outro"],
  won: ["Preço", "Relacionamento", "Produto", "Agilidade", "Funcionalidade", "Condição comercial", "Outro"],
  proposal_decline: ["Preço", "Condição", "Prazo", "Concorrente", "Não tenho interesse", "Outro"],
};

export type Competitor = {
  id: string;
  workspaceId: string;
  name: string;
  active: boolean;
};

export const DEAL_VISIBILITY_MODES = ["all", "team", "own"] as const;
export type DealVisibilityMode = (typeof DEAL_VISIBILITY_MODES)[number];

export type CommercialSettings = {
  workspaceId: string;
  tenantId: string;
  /** Editores (vendedores) veem custo? Admin/owner sempre veem. */
  sellersCanViewCost: boolean;
  /** Editores veem margem/lucro? Admin/owner sempre veem. */
  sellersCanViewMargin: boolean;
  /** Quem vê quais oportunidades: `all` (padrão, comportamento atual), `team` ou `own`. */
  dealVisibility: DealVisibilityMode;
  /** Aceite da proposta marca a oportunidade como ganha? Padrão NÃO (aceite ≠ venda concluída). */
  proposalAcceptAutoWin: boolean;
  proposalWhatsappTemplate?: string;
  proposalReminderTemplate?: string;
  defaultContractMonths?: number;
  rankingEnabled: boolean;
  updatedAt: string;
};

export const DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE = "Olá, {{nome}}!\n\nSua proposta comercial está disponível.\n\nValor: {{valor}}\nValidade: {{validade}}\n\nClique para visualizar:\n{{proposal_link}}";
export const DEFAULT_PROPOSAL_REMINDER_TEMPLATE = "Olá, {{nome}}! Passando para lembrar da proposta que enviamos ({{valor}}). Ficou alguma dúvida?\n\n{{proposal_link}}";

export const POLICY_SCOPE_TYPES = ["workspace", "role", "team", "user"] as const;
export type PolicyScopeType = (typeof POLICY_SCOPE_TYPES)[number];

export type CommercialPolicy = {
  id: string;
  tenantId: string;
  workspaceId: string;
  scopeType: PolicyScopeType;
  /** Papel (`editor`/`admin`...), id da equipe ou id do usuário; ausente no escopo workspace. */
  scopeId?: string;
  minMarginBp?: number;
  maxDiscountBp?: number;
  allowBelowMinimum: boolean;
  createdAt: string;
  updatedAt: string;
};

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type CommercialApprovalRequest = {
  id: string;
  tenantId: string;
  workspaceId: string;
  dealId: string;
  proposalId?: string;
  requestedByUserId: string;
  status: ApprovalStatus;
  justification?: string;
  termsFingerprint: string;
  reasons: readonly ApprovalReason[];
  /** Números no momento do pedido (tabela, mínimo, solicitado, custo, margens, desconto, cliente). */
  snapshot: Readonly<Record<string, unknown>>;
  decidedByUserId?: string;
  decidedAt?: string;
  decisionReason?: string;
  approvedValueCents?: number;
  createdAt: string;
  updatedAt: string;
};
