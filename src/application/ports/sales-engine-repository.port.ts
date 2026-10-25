import type {
  CloseReason,
  CloseReasonKind,
  CommercialApprovalRequest,
  CommercialPolicy,
  CommercialSettings,
  Competitor,
  CustomFieldType,
  DealCustomFieldDefinition,
  DealItem,
  DealParticipant,
  ParticipantRole,
  PolicyScopeType,
  PriceBook,
  PriceBookItem,
  ProductVariant,
} from "../../domain/sales/sales.model.js";
import type { ApprovalReason } from "../../domain/sales/pricing.js";

export type CreateProductVariantInput = Omit<ProductVariant, "id" | "createdAt" | "updatedAt" | "active" | "position"> & { active?: boolean; position?: number };

export type UpdateProductVariantInput = Partial<Pick<ProductVariant, "name" | "code" | "listPriceCents" | "active" | "position" | "optionValues" | "priceOverride">> & {costCents?:number|null;minimumPriceCents?:number|null;imageUrl?:string|null};

export type SalesCatalogRepositoryPort = {
  listVariants(productId: string): Promise<ProductVariant[]>;
  getVariant(id: string): Promise<ProductVariant | undefined>;
  createVariant(input: CreateProductVariantInput): Promise<ProductVariant>;
  createVariantGrid(input: CreateProductVariantInput[]): Promise<ProductVariant[]>;
  updateVariant(id: string, patch: UpdateProductVariantInput): Promise<ProductVariant>;
  deleteVariant(id: string): Promise<void>;
  listPriceBooks(input: { tenantId: string; workspaceId: string }): Promise<PriceBook[]>;
  getPriceBook(id: string): Promise<PriceBook | undefined>;
  createPriceBook(input: { tenantId: string; workspaceId: string; name: string; description?: string; currency?: string }): Promise<PriceBook>;
  updatePriceBook(id: string, patch: Partial<Pick<PriceBook, "name" | "description" | "active">>): Promise<PriceBook>;
  deletePriceBook(id: string): Promise<void>;
  listPriceBookItems(priceBookId: string): Promise<PriceBookItem[]>;
  upsertPriceBookItem(input: { priceBookId: string; productId: string; variantId?: string; listPriceCents: number; minimumPriceCents?: number }): Promise<PriceBookItem>;
  deletePriceBookItem(id: string): Promise<void>;
  /** Preço da tabela para produto/variação; tenta a variação e cai para o produto. */
  resolvePriceBookItem(priceBookId: string, productId: string, variantId?: string): Promise<PriceBookItem | undefined>;
};

export type CreateDealItemInput = Omit<DealItem, "id" | "createdAt" | "updatedAt">;

export type DealItemRepositoryPort = {
  listByDeal(dealId: string): Promise<DealItem[]>;
  listByDeals(dealIds: readonly string[]): Promise<DealItem[]>;
  getById(id: string): Promise<DealItem | undefined>;
  create(input: CreateDealItemInput): Promise<DealItem>;
  replace(id: string, input: CreateDealItemInput): Promise<DealItem>;
  delete(id: string): Promise<void>;
};

export type SalesConfigRepositoryPort = {
  getSettings(workspaceId: string): Promise<CommercialSettings | undefined>;
  upsertSettings(input: { tenantId: string; workspaceId: string } & Partial<Omit<CommercialSettings, "tenantId" | "workspaceId" | "updatedAt">>): Promise<CommercialSettings>;
  listPolicies(input: { tenantId: string; workspaceId: string }): Promise<CommercialPolicy[]>;
  upsertPolicy(input: { tenantId: string; workspaceId: string; scopeType: PolicyScopeType; scopeId?: string; minMarginBp?: number | null; maxDiscountBp?: number | null; allowBelowMinimum?: boolean }): Promise<CommercialPolicy>;
  deletePolicy(id: string): Promise<void>;
  getPolicy(id: string): Promise<CommercialPolicy | undefined>;
  listCloseReasons(input: { tenantId: string; workspaceId: string; kind?: CloseReasonKind; includeInactive?: boolean }): Promise<CloseReason[]>;
  getCloseReason(id: string): Promise<(CloseReason & { tenantId: string }) | undefined>;
  createCloseReason(input: { tenantId: string; workspaceId: string; kind: CloseReasonKind; label: string; position?: number }): Promise<CloseReason>;
  updateCloseReason(id: string, patch: { label?: string; active?: boolean; position?: number }): Promise<CloseReason>;
  deleteCloseReason(id: string): Promise<void>;
  reorderCloseReasons(input: { tenantId: string; workspaceId: string; kind: CloseReasonKind; reasonIds: readonly string[] }): Promise<void>;
  countCloseReasons(workspaceId: string): Promise<number>;
  ensureDefaultCloseReasons(input: { tenantId: string; workspaceId: string; reasons: readonly { kind: CloseReasonKind; label: string; position: number }[] }): Promise<void>;
  listCompetitors(input: { tenantId: string; workspaceId: string; includeInactive?: boolean }): Promise<Competitor[]>;
  getCompetitor(id: string): Promise<(Competitor & { tenantId: string }) | undefined>;
  /** Idempotente por nome (case-insensitive). */
  upsertCompetitor(input: { tenantId: string; workspaceId: string; name: string }): Promise<Competitor>;
  updateCompetitor(id: string, patch: { name?: string; active?: boolean }): Promise<Competitor>;
  listCustomFields(input: { tenantId: string; workspaceId: string; includeInactive?: boolean }): Promise<DealCustomFieldDefinition[]>;
  getCustomField(id: string): Promise<DealCustomFieldDefinition | undefined>;
  createCustomField(input: { tenantId: string; workspaceId: string; key: string; label: string; fieldType: CustomFieldType; options?: readonly string[]; position?: number }): Promise<DealCustomFieldDefinition>;
  updateCustomField(id: string, patch: { label?: string; options?: readonly string[]; position?: number; active?: boolean }): Promise<DealCustomFieldDefinition>;
  listParticipants(dealId: string): Promise<DealParticipant[]>;
  upsertParticipant(input: { tenantId: string; workspaceId: string; dealId: string; contactId: string; role: ParticipantRole }): Promise<DealParticipant>;
  removeParticipant(dealId: string, contactId: string): Promise<void>;
};

export type CommercialApprovalRepositoryPort = {
  /** Idempotente: se já existe pedido PENDENTE para os mesmos termos da oportunidade, devolve ele. */
  createOrGetPending(input: { id: string; tenantId: string; workspaceId: string; dealId: string; proposalId?: string; requestedByUserId: string; justification?: string; termsFingerprint: string; reasons: readonly ApprovalReason[]; snapshot: Record<string, unknown> }): Promise<{ request: CommercialApprovalRequest; created: boolean }>;
  getById(id: string): Promise<CommercialApprovalRequest | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; status?: CommercialApprovalRequest["status"]; dealId?: string; limit?: number }): Promise<CommercialApprovalRequest[]>;
  /** Transição condicional (só sai de `pending`); devolve `undefined` se já foi decidido. */
  decide(id: string, input: { status: "approved" | "rejected" | "cancelled"; decidedByUserId: string; decisionReason?: string; approvedValueCents?: number }): Promise<CommercialApprovalRequest | undefined>;
  findApproved(dealId: string, termsFingerprint: string): Promise<CommercialApprovalRequest | undefined>;
};
