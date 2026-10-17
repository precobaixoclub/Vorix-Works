import type { Pool } from "pg";
import type {
  CommercialApprovalRepositoryPort,
  CreateDealItemInput,
  CreateProductVariantInput,
  DealItemRepositoryPort,
  SalesCatalogRepositoryPort,
  SalesConfigRepositoryPort,
} from "../../../application/ports/sales-engine-repository.port.js";
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
} from "../../../domain/sales/sales.model.js";
import type { ApprovalReason, BillingType } from "../../../domain/sales/pricing.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const num = (value: string | number | null | undefined): number | undefined => (value === null || value === undefined ? undefined : Number(value));
const iso = (value: Date | null | undefined): string | undefined => value?.toISOString();

// --------------------------------------------------------------------------------------------
// Catálogo: variações e tabelas de preço
// --------------------------------------------------------------------------------------------

type VariantRow = { id: string; tenant_id: string; workspace_id: string; product_id: string; name: string; code: string | null; cost_cents: string | null; list_price_cents: string; minimum_price_cents: string | null; active: boolean; position: number; created_at: Date; updated_at: Date };
const toVariant = (row: VariantRow): ProductVariant => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, productId: row.product_id, name: row.name, code: row.code ?? undefined,
  costCents: num(row.cost_cents), listPriceCents: Number(row.list_price_cents), minimumPriceCents: num(row.minimum_price_cents),
  active: row.active, position: row.position, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

type PriceBookRow = { id: string; tenant_id: string; workspace_id: string; name: string; description: string | null; currency: string; active: boolean; created_at: Date; updated_at: Date };
const toPriceBook = (row: PriceBookRow): PriceBook => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, name: row.name, description: row.description ?? undefined,
  currency: row.currency, active: row.active, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

type PriceBookItemRow = { id: string; price_book_id: string; product_id: string; variant_id: string | null; list_price_cents: string; minimum_price_cents: string | null };
const toPriceBookItem = (row: PriceBookItemRow): PriceBookItem => ({
  id: row.id, priceBookId: row.price_book_id, productId: row.product_id, variantId: row.variant_id ?? undefined,
  listPriceCents: Number(row.list_price_cents), minimumPriceCents: num(row.minimum_price_cents),
});

export class PostgresSalesCatalogRepository implements SalesCatalogRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listVariants(productId: string): Promise<ProductVariant[]> {
    const result = await this.pool.query<VariantRow>("select * from product_variants where product_id = $1 order by position, name", [productId]);
    return result.rows.map(toVariant);
  }

  async getVariant(id: string): Promise<ProductVariant | undefined> {
    const result = await this.pool.query<VariantRow>("select * from product_variants where id = $1", [id]);
    return result.rows[0] ? toVariant(result.rows[0]) : undefined;
  }

  async createVariant(input: CreateProductVariantInput): Promise<ProductVariant> {
    const result = await this.pool.query<VariantRow>(
      `insert into product_variants (id, tenant_id, workspace_id, product_id, name, code, cost_cents, list_price_cents, minimum_price_cents, active, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [newId("variant"), input.tenantId, input.workspaceId, input.productId, input.name, input.code ?? null, input.costCents ?? null, input.listPriceCents, input.minimumPriceCents ?? null, input.active ?? true, input.position ?? 0],
    );
    return toVariant(result.rows[0]);
  }

  async updateVariant(id: string, patch: Partial<Pick<ProductVariant, "name" | "code" | "costCents" | "listPriceCents" | "minimumPriceCents" | "active" | "position">>): Promise<ProductVariant> {
    const existing = await this.getVariant(id);
    if (!existing) throw new Error(`PRODUCT_VARIANT_NOT_FOUND: variação "${id}" não existe.`);
    const merged = { ...existing, ...patch };
    const result = await this.pool.query<VariantRow>(
      `update product_variants set name = $2, code = $3, cost_cents = $4, list_price_cents = $5, minimum_price_cents = $6, active = $7, position = $8, updated_at = now()
       where id = $1 returning *`,
      [id, merged.name, merged.code ?? null, merged.costCents ?? null, merged.listPriceCents, merged.minimumPriceCents ?? null, merged.active, merged.position],
    );
    return toVariant(result.rows[0]);
  }

  async deleteVariant(id: string): Promise<void> {
    await this.pool.query("delete from product_variants where id = $1", [id]);
  }

  async listPriceBooks(input: { tenantId: string; workspaceId: string }): Promise<PriceBook[]> {
    const result = await this.pool.query<PriceBookRow>("select * from price_books where tenant_id = $1 and workspace_id = $2 order by name", [input.tenantId, input.workspaceId]);
    return result.rows.map(toPriceBook);
  }

  async getPriceBook(id: string): Promise<PriceBook | undefined> {
    const result = await this.pool.query<PriceBookRow>("select * from price_books where id = $1", [id]);
    return result.rows[0] ? toPriceBook(result.rows[0]) : undefined;
  }

  async createPriceBook(input: { tenantId: string; workspaceId: string; name: string; description?: string; currency?: string }): Promise<PriceBook> {
    const result = await this.pool.query<PriceBookRow>(
      "insert into price_books (id, tenant_id, workspace_id, name, description, currency) values ($1, $2, $3, $4, $5, $6) returning *",
      [newId("pricebook"), input.tenantId, input.workspaceId, input.name, input.description ?? null, input.currency ?? "BRL"],
    );
    return toPriceBook(result.rows[0]);
  }

  async updatePriceBook(id: string, patch: Partial<Pick<PriceBook, "name" | "description" | "active">>): Promise<PriceBook> {
    const existing = await this.getPriceBook(id);
    if (!existing) throw new Error(`PRICE_BOOK_NOT_FOUND: tabela "${id}" não existe.`);
    const merged = { ...existing, ...patch };
    const result = await this.pool.query<PriceBookRow>(
      "update price_books set name = $2, description = $3, active = $4, updated_at = now() where id = $1 returning *",
      [id, merged.name, merged.description ?? null, merged.active],
    );
    return toPriceBook(result.rows[0]);
  }

  async deletePriceBook(id: string): Promise<void> {
    await this.pool.query("delete from price_books where id = $1", [id]);
  }

  async listPriceBookItems(priceBookId: string): Promise<PriceBookItem[]> {
    const result = await this.pool.query<PriceBookItemRow>("select * from price_book_items where price_book_id = $1 order by created_at", [priceBookId]);
    return result.rows.map(toPriceBookItem);
  }

  async upsertPriceBookItem(input: { priceBookId: string; productId: string; variantId?: string; listPriceCents: number; minimumPriceCents?: number }): Promise<PriceBookItem> {
    const result = await this.pool.query<PriceBookItemRow>(
      `insert into price_book_items (id, price_book_id, product_id, variant_id, list_price_cents, minimum_price_cents)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (price_book_id, product_id, coalesce(variant_id, ''))
       do update set list_price_cents = excluded.list_price_cents, minimum_price_cents = excluded.minimum_price_cents, updated_at = now()
       returning *`,
      [newId("pbitem"), input.priceBookId, input.productId, input.variantId ?? null, input.listPriceCents, input.minimumPriceCents ?? null],
    );
    return toPriceBookItem(result.rows[0]);
  }

  async deletePriceBookItem(id: string): Promise<void> {
    await this.pool.query("delete from price_book_items where id = $1", [id]);
  }

  async resolvePriceBookItem(priceBookId: string, productId: string, variantId?: string): Promise<PriceBookItem | undefined> {
    const result = await this.pool.query<PriceBookItemRow>(
      `select * from price_book_items where price_book_id = $1 and product_id = $2 and (variant_id = $3 or variant_id is null)
       order by (variant_id is null) asc limit 1`,
      [priceBookId, productId, variantId ?? null],
    );
    return result.rows[0] ? toPriceBookItem(result.rows[0]) : undefined;
  }
}

// --------------------------------------------------------------------------------------------
// Itens da oportunidade
// --------------------------------------------------------------------------------------------

type DealItemRow = {
  id: string; tenant_id: string; workspace_id: string; deal_id: string; product_id: string | null; variant_id: string | null; position: number;
  product_name_snapshot: string; product_code_snapshot: string | null; billing_type_snapshot: BillingType; unit_snapshot: string | null; quantity: string;
  unit_cost_cents_snapshot: string | null; list_price_cents_snapshot: string; minimum_price_cents_snapshot: string | null; proposed_unit_price_cents: string;
  subtotal_list_cents: string; subtotal_proposed_cents: string; subtotal_cost_cents: string | null; discount_cents: string; gross_profit_cents: string | null;
  gross_margin_bp: number | null; commission_type_snapshot: "percent" | "fixed" | null; commission_value_snapshot: string | null; created_at: Date; updated_at: Date;
};
const toDealItem = (row: DealItemRow): DealItem => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, dealId: row.deal_id, productId: row.product_id ?? undefined, variantId: row.variant_id ?? undefined,
  position: row.position, productNameSnapshot: row.product_name_snapshot, productCodeSnapshot: row.product_code_snapshot ?? undefined,
  billingTypeSnapshot: row.billing_type_snapshot, unitSnapshot: row.unit_snapshot ?? undefined, quantity: Number(row.quantity),
  unitCostCentsSnapshot: num(row.unit_cost_cents_snapshot), listPriceCentsSnapshot: Number(row.list_price_cents_snapshot),
  minimumPriceCentsSnapshot: num(row.minimum_price_cents_snapshot), proposedUnitPriceCents: Number(row.proposed_unit_price_cents),
  subtotalListCents: Number(row.subtotal_list_cents), subtotalProposedCents: Number(row.subtotal_proposed_cents), subtotalCostCents: num(row.subtotal_cost_cents),
  discountCents: Number(row.discount_cents), grossProfitCents: num(row.gross_profit_cents), grossMarginBp: row.gross_margin_bp ?? undefined,
  commissionTypeSnapshot: row.commission_type_snapshot ?? undefined, commissionValueSnapshot: num(row.commission_value_snapshot),
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

const DEAL_ITEM_COLUMNS = "product_id, variant_id, position, product_name_snapshot, product_code_snapshot, billing_type_snapshot, unit_snapshot, quantity, unit_cost_cents_snapshot, list_price_cents_snapshot, minimum_price_cents_snapshot, proposed_unit_price_cents, subtotal_list_cents, subtotal_proposed_cents, subtotal_cost_cents, discount_cents, gross_profit_cents, gross_margin_bp, commission_type_snapshot, commission_value_snapshot";
const dealItemValues = (input: CreateDealItemInput): unknown[] => [
  input.productId ?? null, input.variantId ?? null, input.position, input.productNameSnapshot, input.productCodeSnapshot ?? null, input.billingTypeSnapshot,
  input.unitSnapshot ?? null, input.quantity, input.unitCostCentsSnapshot ?? null, input.listPriceCentsSnapshot, input.minimumPriceCentsSnapshot ?? null,
  input.proposedUnitPriceCents, input.subtotalListCents, input.subtotalProposedCents, input.subtotalCostCents ?? null, input.discountCents,
  input.grossProfitCents ?? null, input.grossMarginBp ?? null, input.commissionTypeSnapshot ?? null, input.commissionValueSnapshot ?? null,
];

export class PostgresDealItemRepository implements DealItemRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listByDeal(dealId: string): Promise<DealItem[]> {
    const result = await this.pool.query<DealItemRow>("select * from deal_items where deal_id = $1 order by position, created_at", [dealId]);
    return result.rows.map(toDealItem);
  }

  async listByDeals(dealIds: readonly string[]): Promise<DealItem[]> {
    if (dealIds.length === 0) return [];
    const result = await this.pool.query<DealItemRow>("select * from deal_items where deal_id = any($1::text[]) order by deal_id, position", [[...dealIds]]);
    return result.rows.map(toDealItem);
  }

  async getById(id: string): Promise<DealItem | undefined> {
    const result = await this.pool.query<DealItemRow>("select * from deal_items where id = $1", [id]);
    return result.rows[0] ? toDealItem(result.rows[0]) : undefined;
  }

  async create(input: CreateDealItemInput): Promise<DealItem> {
    const values = dealItemValues(input);
    const placeholders = values.map((_, index) => `$${index + 5}`).join(", ");
    const result = await this.pool.query<DealItemRow>(
      `insert into deal_items (id, tenant_id, workspace_id, deal_id, ${DEAL_ITEM_COLUMNS}) values ($1, $2, $3, $4, ${placeholders}) returning *`,
      [newId("dealitem"), input.tenantId, input.workspaceId, input.dealId, ...values],
    );
    return toDealItem(result.rows[0]);
  }

  async replace(id: string, input: CreateDealItemInput): Promise<DealItem> {
    const values = dealItemValues(input);
    const assignments = DEAL_ITEM_COLUMNS.split(", ").map((column, index) => `${column} = $${index + 2}`).join(", ");
    const result = await this.pool.query<DealItemRow>(`update deal_items set ${assignments}, updated_at = now() where id = $1 returning *`, [id, ...values]);
    if (!result.rows[0]) throw new Error(`DEAL_ITEM_NOT_FOUND: item "${id}" não existe.`);
    return toDealItem(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from deal_items where id = $1", [id]);
  }
}

// --------------------------------------------------------------------------------------------
// Configuração comercial: settings, políticas, motivos, concorrentes, campos, participantes
// --------------------------------------------------------------------------------------------

type SettingsRow = {
  workspace_id: string; tenant_id: string; sellers_can_view_cost: boolean; sellers_can_view_margin: boolean; deal_visibility: CommercialSettings["dealVisibility"];
  proposal_accept_auto_win: boolean; proposal_whatsapp_template: string | null; proposal_reminder_template: string | null; default_contract_months: number | null;
  ranking_enabled: boolean; updated_at: Date;
};
const toSettings = (row: SettingsRow): CommercialSettings => ({
  workspaceId: row.workspace_id, tenantId: row.tenant_id, sellersCanViewCost: row.sellers_can_view_cost, sellersCanViewMargin: row.sellers_can_view_margin,
  dealVisibility: row.deal_visibility, proposalAcceptAutoWin: row.proposal_accept_auto_win, proposalWhatsappTemplate: row.proposal_whatsapp_template ?? undefined,
  proposalReminderTemplate: row.proposal_reminder_template ?? undefined, defaultContractMonths: row.default_contract_months ?? undefined,
  rankingEnabled: row.ranking_enabled, updatedAt: row.updated_at.toISOString(),
});

type PolicyRow = { id: string; tenant_id: string; workspace_id: string; scope_type: PolicyScopeType; scope_id: string | null; min_margin_bp: number | null; max_discount_bp: number | null; allow_below_minimum: boolean; created_at: Date; updated_at: Date };
const toPolicy = (row: PolicyRow): CommercialPolicy => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, scopeType: row.scope_type, scopeId: row.scope_id ?? undefined,
  minMarginBp: row.min_margin_bp ?? undefined, maxDiscountBp: row.max_discount_bp ?? undefined, allowBelowMinimum: row.allow_below_minimum,
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

type ReasonRow = { id: string; tenant_id: string; workspace_id: string; kind: CloseReasonKind; label: string; position: number; active: boolean };
const toReason = (row: ReasonRow): CloseReason => ({ id: row.id, workspaceId: row.workspace_id, kind: row.kind, label: row.label, position: row.position, active: row.active });

type CompetitorRow = { id: string; tenant_id: string; workspace_id: string; name: string; active: boolean };
const toCompetitor = (row: CompetitorRow): Competitor => ({ id: row.id, workspaceId: row.workspace_id, name: row.name, active: row.active });

type CustomFieldRow = { id: string; tenant_id: string; workspace_id: string; key: string; label: string; field_type: CustomFieldType; options: string[] | null; position: number; active: boolean };
const toCustomField = (row: CustomFieldRow): DealCustomFieldDefinition => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, key: row.key, label: row.label, fieldType: row.field_type,
  options: row.options ?? [], position: row.position, active: row.active,
});

type ParticipantRow = { id: string; deal_id: string; contact_id: string; role: ParticipantRole; created_at: Date };
const toParticipant = (row: ParticipantRow): DealParticipant => ({ id: row.id, dealId: row.deal_id, contactId: row.contact_id, role: row.role, createdAt: row.created_at.toISOString() });

export class PostgresSalesConfigRepository implements SalesConfigRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getSettings(workspaceId: string): Promise<CommercialSettings | undefined> {
    const result = await this.pool.query<SettingsRow>("select * from commercial_settings where workspace_id = $1", [workspaceId]);
    return result.rows[0] ? toSettings(result.rows[0]) : undefined;
  }

  async upsertSettings(input: { tenantId: string; workspaceId: string } & Partial<Omit<CommercialSettings, "tenantId" | "workspaceId" | "updatedAt">>): Promise<CommercialSettings> {
    const current = await this.getSettings(input.workspaceId);
    const merged = {
      sellersCanViewCost: input.sellersCanViewCost ?? current?.sellersCanViewCost ?? false,
      sellersCanViewMargin: input.sellersCanViewMargin ?? current?.sellersCanViewMargin ?? true,
      dealVisibility: input.dealVisibility ?? current?.dealVisibility ?? "all",
      proposalAcceptAutoWin: input.proposalAcceptAutoWin ?? current?.proposalAcceptAutoWin ?? false,
      proposalWhatsappTemplate: "proposalWhatsappTemplate" in input ? input.proposalWhatsappTemplate : current?.proposalWhatsappTemplate,
      proposalReminderTemplate: "proposalReminderTemplate" in input ? input.proposalReminderTemplate : current?.proposalReminderTemplate,
      defaultContractMonths: "defaultContractMonths" in input ? input.defaultContractMonths : current?.defaultContractMonths,
      rankingEnabled: input.rankingEnabled ?? current?.rankingEnabled ?? false,
    };
    const result = await this.pool.query<SettingsRow>(
      `insert into commercial_settings (workspace_id, tenant_id, sellers_can_view_cost, sellers_can_view_margin, deal_visibility, proposal_accept_auto_win,
         proposal_whatsapp_template, proposal_reminder_template, default_contract_months, ranking_enabled)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (workspace_id) do update set sellers_can_view_cost = excluded.sellers_can_view_cost, sellers_can_view_margin = excluded.sellers_can_view_margin,
         deal_visibility = excluded.deal_visibility, proposal_accept_auto_win = excluded.proposal_accept_auto_win,
         proposal_whatsapp_template = excluded.proposal_whatsapp_template, proposal_reminder_template = excluded.proposal_reminder_template,
         default_contract_months = excluded.default_contract_months, ranking_enabled = excluded.ranking_enabled, updated_at = now()
       returning *`,
      [input.workspaceId, input.tenantId, merged.sellersCanViewCost, merged.sellersCanViewMargin, merged.dealVisibility, merged.proposalAcceptAutoWin,
        merged.proposalWhatsappTemplate ?? null, merged.proposalReminderTemplate ?? null, merged.defaultContractMonths ?? null, merged.rankingEnabled],
    );
    return toSettings(result.rows[0]);
  }

  async listPolicies(input: { tenantId: string; workspaceId: string }): Promise<CommercialPolicy[]> {
    const result = await this.pool.query<PolicyRow>("select * from commercial_policies where tenant_id = $1 and workspace_id = $2 order by scope_type, scope_id", [input.tenantId, input.workspaceId]);
    return result.rows.map(toPolicy);
  }

  async getPolicy(id: string): Promise<CommercialPolicy | undefined> {
    const result = await this.pool.query<PolicyRow>("select * from commercial_policies where id = $1", [id]);
    return result.rows[0] ? toPolicy(result.rows[0]) : undefined;
  }

  async upsertPolicy(input: { tenantId: string; workspaceId: string; scopeType: PolicyScopeType; scopeId?: string; minMarginBp?: number | null; maxDiscountBp?: number | null; allowBelowMinimum?: boolean }): Promise<CommercialPolicy> {
    const result = await this.pool.query<PolicyRow>(
      `insert into commercial_policies (id, tenant_id, workspace_id, scope_type, scope_id, min_margin_bp, max_discount_bp, allow_below_minimum)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (workspace_id, scope_type, coalesce(scope_id, ''))
       do update set min_margin_bp = excluded.min_margin_bp, max_discount_bp = excluded.max_discount_bp, allow_below_minimum = excluded.allow_below_minimum, updated_at = now()
       returning *`,
      [newId("policy"), input.tenantId, input.workspaceId, input.scopeType, input.scopeType === "workspace" ? null : input.scopeId ?? null, input.minMarginBp ?? null, input.maxDiscountBp ?? null, input.allowBelowMinimum ?? false],
    );
    return toPolicy(result.rows[0]);
  }

  async deletePolicy(id: string): Promise<void> {
    await this.pool.query("delete from commercial_policies where id = $1", [id]);
  }

  async listCloseReasons(input: { tenantId: string; workspaceId: string; kind?: CloseReasonKind; includeInactive?: boolean }): Promise<CloseReason[]> {
    const params: unknown[] = [input.tenantId, input.workspaceId];
    let where = "tenant_id = $1 and workspace_id = $2";
    if (input.kind) {
      params.push(input.kind);
      where += ` and kind = $${params.length}`;
    }
    if (!input.includeInactive) where += " and active";
    const result = await this.pool.query<ReasonRow>(`select * from sales_close_reasons where ${where} order by kind, position, created_at`, params);
    return result.rows.map(toReason);
  }

  async getCloseReason(id: string): Promise<(CloseReason & { tenantId: string }) | undefined> {
    const result = await this.pool.query<ReasonRow>("select * from sales_close_reasons where id = $1", [id]);
    return result.rows[0] ? { ...toReason(result.rows[0]), tenantId: result.rows[0].tenant_id } : undefined;
  }

  async createCloseReason(input: { tenantId: string; workspaceId: string; kind: CloseReasonKind; label: string; position?: number }): Promise<CloseReason> {
    const result = await this.pool.query<ReasonRow>(
      "insert into sales_close_reasons (id, tenant_id, workspace_id, kind, label, position) values ($1, $2, $3, $4, $5, $6) returning *",
      [newId("reason"), input.tenantId, input.workspaceId, input.kind, input.label, input.position ?? 0],
    );
    return toReason(result.rows[0]);
  }

  async updateCloseReason(id: string, patch: { label?: string; active?: boolean; position?: number }): Promise<CloseReason> {
    const result = await this.pool.query<ReasonRow>(
      "update sales_close_reasons set label = coalesce($2, label), active = coalesce($3, active), position = coalesce($4, position) where id = $1 returning *",
      [id, patch.label ?? null, patch.active ?? null, patch.position ?? null],
    );
    if (!result.rows[0]) throw new Error(`SALES_REASON_NOT_FOUND: motivo "${id}" não existe.`);
    return toReason(result.rows[0]);
  }

  async countCloseReasons(workspaceId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>("select count(*) as count from sales_close_reasons where workspace_id = $1", [workspaceId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async listCompetitors(input: { tenantId: string; workspaceId: string; includeInactive?: boolean }): Promise<Competitor[]> {
    const result = await this.pool.query<CompetitorRow>(
      `select * from sales_competitors where tenant_id = $1 and workspace_id = $2 ${input.includeInactive ? "" : "and active"} order by name`,
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map(toCompetitor);
  }

  async getCompetitor(id: string): Promise<(Competitor & { tenantId: string }) | undefined> {
    const result = await this.pool.query<CompetitorRow>("select * from sales_competitors where id = $1", [id]);
    return result.rows[0] ? { ...toCompetitor(result.rows[0]), tenantId: result.rows[0].tenant_id } : undefined;
  }

  async upsertCompetitor(input: { tenantId: string; workspaceId: string; name: string }): Promise<Competitor> {
    const existing = await this.pool.query<CompetitorRow>("select * from sales_competitors where workspace_id = $1 and lower(name) = lower($2)", [input.workspaceId, input.name.trim()]);
    if (existing.rows[0]) return toCompetitor(existing.rows[0]);
    const result = await this.pool.query<CompetitorRow>(
      "insert into sales_competitors (id, tenant_id, workspace_id, name) values ($1, $2, $3, $4) on conflict do nothing returning *",
      [newId("competitor"), input.tenantId, input.workspaceId, input.name.trim()],
    );
    if (result.rows[0]) return toCompetitor(result.rows[0]);
    const again = await this.pool.query<CompetitorRow>("select * from sales_competitors where workspace_id = $1 and lower(name) = lower($2)", [input.workspaceId, input.name.trim()]);
    return toCompetitor(again.rows[0]);
  }

  async updateCompetitor(id: string, patch: { name?: string; active?: boolean }): Promise<Competitor> {
    const result = await this.pool.query<CompetitorRow>("update sales_competitors set name = coalesce($2, name), active = coalesce($3, active) where id = $1 returning *", [id, patch.name?.trim() ?? null, patch.active ?? null]);
    if (!result.rows[0]) throw new Error(`SALES_COMPETITOR_NOT_FOUND: concorrente "${id}" não existe.`);
    return toCompetitor(result.rows[0]);
  }

  async listCustomFields(input: { tenantId: string; workspaceId: string; includeInactive?: boolean }): Promise<DealCustomFieldDefinition[]> {
    const result = await this.pool.query<CustomFieldRow>(
      `select * from deal_custom_field_definitions where tenant_id = $1 and workspace_id = $2 ${input.includeInactive ? "" : "and active"} order by position, label`,
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map(toCustomField);
  }

  async getCustomField(id: string): Promise<DealCustomFieldDefinition | undefined> {
    const result = await this.pool.query<CustomFieldRow>("select * from deal_custom_field_definitions where id = $1", [id]);
    return result.rows[0] ? toCustomField(result.rows[0]) : undefined;
  }

  async createCustomField(input: { tenantId: string; workspaceId: string; key: string; label: string; fieldType: CustomFieldType; options?: readonly string[]; position?: number }): Promise<DealCustomFieldDefinition> {
    try {
      const result = await this.pool.query<CustomFieldRow>(
        "insert into deal_custom_field_definitions (id, tenant_id, workspace_id, key, label, field_type, options, position) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *",
        [newId("dealfield"), input.tenantId, input.workspaceId, input.key, input.label, input.fieldType, JSON.stringify(input.options ?? []), input.position ?? 0],
      );
      return toCustomField(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error(`DEAL_CUSTOM_FIELD_DUPLICATE: já existe um campo com a chave "${input.key}".`);
      throw error;
    }
  }

  async updateCustomField(id: string, patch: { label?: string; options?: readonly string[]; position?: number; active?: boolean }): Promise<DealCustomFieldDefinition> {
    const result = await this.pool.query<CustomFieldRow>(
      "update deal_custom_field_definitions set label = coalesce($2, label), options = coalesce($3, options), position = coalesce($4, position), active = coalesce($5, active), updated_at = now() where id = $1 returning *",
      [id, patch.label ?? null, patch.options ? JSON.stringify(patch.options) : null, patch.position ?? null, patch.active ?? null],
    );
    if (!result.rows[0]) throw new Error(`DEAL_CUSTOM_FIELD_NOT_FOUND: campo "${id}" não existe.`);
    return toCustomField(result.rows[0]);
  }

  async listParticipants(dealId: string): Promise<DealParticipant[]> {
    const result = await this.pool.query<ParticipantRow>("select * from deal_participants where deal_id = $1 order by created_at", [dealId]);
    return result.rows.map(toParticipant);
  }

  async upsertParticipant(input: { tenantId: string; workspaceId: string; dealId: string; contactId: string; role: ParticipantRole }): Promise<DealParticipant> {
    const result = await this.pool.query<ParticipantRow>(
      `insert into deal_participants (id, tenant_id, workspace_id, deal_id, contact_id, role) values ($1, $2, $3, $4, $5, $6)
       on conflict (deal_id, contact_id) do update set role = excluded.role returning *`,
      [newId("participant"), input.tenantId, input.workspaceId, input.dealId, input.contactId, input.role],
    );
    return toParticipant(result.rows[0]);
  }

  async removeParticipant(dealId: string, contactId: string): Promise<void> {
    await this.pool.query("delete from deal_participants where deal_id = $1 and contact_id = $2", [dealId, contactId]);
  }
}

// --------------------------------------------------------------------------------------------
// Aprovações comerciais
// --------------------------------------------------------------------------------------------

type ApprovalRow = {
  id: string; tenant_id: string; workspace_id: string; deal_id: string; proposal_id: string | null; requested_by_user_id: string;
  status: CommercialApprovalRequest["status"]; justification: string | null; terms_fingerprint: string; reasons: ApprovalReason[] | null;
  snapshot: Record<string, unknown> | null; decided_by_user_id: string | null; decided_at: Date | null; decision_reason: string | null;
  approved_value_cents: string | null; created_at: Date; updated_at: Date;
};
const toApproval = (row: ApprovalRow): CommercialApprovalRequest => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, dealId: row.deal_id, proposalId: row.proposal_id ?? undefined,
  requestedByUserId: row.requested_by_user_id, status: row.status, justification: row.justification ?? undefined, termsFingerprint: row.terms_fingerprint,
  reasons: row.reasons ?? [], snapshot: row.snapshot ?? {}, decidedByUserId: row.decided_by_user_id ?? undefined, decidedAt: iso(row.decided_at),
  decisionReason: row.decision_reason ?? undefined, approvedValueCents: num(row.approved_value_cents), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

export class PostgresCommercialApprovalRepository implements CommercialApprovalRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createOrGetPending(input: { id: string; tenantId: string; workspaceId: string; dealId: string; proposalId?: string; requestedByUserId: string; justification?: string; termsFingerprint: string; reasons: readonly ApprovalReason[]; snapshot: Record<string, unknown> }): Promise<{ request: CommercialApprovalRequest; created: boolean }> {
    const inserted = await this.pool.query<ApprovalRow>(
      `insert into commercial_approval_requests (id, tenant_id, workspace_id, deal_id, proposal_id, requested_by_user_id, justification, terms_fingerprint, reasons, snapshot)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (deal_id, terms_fingerprint) where status = 'pending' do nothing
       returning *`,
      [input.id, input.tenantId, input.workspaceId, input.dealId, input.proposalId ?? null, input.requestedByUserId, input.justification ?? null, input.termsFingerprint, [...input.reasons], JSON.stringify(input.snapshot)],
    );
    if (inserted.rows[0]) return { request: toApproval(inserted.rows[0]), created: true };
    const existing = await this.pool.query<ApprovalRow>("select * from commercial_approval_requests where deal_id = $1 and terms_fingerprint = $2 and status = 'pending'", [input.dealId, input.termsFingerprint]);
    return { request: toApproval(existing.rows[0]), created: false };
  }

  async getById(id: string): Promise<CommercialApprovalRequest | undefined> {
    const result = await this.pool.query<ApprovalRow>("select * from commercial_approval_requests where id = $1", [id]);
    return result.rows[0] ? toApproval(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; status?: CommercialApprovalRequest["status"]; dealId?: string; limit?: number }): Promise<CommercialApprovalRequest[]> {
    const params: unknown[] = [input.tenantId, input.workspaceId];
    let where = "tenant_id = $1 and workspace_id = $2";
    if (input.status) {
      params.push(input.status);
      where += ` and status = $${params.length}`;
    }
    if (input.dealId) {
      params.push(input.dealId);
      where += ` and deal_id = $${params.length}`;
    }
    params.push(input.limit ?? 100);
    const result = await this.pool.query<ApprovalRow>(`select * from commercial_approval_requests where ${where} order by created_at desc limit $${params.length}`, params);
    return result.rows.map(toApproval);
  }

  async decide(id: string, input: { status: "approved" | "rejected" | "cancelled"; decidedByUserId: string; decisionReason?: string; approvedValueCents?: number }): Promise<CommercialApprovalRequest | undefined> {
    const result = await this.pool.query<ApprovalRow>(
      `update commercial_approval_requests set status = $2, decided_by_user_id = $3, decided_at = now(), decision_reason = $4, approved_value_cents = $5, updated_at = now()
       where id = $1 and status = 'pending' returning *`,
      [id, input.status, input.decidedByUserId, input.decisionReason ?? null, input.approvedValueCents ?? null],
    );
    return result.rows[0] ? toApproval(result.rows[0]) : undefined;
  }

  async findApproved(dealId: string, termsFingerprint: string): Promise<CommercialApprovalRequest | undefined> {
    const result = await this.pool.query<ApprovalRow>(
      "select * from commercial_approval_requests where deal_id = $1 and terms_fingerprint = $2 and status = 'approved' order by decided_at desc limit 1",
      [dealId, termsFingerprint],
    );
    return result.rows[0] ? toApproval(result.rows[0]) : undefined;
  }
}
