import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { sep } from "node:path";
import type { PublicObjectRepositoryPort } from "../../../application/ports/public-object-repository.port.js";
import { resolveObjectPath } from "../../../infrastructure/storage/local-object-storage.js";
import { verifyObjectSignature } from "../../../shared/utils/object-url-signing.js";
import { NotFoundError } from "../http/app-error.js";

/**
 * `/uploads/<key>` — PRIVADO por padrão (ver `object-url-signing.ts`). Serve só com:
 * - URL assinada válida (escopo da chave, não expirada) → `Cache-Control: private`;
 * - chave marcada explicitamente como pública (`public_objects`, motivo persistido) → cache público curto.
 * Qualquer outro caso — sem assinatura, assinatura expirada/adulterada, chave inválida, traversal,
 * symlink para fora da raiz, arquivo inexistente — responde 404 (nunca revela se o arquivo existe).
 */
export async function registerUploadedObjectRoutes(app: FastifyInstance, options: { rootDir: string; publicObjects?: PublicObjectRepositoryPort }): Promise<void> {
  app.get("/uploads/*", async (request, reply) => {
    const key = (request.params as { "*": string })["*"];
    const query = (request.query ?? {}) as { exp?: unknown; sig?: unknown };
    // Observabilidade: o MOTIVO da negação vai para o log (nunca a chave nem a assinatura); a
    // resposta é sempre o mesmo 404, para não revelar se o arquivo existe.
    const notFound = (reason: string) => {
      request.log.warn({ uploadsAccessDenied: reason }, "uploads: acesso negado");
      return new NotFoundError("Arquivo não encontrado.");
    };

    let absolutePath: string;
    try {
      absolutePath = resolveObjectPath(options.rootDir, key);
    } catch {
      throw notFound("INVALID_PATH");
    }

    const verdict = verifyObjectSignature(key, typeof query.exp === "string" ? query.exp : undefined, typeof query.sig === "string" ? query.sig : undefined);
    let publicObject = false;
    if (verdict !== "VALID") {
      if (verdict !== "MISSING") throw notFound(`SIGNATURE_${verdict}`);
      publicObject = (await options.publicObjects?.isPublic(key).catch(() => false)) ?? false;
      if (!publicObject) throw notFound("PRIVATE_WITHOUT_SIGNATURE");
    }

    // Symlink que aponte para fora da raiz nunca é servido (mesma regra do `read` por chave).
    const [realRoot, realFile] = await Promise.all([realpath(options.rootDir).catch(() => undefined), realpath(absolutePath).catch(() => undefined)]);
    if (!realRoot || !realFile) throw notFound("NOT_FOUND");
    if (!(realFile === realRoot || realFile.startsWith(`${realRoot}${sep}`))) throw notFound("OUTSIDE_ROOT");
    const fileStat = await stat(realFile).catch(() => undefined);
    if (!fileStat?.isFile()) throw notFound("NOT_FOUND");

    reply.header("Cache-Control", publicObject ? "public, max-age=3600" : "private, max-age=900");
    reply.type(contentTypeForKey(key));
    return reply.send(createReadStream(realFile));
  });
}

function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}
