import type { FastifyInstance } from "fastify";
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "../../../../application/crm/product-use-cases.js";
import type { ProductUseCaseDeps } from "../../../../application/crm/product-use-cases.js";
import { NotFoundError } from "../../http/app-error.js";
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
    description: { type: "string", maxLength: 2000 },
    priceCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
  },
} as const;
const UPDATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    priceCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    active: { type: "boolean" },
  },
} as const;

function translateProductError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PRODUCT_NOT_FOUND")) throw new NotFoundError(error.message);
  throw error;
}

export async function registerProductsRoutes(app: FastifyInstance, deps: ProductUseCaseDeps): Promise<void> {
  app.get("/products", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:read");
    const { workspaceId, search, activeOnly } = request.query as { workspaceId: string; search?: string; activeOnly?: boolean };
    const products = await listProducts(deps, { tenantId: principal.tenantId, workspaceId, search, activeOnly });
    return successEnvelope(products, request.id);
  });

  app.post("/products", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "product:manage");
    const body = request.body as { workspaceId: string; name: string; description?: string; priceCents: number; currency?: string };
    const product = await createProduct(deps, { tenantId: principal.tenantId, ...body });
    reply.code(201);
    return successEnvelope(product, request.id);
  });

  app.get("/products/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const product = await getProduct(deps, { productId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(product, request.id);
    } catch (error) {
      translateProductError(error);
    }
  });

  app.patch("/products/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "product:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const product = await updateProduct(deps, { productId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(product, request.id);
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
