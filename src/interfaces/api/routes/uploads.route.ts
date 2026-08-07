import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolveObjectPath } from "../../../infrastructure/storage/local-object-storage.js";
import { NotFoundError, ValidationError } from "../http/app-error.js";

export async function registerUploadedObjectRoutes(app: FastifyInstance, options: { rootDir: string }): Promise<void> {
  app.get("/uploads/*", async (request, reply) => {
    const key = (request.params as { "*": string })["*"];
    let absolutePath: string;
    try {
      absolutePath = resolveObjectPath(options.rootDir, key);
    } catch {
      throw new ValidationError("Caminho de arquivo inválido.");
    }

    const fileStat = await stat(absolutePath).catch(() => undefined);
    if (!fileStat?.isFile()) throw new NotFoundError("Arquivo não encontrado.");

    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.type(contentTypeForKey(key));
    return reply.send(createReadStream(absolutePath));
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
