import type { FastifyInstance } from "fastify";
import { getSharedProduct, type PublicProductDeps } from "../../../../application/commercial-bridge/public-product-use-cases.js";
import { NotFoundError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";

export async function registerPublicProductsRoutes(app: FastifyInstance, deps: PublicProductDeps) {
  app.get("/public/products", { schema: { querystring: { type: "object", required: ["token"], properties: { token: { type: "string", maxLength: 2000 } } } } }, async (request, reply) => {
    const token = (request.query as { token: string }).token;
    try {
      const product = await getSharedProduct(deps, token);
      reply.header("Cache-Control", "private, no-store").header("X-Robots-Tag", "noindex, nofollow").header("Referrer-Policy", "no-referrer");
      return successEnvelope(product, request.id);
    } catch (error) {
      if (error instanceof Error && error.message === "PUBLIC_PRODUCT_NOT_FOUND") throw new NotFoundError("Este produto não está disponível. Peça um novo link à loja.");
      throw error;
    }
  });
}
