import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { ObjectStoragePort } from "../../../../application/ports/object-storage.port.js";
import { NotImplementedError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

function translateMediaUploadError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("MEDIA_UPLOAD_FILE_MISSING")) throw new ValidationError(error.message);
    if (error.message.startsWith("MEDIA_UPLOAD_TYPE_UNSUPPORTED")) throw new ValidationError(error.message);
    if (error.message.startsWith("MEDIA_UPLOAD_TOO_LARGE")) throw new ValidationError(error.message);
    if (error.message.startsWith("OBJECT_STORAGE_NOT_CONFIGURED")) throw new NotImplementedError("Upload de mídia não configurado neste servidor.");
  }
  throw error;
}

/**
 * Upload de mídia para publicação — escopo estreito: recebe um arquivo (multipart), sobe pro
 * object storage configurado e devolve a URL pública que os formulários de post (TikTok/Instagram/
 * Facebook) usam nos campos `videoUrl`/`imageUrls`. Não registra nada na Asset Library nem no
 * Media Catalog — ver `object-storage.port.ts` sobre por que esse escopo é deliberado.
 */
export type PublicationMediaRoutesDeps = {
  objectStorage: ObjectStoragePort;
  maxUploadBytes: number;
};

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;

export async function registerPublicationMediaRoutes(app: FastifyInstance, deps: PublicationMediaRoutesDeps): Promise<void> {
  app.post("/publication-media/upload", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:create");
    const { workspaceId } = request.query as { workspaceId: string };

    try {
      const file = await request.file({ limits: { fileSize: deps.maxUploadBytes } });
      if (!file) throw new Error("MEDIA_UPLOAD_FILE_MISSING: envie o arquivo no campo multipart.");

      const contentType = file.mimetype;
      if (!ALLOWED_MIME_TYPES.has(contentType)) {
        throw new Error(`MEDIA_UPLOAD_TYPE_UNSUPPORTED: tipo "${contentType}" não é aceito (use JPEG, PNG, WEBP, MP4 ou MOV).`);
      }

      const buffer = await file.toBuffer().catch((cause: unknown) => {
        if (cause instanceof Error && cause.message.includes("File size limit")) {
          throw new Error(`MEDIA_UPLOAD_TOO_LARGE: arquivo maior que o limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)}MB.`);
        }
        throw cause;
      });
      if (file.file.truncated) {
        throw new Error(`MEDIA_UPLOAD_TOO_LARGE: arquivo maior que o limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)}MB.`);
      }

      const extension = EXTENSION_BY_MIME[contentType];
      const key = `${principal.tenantId}/${workspaceId}/${randomUUID()}.${extension}`;
      const { url } = await deps.objectStorage.put({ key, body: buffer, contentType });

      return successEnvelope({ url, contentType, sizeBytes: buffer.length }, request.id);
    } catch (error) {
      translateMediaUploadError(error);
    }
  });
}
