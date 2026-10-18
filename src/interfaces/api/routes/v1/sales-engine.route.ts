import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  addDealItem,
  cancelCommercialApproval,
  cancelDeal,
  decideCommercialApproval,
  getDealCommercialSummary,
  listCommercialApprovals,
  loseDeal,
  removeDealItem,
  reopenDeal,
  requestCommercialApproval,
  updateDealCommercialTerms,
  updateDealItem,
  winDeal,
  type DealClosedHook,
} from "../../../../application/sales/deal-commercial-use-cases.js";
import {
  createPriceBook,
  createVariant,
  generateVariantGrid,
  deletePriceBook,
  deletePriceBookItem,
  deleteVariant,
  listPriceBookItems,
  listPriceBooks,
  listVariants,
  updatePriceBook,
  updateVariant,
  upsertPriceBookItem,
} from "../../../../application/sales/catalog-use-cases.js";
import {
  createCloseReason,
  createCompetitor,
  createDealCustomField,
  deleteCommercialPolicy,
  findPossibleDuplicateDeals,
  getCommercialSettings,
  getEffectivePolicyFor,
  listCloseReasons,
  listCommercialPolicies,
  listCompetitors,
  listDealCustomFields,
  listDealParticipants,
  removeDealParticipant,
  setDealCustomFields,
  updateCloseReason,
  updateCommercialSettings,
  updateCompetitor,
  updateDealCustomField,
  upsertCommercialPolicy,
  upsertDealParticipant,
} from "../../../../application/sales/sales-config-use-cases.js";
import { dealVisibleInScope, isSalesManager, loadCommercialSettings, mustDealInWorkspace, resolveDealScope, resolveVisibility, type SalesActor, type SalesEngineDeps } from "../../../../application/sales/sales-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import type { Permission } from "../../../../domain/identity/identity.model.js";

export type SalesEngineRouteDeps = SalesEngineDeps & { onDealWon?: DealClosedHook };

const WS = { type: "string", minLength: 1 } as const;
const WORKSPACE_QUERY = { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } as const;
const ID_PARAMS = { type: "object", required: ["id"], properties: { id: WS } } as const;
const ID_SUB_PARAMS = (sub: string) => ({ type: "object", required: ["id", sub], properties: { id: WS, [sub]: WS } }) as const;
const body = (required: readonly string[], properties: Record<string, unknown>) => ({ type: "object", required: ["workspaceId", ...required], additionalProperties: false, properties: { workspaceId: WS, ...properties } });
const MONEY = { type: "integer", minimum: 0, maximum: 9_000_000_000_000 } as const;
const NULLABLE_MONEY = { type: ["integer", "null"], minimum: 0, maximum: 9_000_000_000_000 } as const;
const BP = { type: "integer", minimum: 0, maximum: 10000 } as const;
const QUANTITY = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 } as const;
const BILLING = { type: "string", enum: ["one_time", "monthly", "quarterly", "annual", "per_unit", "per_hour", "custom"] } as const;

const NOT_FOUND = ["DEAL_NOT_FOUND", "DEAL_ITEM_NOT_FOUND", "PRODUCT_NOT_FOUND", "PRODUCT_VARIANT_NOT_FOUND", "PRICE_BOOK_NOT_FOUND", "APPROVAL_NOT_FOUND", "SALES_REASON_NOT_FOUND", "SALES_COMPETITOR_NOT_FOUND", "DEAL_CUSTOM_FIELD_NOT_FOUND", "COMMERCIAL_POLICY_NOT_FOUND", "CONTACT_NOT_FOUND"];
const CONFLICT = ["APPROVAL_ALREADY_DECIDED", "DEAL_CUSTOM_FIELD_DUPLICATE", "COMMERCIAL_APPROVAL_REQUIRED"];
const INVALID = ["DEAL_CLOSED", "DEAL_ITEM_INVALID", "PRODUCT_INACTIVE", "PRODUCT_PRICING_INVALID", "DEAL_VALUE_CALCULATED", "APPROVAL_NOT_REQUIRED", "APPROVAL_REASON_REQUIRED", "DEAL_FINAL_VALUE_REQUIRED", "DEAL_LOSS_REASON_REQUIRED", "COMMERCIAL_SETTINGS_INVALID", "COMMERCIAL_POLICY_INVALID", "SALES_COMPETITOR_INVALID", "DEAL_CUSTOM_FIELD_INVALID"];

function translate(error: unknown): never {
  if(error instanceof Error&&/^(PRODUCT_VALIDATION|PRODUCT_VARIANT_REQUIRED|INVENTORY_INSUFFICIENT|INVENTORY_VARIANT_UNAVAILABLE)/.test(error.message))throw new ValidationError(error.message);
  if((error as {code?:string})?.code==="23505")throw new ConflictError("Essa combinação ou código já existe.");
  if (error instanceof Error) {
    const code = error.message.split(":")[0];
    if (NOT_FOUND.includes(code)) throw new NotFoundError(error.message);
    if (CONFLICT.includes(code)) throw new ConflictError(error.message);
    if (INVALID.includes(code)) throw new ValidationError(error.message);
  }
  throw error;
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    translate(error);
  }
}

function actorFor(request: FastifyRequest, permission: Permission): SalesActor {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role };
}

function managerFor(request: FastifyRequest, permission: Permission): SalesActor {
  const actor = actorFor(request, permission);
  if (!isSalesManager(actor.role)) throw new ForbiddenError("Somente gestores (admin/owner) podem alterar esta configuração comercial.");
  return actor;
}

export async function registerSalesEngineRoutes(app: FastifyInstance, deps: SalesEngineRouteDeps): Promise<void> {
  /** Oportunidade visível para o ator (respeita `dealVisibility`) — 404 fora do escopo. */
  async function visibleDeal(actor: SalesActor, workspaceId: string, dealId: string) {
    const deal = await mustDealInWorkspace(deps, dealId, actor.tenantId, workspaceId);
    if (!dealVisibleInScope(deal, await resolveDealScope(deps, actor, workspaceId))) throw new Error(`DEAL_NOT_FOUND: oportunidade "${dealId}" não existe.`);
    return deal;
  }

  // ------------------------------------------------------------------ cockpit / itens / termos
  app.get("/deals/:id/commercial", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, workspaceId, id);
      return getDealCommercialSummary(deps, actor, { workspaceId, dealId: id });
    }), request.id);
  });

  app.post("/deals/:id/items", {
    schema: { params: ID_PARAMS, body: body(["quantity"], { productId: { type: "string" }, variantId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 200 }, listPriceCents: MONEY, unitCostCents: MONEY, minimumPriceCents: MONEY, billingType: BILLING, quantity: QUANTITY, proposedUnitPriceCents: MONEY, discountBp: BP }) },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const actor = actorFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; quantity: number } & Record<string, unknown>;
    const item = await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return addDealItem(deps, actor, { ...input, dealId: id } as never);
    });
    reply.code(201);
    return successEnvelope(item, request.id);
  });

  app.patch("/deals/:id/items/:itemId", { schema: { params: ID_SUB_PARAMS("itemId"), body: body([], { quantity: QUANTITY, proposedUnitPriceCents: MONEY, discountBp: BP }) } }, async (request) => {
    const actor = actorFor(request, "deal:manage");
    const { id, itemId } = request.params as { id: string; itemId: string };
    const input = request.body as { workspaceId: string; quantity?: number; proposedUnitPriceCents?: number; discountBp?: number };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return updateDealItem(deps, actor, { ...input, dealId: id, itemId });
    }), request.id);
  });

  app.delete("/deals/:id/items/:itemId", { schema: { params: ID_SUB_PARAMS("itemId"), querystring: WORKSPACE_QUERY } }, async (request, reply) => {
    const actor = actorFor(request, "deal:manage");
    const { id, itemId } = request.params as { id: string; itemId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(async () => {
      await visibleDeal(actor, workspaceId, id);
      await removeDealItem(deps, actor, { workspaceId, dealId: id, itemId });
    });
    reply.code(204);
    return null;
  });

  app.patch("/deals/:id/commercial", {
    schema: { params: ID_PARAMS, body: body([], { valueMode: { type: "string", enum: ["manual", "calculated"] }, discountCents: MONEY, contractMonths: { type: ["integer", "null"], minimum: 1, maximum: 600 }, priceBookId: { type: ["string", "null"] }, probability: { type: ["integer", "null"], minimum: 0, maximum: 100 }, forecastCategory: { type: "string", enum: ["pipeline", "best_case", "commit"] }, valueCents: MONEY }) },
  }, async (request) => {
    const actor = actorFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string } & Record<string, unknown>;
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return updateDealCommercialTerms(deps, actor, { ...input, dealId: id } as never);
    }), request.id);
  });

  app.put("/deals/:id/custom-fields", { schema: { params: ID_PARAMS, body: body(["values"], { values: { type: "object", maxProperties: 60 } }) } }, async (request) => {
    const actor = actorFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; values: Record<string, unknown> };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return setDealCustomFields(deps, actor, { workspaceId: input.workspaceId, dealId: id, values: input.values });
    }), request.id);
  });

  app.get("/deals/:id/participants", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, workspaceId, id);
      return listDealParticipants(deps, actor, { workspaceId, dealId: id });
    }), request.id);
  });

  app.put("/deals/:id/participants/:contactId", { schema: { params: ID_SUB_PARAMS("contactId"), body: body(["role"], { role: { type: "string", enum: ["decision_maker", "influencer", "user", "financial", "other"] } }) } }, async (request) => {
    const actor = actorFor(request, "deal:manage");
    const { id, contactId } = request.params as { id: string; contactId: string };
    const input = request.body as { workspaceId: string; role: "decision_maker" | "influencer" | "user" | "financial" | "other" };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return upsertDealParticipant(deps, actor, { workspaceId: input.workspaceId, dealId: id, contactId, role: input.role });
    }), request.id);
  });

  app.delete("/deals/:id/participants/:contactId", { schema: { params: ID_SUB_PARAMS("contactId"), querystring: WORKSPACE_QUERY } }, async (request, reply) => {
    const actor = actorFor(request, "deal:manage");
    const { id, contactId } = request.params as { id: string; contactId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(async () => {
      await visibleDeal(actor, workspaceId, id);
      await removeDealParticipant(deps, actor, { workspaceId, dealId: id, contactId });
    });
    reply.code(204);
    return null;
  });

  app.get("/deals-duplicates", { schema: { querystring: { type: "object", required: ["workspaceId", "pipelineId", "title"], properties: { workspaceId: WS, pipelineId: WS, title: { type: "string", maxLength: 200 }, contactId: { type: "string" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; pipelineId: string; title: string; contactId?: string };
    const scope = await resolveDealScope(deps, actor, query.workspaceId);
    const deals = await findPossibleDuplicateDeals(deps, { tenantId: actor.tenantId, ...query });
    return successEnvelope(deals.filter((deal) => dealVisibleInScope(deal, scope)).map((deal) => ({ id: deal.id, title: deal.title, stageId: deal.stageId, valueCents: deal.valueCents, currency: deal.currency, ownerUserId: deal.ownerUserId })), request.id);
  });

  // ------------------------------------------------------------------ fechamento
  app.post("/deals/:id/win", { schema: { params: ID_PARAMS, body: body([], { wonReason: { type: "string", maxLength: 200 }, proposalId: { type: "string" }, comment: { type: "string", maxLength: 2000 }, finalValueCents: MONEY }) } }, async (request) => {
    const actor = actorFor(request, "deal:close");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; wonReason?: string; proposalId?: string; comment?: string; finalValueCents?: number };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return winDeal(deps, actor, { ...input, dealId: id });
    }), request.id);
  });

  app.post("/deals/:id/lose", { schema: { params: ID_PARAMS, body: body(["lossReason"], { lossReason: { type: "string", minLength: 1, maxLength: 400 }, competitorId: { type: "string" }, competitorName: { type: "string", maxLength: 120 }, comment: { type: "string", maxLength: 2000 } }) } }, async (request) => {
    const actor = actorFor(request, "deal:close");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; lossReason: string; competitorId?: string; competitorName?: string; comment?: string };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return loseDeal(deps, actor, { ...input, dealId: id });
    }), request.id);
  });

  app.post("/deals/:id/reopen", { schema: { params: ID_PARAMS, body: body([], {}) } }, async (request) => {
    const actor = actorFor(request, "deal:close");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, workspaceId, id);
      return reopenDeal(deps, actor, { workspaceId, dealId: id });
    }), request.id);
  });

  app.post("/deals/:id/cancel", { schema: { params: ID_PARAMS, body: body([], { comment: { type: "string", maxLength: 2000 } }) } }, async (request) => {
    const actor = actorFor(request, "deal:close");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; comment?: string };
    return successEnvelope(await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return cancelDeal(deps, actor, { ...input, dealId: id });
    }), request.id);
  });

  // ------------------------------------------------------------------ aprovações
  app.post("/deals/:id/approvals", { schema: { params: ID_PARAMS, body: body([], { justification: { type: "string", maxLength: 2000 }, proposalId: { type: "string" } }) } }, async (request, reply) => {
    const actor = actorFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; justification?: string; proposalId?: string };
    const approval = await guard(async () => {
      await visibleDeal(actor, input.workspaceId, id);
      return requestCommercialApproval(deps, actor, { ...input, dealId: id });
    });
    reply.code(201);
    return successEnvelope(approval, request.id);
  });

  app.get("/commercial-approvals", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] }, dealId: { type: "string" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; status?: "pending" | "approved" | "rejected" | "cancelled"; dealId?: string };
    return successEnvelope(await listCommercialApprovals(deps, actor, query), request.id);
  });

  app.post("/commercial-approvals/:id/decision", { schema: { params: ID_PARAMS, body: body(["decision"], { decision: { type: "string", enum: ["approved", "rejected"] }, reason: { type: "string", maxLength: 2000 } }) } }, async (request) => {
    const actor = actorFor(request, "deal:approve_discount");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; decision: "approved" | "rejected"; reason?: string };
    return successEnvelope(await guard(() => decideCommercialApproval(deps, actor, { ...input, approvalId: id })), request.id);
  });

  app.post("/commercial-approvals/:id/cancel", { schema: { params: ID_PARAMS, body: body([], {}) } }, async (request) => {
    const actor = actorFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await guard(() => cancelCommercialApproval(deps, actor, { workspaceId, approvalId: id })), request.id);
  });

  // ------------------------------------------------------------------ catálogo: variações e tabelas
  app.get("/products/:id/variants", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "product:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const visibility = resolveVisibility(actor, await loadCommercialSettings(deps, actor.tenantId, workspaceId));
    return successEnvelope(await guard(() => listVariants(deps, { tenantId: actor.tenantId, workspaceId, productId: id, canViewCost: visibility.canViewCost })), request.id);
  });
  app.post("/products/:id/variant-grid",{schema:{params:ID_PARAMS,body:body([],{})},config:{readOnlyGuard:true}},async request=>{
    const actor=managerFor(request,"product:manage");const {id}=request.params as {id:string};const {workspaceId}=request.body as {workspaceId:string};
    return successEnvelope(await guard(()=>generateVariantGrid(deps,{tenantId:actor.tenantId,workspaceId,productId:id})),request.id);
  });

  const VARIANT_FIELDS = { name: { type: "string", minLength: 1, maxLength: 120 }, code: { type: "string", maxLength: 60 }, costCents: MONEY, listPriceCents: MONEY, minimumPriceCents: MONEY, active: { type: "boolean" }, position: { type: "integer", minimum: 0 }, priceOverride:{type:"boolean"},optionValues:{type:"object",maxProperties:4,additionalProperties:{type:"string",maxLength:160}}, stockQuantity:{type:"number",minimum:0,maximum:1e9},imageUrl:{type:"string",maxLength:2000} };
  app.post("/products/:id/variants", { schema: { params: ID_PARAMS, body: body(["name", "listPriceCents"], VARIANT_FIELDS) }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = managerFor(request, "product:manage");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; name: string; listPriceCents: number } & Record<string, unknown>;
    const variant = await guard(() => createVariant(deps, { tenantId: actor.tenantId, productId: id, ...input } as never));
    reply.code(201);
    return successEnvelope(variant, request.id);
  });

  app.patch("/products/:id/variants/:variantId", { schema: { params: ID_SUB_PARAMS("variantId"), body: body([], {...Object.fromEntries(Object.entries(VARIANT_FIELDS).filter(([key])=>key!=="stockQuantity")),costCents:{anyOf:[MONEY,{type:"null"}]},minimumPriceCents:{anyOf:[MONEY,{type:"null"}]},imageUrl:{anyOf:[VARIANT_FIELDS.imageUrl,{type:"null"}]}}) } }, async (request) => {
    const actor = managerFor(request, "product:manage");
    const { id, variantId } = request.params as { id: string; variantId: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    return successEnvelope(await guard(() => updateVariant(deps, { tenantId: actor.tenantId, workspaceId, productId: id, variantId, patch: patch as never })), request.id);
  });

  app.delete("/products/:id/variants/:variantId", { schema: { params: ID_SUB_PARAMS("variantId"), querystring: WORKSPACE_QUERY } }, async (request, reply) => {
    const actor = managerFor(request, "product:manage");
    const { id, variantId } = request.params as { id: string; variantId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(() => deleteVariant(deps, { tenantId: actor.tenantId, workspaceId, productId: id, variantId }));
    reply.code(204);
    return null;
  });

  app.get("/price-books", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "product:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await listPriceBooks(deps, { tenantId: actor.tenantId, workspaceId }), request.id);
  });

  app.post("/price-books", { schema: { body: body(["name"], { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 500 }, currency: { type: "string", minLength: 3, maxLength: 3 } }) }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = managerFor(request, "product:manage");
    const input = request.body as { workspaceId: string; name: string; description?: string; currency?: string };
    const book = await createPriceBook(deps, { tenantId: actor.tenantId, ...input });
    reply.code(201);
    return successEnvelope(book, request.id);
  });

  app.patch("/price-books/:id", { schema: { params: ID_PARAMS, body: body([], { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 500 }, active: { type: "boolean" } }) } }, async (request) => {
    const actor = managerFor(request, "product:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    return successEnvelope(await guard(() => updatePriceBook(deps, { tenantId: actor.tenantId, workspaceId, priceBookId: id, patch: patch as never })), request.id);
  });

  app.delete("/price-books/:id", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request, reply) => {
    const actor = managerFor(request, "product:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(() => deletePriceBook(deps, { tenantId: actor.tenantId, workspaceId, priceBookId: id }));
    reply.code(204);
    return null;
  });

  app.get("/price-books/:id/items", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "product:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(() => listPriceBookItems(deps, { tenantId: actor.tenantId, workspaceId, priceBookId: id })), request.id);
  });

  app.put("/price-books/:id/items", { schema: { params: ID_PARAMS, body: body(["productId", "listPriceCents"], { productId: WS, variantId: { type: "string" }, listPriceCents: MONEY, minimumPriceCents: MONEY }) } }, async (request) => {
    const actor = managerFor(request, "product:manage");
    const { id } = request.params as { id: string };
    const input = request.body as { workspaceId: string; productId: string; variantId?: string; listPriceCents: number; minimumPriceCents?: number };
    return successEnvelope(await guard(() => upsertPriceBookItem(deps, { tenantId: actor.tenantId, priceBookId: id, ...input })), request.id);
  });

  app.delete("/price-books/:id/items/:itemId", { schema: { params: ID_SUB_PARAMS("itemId"), querystring: WORKSPACE_QUERY } }, async (request, reply) => {
    const actor = managerFor(request, "product:manage");
    const { id, itemId } = request.params as { id: string; itemId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(() => deletePriceBookItem(deps, { tenantId: actor.tenantId, workspaceId, priceBookId: id, itemId }));
    reply.code(204);
    return null;
  });

  // ------------------------------------------------------------------ configuração comercial
  app.get("/commercial-settings", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const settings = await getCommercialSettings(deps, { tenantId: actor.tenantId, workspaceId });
    return successEnvelope({ ...settings, visibility: resolveVisibility(actor, settings) }, request.id);
  });

  app.patch("/commercial-settings", {
    schema: { body: body([], { sellersCanViewCost: { type: "boolean" }, sellersCanViewMargin: { type: "boolean" }, dealVisibility: { type: "string", enum: ["all", "team", "own"] }, proposalAcceptAutoWin: { type: "boolean" }, proposalWhatsappTemplate: { type: ["string", "null"], maxLength: 4000 }, proposalReminderTemplate: { type: ["string", "null"], maxLength: 4000 }, defaultContractMonths: { type: ["integer", "null"], minimum: 1, maximum: 600 }, rankingEnabled: { type: "boolean" } }) },
  }, async (request) => {
    const actor = managerFor(request, "deal:approve_discount");
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    const normalized = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]));
    return successEnvelope(await guard(() => updateCommercialSettings(deps, { tenantId: actor.tenantId, workspaceId, patch: normalized })), request.id);
  });

  app.get("/commercial-policies", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await listCommercialPolicies(deps, { tenantId: actor.tenantId, workspaceId }), request.id);
  });

  app.get("/commercial-policies/effective", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, userId: { type: "string" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { workspaceId, userId } = request.query as { workspaceId: string; userId?: string };
    if (userId && userId !== actor.userId && !isSalesManager(actor.role)) throw new ForbiddenError("Só gestores consultam a política de outra pessoa.");
    return successEnvelope(await getEffectivePolicyFor(deps, { tenantId: actor.tenantId, workspaceId, userId: userId ?? actor.userId }), request.id);
  });

  app.put("/commercial-policies", {
    schema: { body: body(["scopeType"], { scopeType: { type: "string", enum: ["workspace", "role", "team", "user"] }, scopeId: { type: "string" }, minMarginBp: { type: ["integer", "null"], minimum: -100000, maximum: 10000 }, maxDiscountBp: { type: ["integer", "null"], minimum: 0, maximum: 10000 }, allowBelowMinimum: { type: "boolean" } }) },
  }, async (request) => {
    const actor = managerFor(request, "deal:approve_discount");
    const input = request.body as { workspaceId: string; scopeType: "workspace" | "role" | "team" | "user"; scopeId?: string; minMarginBp?: number | null; maxDiscountBp?: number | null; allowBelowMinimum?: boolean };
    return successEnvelope(await guard(() => upsertCommercialPolicy(deps, { tenantId: actor.tenantId, ...input })), request.id);
  });

  app.delete("/commercial-policies/:id", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request, reply) => {
    const actor = managerFor(request, "deal:approve_discount");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(() => deleteCommercialPolicy(deps, { tenantId: actor.tenantId, workspaceId, policyId: id }));
    reply.code(204);
    return null;
  });

  app.get("/sales-reasons", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, kind: { type: "string", enum: ["won", "lost", "proposal_decline"] }, includeInactive: { type: "boolean" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; kind?: "won" | "lost" | "proposal_decline"; includeInactive?: boolean };
    return successEnvelope(await listCloseReasons(deps, { tenantId: actor.tenantId, ...query }), request.id);
  });

  app.post("/sales-reasons", { schema: { body: body(["kind", "label"], { kind: { type: "string", enum: ["won", "lost", "proposal_decline"] }, label: { type: "string", minLength: 1, maxLength: 120 } }) } }, async (request, reply) => {
    const actor = managerFor(request, "deal:manage");
    const input = request.body as { workspaceId: string; kind: "won" | "lost" | "proposal_decline"; label: string };
    const reason = await createCloseReason(deps, { tenantId: actor.tenantId, ...input });
    reply.code(201);
    return successEnvelope(reason, request.id);
  });

  app.patch("/sales-reasons/:id", { schema: { params: ID_PARAMS, body: body([], { label: { type: "string", minLength: 1, maxLength: 120 }, active: { type: "boolean" }, position: { type: "integer", minimum: 0 } }) } }, async (request) => {
    const actor = managerFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    return successEnvelope(await guard(() => updateCloseReason(deps, { tenantId: actor.tenantId, workspaceId, reasonId: id, patch: patch as never })), request.id);
  });

  app.get("/sales-competitors", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, includeInactive: { type: "boolean" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; includeInactive?: boolean };
    return successEnvelope(await listCompetitors(deps, { tenantId: actor.tenantId, ...query }), request.id);
  });

  app.post("/sales-competitors", { schema: { body: body(["name"], { name: { type: "string", minLength: 1, maxLength: 120 } }) } }, async (request, reply) => {
    const actor = actorFor(request, "deal:manage");
    const input = request.body as { workspaceId: string; name: string };
    const competitor = await guard(() => createCompetitor(deps, { tenantId: actor.tenantId, ...input }));
    reply.code(201);
    return successEnvelope(competitor, request.id);
  });

  app.patch("/sales-competitors/:id", { schema: { params: ID_PARAMS, body: body([], { name: { type: "string", minLength: 1, maxLength: 120 }, active: { type: "boolean" } }) } }, async (request) => {
    const actor = managerFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string; name?: string; active?: boolean };
    return successEnvelope(await guard(() => updateCompetitor(deps, { tenantId: actor.tenantId, workspaceId, competitorId: id, patch })), request.id);
  });

  app.get("/deal-custom-fields", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, includeInactive: { type: "boolean" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; includeInactive?: boolean };
    return successEnvelope(await listDealCustomFields(deps, { tenantId: actor.tenantId, ...query }), request.id);
  });

  app.post("/deal-custom-fields", { schema: { body: body(["key", "label", "fieldType"], { key: { type: "string", minLength: 1, maxLength: 40 }, label: { type: "string", minLength: 1, maxLength: 120 }, fieldType: { type: "string", enum: ["text", "number", "currency", "date", "select", "multi_select", "boolean"] }, options: { type: "array", maxItems: 50, items: { type: "string", maxLength: 120 } } }) } }, async (request, reply) => {
    const actor = managerFor(request, "deal:manage");
    const input = request.body as { workspaceId: string; key: string; label: string; fieldType: "text"; options?: string[] };
    const field = await guard(() => createDealCustomField(deps, { tenantId: actor.tenantId, ...input }));
    reply.code(201);
    return successEnvelope(field, request.id);
  });

  app.patch("/deal-custom-fields/:id", { schema: { params: ID_PARAMS, body: body([], { label: { type: "string", minLength: 1, maxLength: 120 }, options: { type: "array", maxItems: 50, items: { type: "string", maxLength: 120 } }, position: { type: "integer", minimum: 0 }, active: { type: "boolean" } }) } }, async (request) => {
    const actor = managerFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    return successEnvelope(await guard(() => updateDealCustomField(deps, { tenantId: actor.tenantId, workspaceId, fieldId: id, patch: patch as never })), request.id);
  });
}
