import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AssetLibraryRepositoryPort } from "../../../../application/ports/asset-library-repository.port.js";
import type { ObjectStoragePort } from "../../../../application/ports/object-storage.port.js";
import { ASSET_KINDS, ASSET_MATERIAL_TYPES, ASSET_USAGE_PRIORITIES, type AssetKind, type AssetMaterialType, type AssetUsagePriority } from "../../../../domain/asset-library/asset-library.model.js";
import { NotFoundError, NotImplementedError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type AssetsRoutesDeps = {
  assetLibraryRepository: AssetLibraryRepositoryPort;
  objectStorage: ObjectStoragePort;
  maxUploadBytes: number;
};

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    kind: { type: "string", enum: [...ASSET_KINDS] },
    search: { type: "string" },
  },
} as const;

const UPLOAD_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

// Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — os 4 campos
// semânticos abaixo são compartilhados entre registro e edição.
const SEMANTIC_METADATA_PROPERTIES = {
  materialType: { type: "string", enum: [...ASSET_MATERIAL_TYPES] },
  aiInstructions: { type: "string", maxLength: 2000 },
  usageRule: { type: "string", maxLength: 1000 },
  usagePriority: { type: "string", enum: [...ASSET_USAGE_PRIORITIES] },
} as const;

const UPDATE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    kind: { type: "string", enum: [...ASSET_KINDS] },
    tags: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 20 },
    ...SEMANTIC_METADATA_PROPERTIES,
  },
} as const;

const REGISTER_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "kind", "name"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    kind: { type: "string", enum: [...ASSET_KINDS] },
    name: { type: "string", minLength: 1, maxLength: 200 },
    tags: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 20 },
    ...SEMANTIC_METADATA_PROPERTIES,
    storageRef: {
      type: "object",
      required: ["provider", "objectKey"],
      additionalProperties: false,
      properties: {
        provider: { type: "string", minLength: 1 },
        bucket: { type: "string" },
        objectKey: { type: "string", minLength: 1 },
        metadata: { type: "object", additionalProperties: { type: "string" } },
      },
    },
  },
} as const;

/** Material da marca é um escopo bem mais amplo que mídia de post (logo SVG, brand book em PDF,
 * fontes) — por isso um allowlist próprio, mais generoso que `publication-media.route.ts`. */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
};

function translateAssetError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("ASSET_LIBRARY_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("ASSET_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("ASSET_UPLOAD_FILE_MISSING")) throw new ValidationError(error.message);
    if (error.message.startsWith("ASSET_UPLOAD_TYPE_UNSUPPORTED")) throw new ValidationError(error.message);
    if (error.message.startsWith("ASSET_UPLOAD_TOO_LARGE")) throw new ValidationError(error.message);
    if (error.message.startsWith("OBJECT_STORAGE_NOT_CONFIGURED")) throw new NotImplementedError("Upload de material não configurado neste servidor.");
  }
  throw error;
}

/**
 * Materiais da Marca (Asset Library) — HTTP real por trás do `AssetLibraryRepositoryPort`
 * (existia desde a Sprint 02, nunca teve rota exposta nem upload real ligado). Biblioteca é 1:1
 * por workspace, criada sob demanda na primeira chamada — nunca um passo separado de "setup".
 */
export async function registerAssetsRoutes(app: FastifyInstance, deps: AssetsRoutesDeps): Promise<void> {
  async function ensureLibraryId(workspaceId: string): Promise<string> {
    const existing = await deps.assetLibraryRepository.getLibraryByWorkspace(workspaceId);
    if (existing) return existing.id;
    const created = await deps.assetLibraryRepository.createLibrary({ workspaceId });
    return created.id;
  }

  app.get("/assets", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:read");
    const { workspaceId, kind, search } = request.query as { workspaceId: string; kind?: AssetKind; search?: string };
    const library = await deps.assetLibraryRepository.getLibraryByWorkspace(workspaceId);
    if (!library) return successEnvelope([], request.id);
    const assets = await deps.assetLibraryRepository.listAssets(library.id, { kind });
    const active = assets.filter((asset) => asset.status === "active");
    const filtered = search ? active.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase())) : active;
    return successEnvelope(filtered, request.id);
  });

  app.post("/assets/upload", { schema: { querystring: UPLOAD_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:create");
    const { workspaceId } = request.query as { workspaceId: string };

    try {
      const file = await request.file({ limits: { fileSize: deps.maxUploadBytes } });
      if (!file) throw new Error("ASSET_UPLOAD_FILE_MISSING: envie o arquivo no campo multipart.");

      const contentType = file.mimetype;
      const extension = ALLOWED_MIME_TYPES[contentType];
      if (!extension) {
        throw new Error(`ASSET_UPLOAD_TYPE_UNSUPPORTED: tipo "${contentType}" não é aceito (use JPEG, PNG, WEBP, SVG, MP4, MOV, PDF ou fontes TTF/OTF/WOFF).`);
      }

      const buffer = await file.toBuffer().catch((cause: unknown) => {
        if (cause instanceof Error && cause.message.includes("File size limit")) {
          throw new Error(`ASSET_UPLOAD_TOO_LARGE: arquivo maior que o limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)}MB.`);
        }
        throw cause;
      });
      if (file.file.truncated) {
        throw new Error(`ASSET_UPLOAD_TOO_LARGE: arquivo maior que o limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)}MB.`);
      }

      const objectKey = `assets/${principal.tenantId}/${workspaceId}/${randomUUID()}.${extension}`;
      const { url } = await deps.objectStorage.put({ key: objectKey, body: buffer, contentType });

      return successEnvelope({ objectKey, url, contentType, sizeBytes: buffer.length }, request.id);
    } catch (error) {
      translateAssetError(error);
    }
  });

  app.post("/assets", { schema: { body: REGISTER_BODY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:create");
    const body = request.body as {
      workspaceId: string;
      kind: AssetKind;
      name: string;
      tags?: string[];
      materialType?: AssetMaterialType;
      aiInstructions?: string;
      usageRule?: string;
      usagePriority?: AssetUsagePriority;
      storageRef?: { provider: string; bucket?: string; objectKey: string; metadata?: Record<string, string> };
    };
    const libraryId = await ensureLibraryId(body.workspaceId);
    const asset = await deps.assetLibraryRepository
      .registerAsset({
        libraryId,
        kind: body.kind,
        name: body.name,
        tags: body.tags,
        storageRef: body.storageRef,
        materialType: body.materialType,
        aiInstructions: body.aiInstructions,
        usageRule: body.usageRule,
        usagePriority: body.usagePriority,
      })
      .catch(translateAssetError);
    return successEnvelope(asset, request.id);
  });

  app.post("/assets/:id/update", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:update");
    const { id } = request.params as { id: string };
    const patch = request.body as {
      name?: string;
      kind?: AssetKind;
      tags?: string[];
      materialType?: AssetMaterialType;
      aiInstructions?: string;
      usageRule?: string;
      usagePriority?: AssetUsagePriority;
    };
    const asset = await deps.assetLibraryRepository.updateAsset(id, patch).catch(translateAssetError);
    return successEnvelope(asset, request.id);
  });

  app.post("/assets/:id/archive", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:update");
    const { id } = request.params as { id: string };
    const asset = await deps.assetLibraryRepository.archiveAsset(id).catch(translateAssetError);
    return successEnvelope(asset, request.id);
  });

  // POST, não DELETE — mesma convenção do resto da API (`/x/:id/cancel`, `/x/:id/revoke`...),
  // nenhuma outra rota usa o verbo HTTP DELETE.
  app.post("/assets/:id/delete", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:update");
    const { id } = request.params as { id: string };
    await deps.assetLibraryRepository.deleteAsset(id);
    return successEnvelope({ id, deleted: true }, request.id);
  });
}
