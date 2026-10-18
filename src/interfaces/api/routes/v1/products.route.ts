import type { FastifyInstance } from "fastify";
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "../../../../application/crm/product-use-cases.js";
import type { ProductUseCaseDeps } from "../../../../application/crm/product-use-cases.js";
import { assertProductPricing, redactProduct } from "../../../../application/sales/catalog-use-cases.js";
import { loadCommercialSettings, resolveVisibility, type SalesVisibility } from "../../../../application/sales/sales-context.js";
import type { SalesConfigRepositoryPort } from "../../../../application/ports/sales-engine-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../../../application/ports/tenant-membership-repository.port.js";
import type { NotificationUseCaseDeps } from "../../../../application/notification/notification-use-cases.js";
import { getOpenDealsStockRisk, setStockQuantity } from "../../../../application/sales/stock-use-cases.js";
import { isLowStock } from "../../../../domain/crm/crm.model.js";
import type { ObjectStoragePort } from "../../../../application/ports/object-storage.port.js";
import { parseOwnedObjectUrl, stripObjectUrlSignature } from "../../../../shared/utils/object-url-signing.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";
import { canonicalWorkspaceImages, uploadWorkspaceImage } from "../../http/workspace-images.js";
import type { AuthPrincipal } from "../../../../domain/identity/identity.model.js";
import type { Product } from "../../../../domain/crm/crm.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, search: { type: "string" }, activeOnly: { type: "boolean" } },
} as const;
const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name", "priceCents"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 5000 },
    priceCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    code: { type: ["string", "null"], maxLength: 60 },
    category: { type: ["string", "null"], maxLength: 80 },
    itemType: { type: "string", enum: ["product", "service"] },
    unit: { type: ["string", "null"], maxLength: 30 },
    billingType: { type: "string", enum: ["one_time", "monthly", "quarterly", "annual", "per_unit", "per_hour", "custom"] },
    costCents: { type: ["integer", "null"], minimum: 0 },
    minimumPriceCents: { type: ["integer", "null"], minimum: 0 },
    commissionType: { type: ["string", "null"], enum: ["percent", "fixed", null] },
    commissionValue: { type: ["integer", "null"], minimum: 0 },
    taxMetadata: { type: "object", maxProperties: 30 },
    trackStock: { type: "boolean" },
    stockQuantity: { type: "number", minimum: -1000000000, maximum: 1000000000 },
    stockAlertThreshold: { type: ["number", "null"], minimum: 0, maximum: 1000000000 },
    imageUrls: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 2000 } },
    details: { type: "object", maxProperties: 16 }, categoryId: { type: ["string", "null"], maxLength: 160 }, brandId: { type: ["string", "null"], maxLength: 160 },
  },
} as const;
const UPDATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 5000 },
    priceCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    code: { type: ["string", "null"], maxLength: 60 },
    category: { type: ["string", "null"], maxLength: 80 },
    itemType: { type: "string", enum: ["product", "service"] },
    unit: { type: ["string", "null"], maxLength: 30 },
    billingType: { type: "string", enum: ["one_time", "monthly", "quarterly", "annual", "per_unit", "per_hour", "custom"] },
    costCents: { type: ["integer", "null"], minimum: 0 },
    minimumPriceCents: { type: ["integer", "null"], minimum: 0 },
    commissionType: { type: ["string", "null"], enum: ["percent", "fixed", null] },
    commissionValue: { type: ["integer", "null"], minimum: 0 },
    taxMetadata: { type: "object", maxProperties: 30 },
    trackStock: { type: "boolean" },
    stockQuantity: { type: "number", minimum: -1000000000, maximum: 1000000000 },
    stockAlertThreshold: { type: ["number", "null"], minimum: 0, maximum: 1000000000 },
    imageUrls: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 2000 } },
    details: { type: "object", maxProperties: 16 }, categoryId: { type: ["string", "null"], maxLength: 160 }, brandId: { type: ["string", "null"], maxLength: 160 },
    active: { type: "boolean" },
  },
} as const;

function translateProductError(error: unknown): never {
  if(error instanceof Error && /PRODUCT_VALIDATION/.test(error.message)) throw new ValidationError(error.message);
  if((error as {code?:string})?.code === "23505") throw new ValidationError("Esse slug ou código já está em uso.");
  if (error instanceof Error && error.message.startsWith("PRODUCT_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && error.message.startsWith("PRODUCT_PRICING_INVALID")) throw new ValidationError(error.message);
  throw error;
}

/** Sales Engine — custo/comissão só para quem pode ver custo; preço mínimo só a gestão define
 * (senão o próprio vendedor afrouxaria o piso que dispara a aprovação). Campos sem permissão são
 * ignorados na escrita e omitidos na leitura. */
type ProductRouteDeps = ProductUseCaseDeps & {
  salesConfigRepository?: SalesConfigRepositoryPort;
  /** Alerta de estoque baixo para a gestão (opcional — sem isto o ajuste só não notifica). */
  membershipRepository?: TenantMembershipRepositoryPort;
  notification?: Partial<NotificationUseCaseDeps>;
  /** Fotos do produto (upload para o storage do workspace). */
  objectStorage?: ObjectStoragePort;
  maxUploadBytes?: number;
  workspaceRepository?: WorkspaceRepositoryPort;
};


const MAX_PRODUCT_IMAGE_BYTES = 5_000_000;

/** Só fotos enviadas para a pasta de produtos DESTE workspace — nunca URL externa arbitrária. */
function cleanImageUrls(deps: ProductRouteDeps, tenantId: string, workspaceId: string, urls: unknown): string[] | undefined {
  if (urls === undefined) return undefined;
  if (!Array.isArray(urls)) throw new ValidationError("PRODUCT_IMAGES_INVALID: lista de fotos inválida.");
  return [...new Set(canonicalWorkspaceImages(deps.objectStorage,{tenantId,workspaceId},urls.map(String)))];
}

async function productVisibility(deps: ProductRouteDeps, principal: AuthPrincipal, workspaceId: string): Promise<SalesVisibility> {
  if (!deps.salesConfigRepository) return { canViewCost: true, canViewMargin: true, isManager: true };
  const settings = await loadCommercialSettings({ salesConfigRepository: deps.salesConfigRepository }, principal.tenantId, workspaceId);
  return resolveVisibility({ tenantId: principal.tenantId, userId: principal.userId, role: principal.role }, settings);
}

function sanitizeProductWrite<T extends Record<string, unknown>>(body: T, visibility: SalesVisibility): T {
  const clean: Record<string, unknown> = { ...body };
  if (!visibility.canViewCost) {
    delete clean.costCents;
    delete clean.commissionType;
    delete clean.commissionValue;
  }
  if (!visibility.isManager) delete clean.minimumPriceCents;
  return clean as T;
}

const NO_MEMBERS = { listByTenant: async () => [] } as unknown as TenantMembershipRepositoryPort;

const present = (product: Product, visibility: SalesVisibility) => ({ ...redactProduct(product, visibility.canViewCost), listPriceCents: product.priceCents, commissionValue: visibility.canViewCost ? product.commissionValue : undefined, lowStock: isLowStock(product) });

async function presentWithStock(deps:ProductRouteDeps,product:Product,visibility:SalesVisibility):Promise<ReturnType<typeof present>>{
 if(product.details?.options.length&&deps.salesCatalogRepository){const variants=(await deps.salesCatalogRepository.listVariants(product.id)).filter(variant=>variant.active);product={...product,stockQuantity:variants.reduce((total,variant)=>total+(variant.stockQuantity??0),0),reservedQuantity:variants.reduce((total,variant)=>total+(variant.reservedQuantity??0),0)};}
 return present(product,visibility);
}

export async function registerProductsRoutes(app: FastifyInstance, deps: ProductRouteDeps): Promise<void> {
  app.get("/products", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:read");
    const { workspaceId, search, activeOnly } = request.query as { workspaceId: string; search?: string; activeOnly?: boolean };
    const products = await listProducts(deps, { tenantId: principal.tenantId, workspaceId, search, activeOnly });
    const visibility = await productVisibility(deps, principal, workspaceId);
    return successEnvelope(await Promise.all(products.map((product) => presentWithStock(deps,product,visibility))), request.id);
  });

  /** Foto do produto: JPEG/PNG/WEBP até 5 MB, gravada na pasta de produtos do workspace. */
  app.post("/products/images", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:manage");
    const { workspaceId } = request.query as { workspaceId: string };
    if (deps.workspaceRepository) await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    if (!deps.objectStorage) throw new ValidationError("PRODUCT_IMAGES_INVALID: envio de fotos indisponível.");
    return successEnvelope(await uploadWorkspaceImage(request,deps.objectStorage,{tenantId:principal.tenantId,workspaceId},deps.maxUploadBytes),request.id);
  });

  /** Risco de estoque das oportunidades abertas (laranja = atenção, vermelho = revisar). */
  app.get("/products/stock-risk", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await getOpenDealsStockRisk(deps, { tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/products", { schema: { body: CREATE_BODY_SCHEMA }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const principal = requirePermission(request, "product:manage");
    const raw = request.body as { workspaceId: string; name: string; description?: string; priceCents: number; currency?: string } & Record<string, unknown>;
    const visibility = await productVisibility(deps, principal, raw.workspaceId);
    const body = sanitizeProductWrite(raw, visibility);
    const imageUrls = cleanImageUrls(deps, principal.tenantId, raw.workspaceId, raw.imageUrls);
    if (imageUrls) (body as Record<string, unknown>).imageUrls = imageUrls;
    try {
      assertProductPricing(body as never);
      const product = await createProduct(deps, { tenantId: principal.tenantId, ...body } as never);
      reply.code(201);
      return successEnvelope(await presentWithStock(deps,product,visibility), request.id);
    } catch (error) {
      translateProductError(error);
    }
  });

  app.get("/products/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const product = await getProduct(deps, { productId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(present(product, await productVisibility(deps, principal, workspaceId)), request.id);
    } catch (error) {
      translateProductError(error);
    }
  });

  app.patch("/products/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...rawPatch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const visibility = await productVisibility(deps, principal, workspaceId);
      const patch = sanitizeProductWrite(rawPatch, visibility);
      const imageUrls = cleanImageUrls(deps, principal.tenantId, workspaceId, rawPatch.imageUrls);
      if (imageUrls) (patch as Record<string, unknown>).imageUrls = imageUrls;
      const existing = await getProduct(deps, { productId: id, tenantId: principal.tenantId, workspaceId });
      assertProductPricing(patch as never, existing);
      // Saldo de estoque muda só via movimento (auditável e com alerta), nunca por sobrescrita direta.
      const { stockQuantity, ...rest } = patch as { stockQuantity?: number } & Record<string, unknown>;
      if(stockQuantity!==undefined&&((patch.details as {options?:unknown[]}|undefined)?.options??existing.details?.options)?.length)throw new ValidationError("Ajuste o estoque de cada variante.");
      let product = await updateProduct(deps, { productId: id, tenantId: principal.tenantId, workspaceId, patch: rest as never });
      if (stockQuantity !== undefined && product.trackStock) {
        product = await setStockQuantity(
          { productRepository: deps.productRepository, membershipRepository: deps.membershipRepository ?? NO_MEMBERS, notification: deps.notification },
          product,
          stockQuantity,
          principal.userId,
        );
      }
      return successEnvelope(await presentWithStock(deps,product,visibility), request.id);
    } catch (error) {
      translateProductError(error);
    }
  });

  app.delete("/products/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "product:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteProduct(deps, { productId: id, tenantId: principal.tenantId, workspaceId });
      reply.code(204);
      return null;
    } catch (error) {
      translateProductError(error);
    }
  });
}
