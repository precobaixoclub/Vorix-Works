import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactHostingInput,
  ArtifactHostingMediaType,
  ArtifactHostingPort,
  ArtifactHostingResult,
} from "../../application/ports/artifact-hosting.port.js";

export type LocalFakeArtifactHostingOptions = {
  rootDir?: string;
  publicBaseUrl?: string;
  provider?: string;
  maxSizeBytes?: number;
};

const DEFAULT_MAX_SIZE_BYTES = 500 * 1024 * 1024;
const DEFAULT_SUPPORTED_MEDIA_TYPES: ArtifactHostingMediaType[] = ["image", "carousel", "video", "document", "archive", "other"];

/**
 * Implementação fake e segura para desenvolvimento local.
 *
 * Ela valida que o arquivo existe no disco e devolve uma URL HTTPS determinística em domínio
 * `.invalid`, própria para testes/dry-run. Não deve ser usada como hosting real em produção:
 * providers reais como Cloudflare R2, S3, GCS ou Supabase deverão implementar a mesma porta.
 */
export class LocalFakeArtifactHosting implements ArtifactHostingPort {
  readonly capabilities;

  private readonly rootDir: string;

  constructor(options: LocalFakeArtifactHostingOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), "artifacts"));
    this.capabilities = {
      provider: options.provider ?? "local-fake-artifact-hosting",
      supportedMediaTypes: DEFAULT_SUPPORTED_MEDIA_TYPES,
      maxSizeBytes: options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES,
      publicBaseUrl: sanitizeBaseUrl(options.publicBaseUrl ?? "https://zuno-local-artifacts.invalid"),
    };
  }

  async host(input: ArtifactHostingInput): Promise<ArtifactHostingResult> {
    if (!input.sourceUri?.trim()) {
      return this.fail(input, "MISSING_SOURCE_URI", "sourceUri é obrigatório para hospedar artefato.", false);
    }
    if (isPublicHttpUrl(input.sourceUri)) {
      return {
        status: "hosted",
        sourceUri: input.sourceUri,
        publicUrl: input.sourceUri,
        provider: this.capabilities.provider,
        fileName: input.fileName ?? fileNameFromUri(input.sourceUri),
        mimeType: input.mimeType,
        extension: normalizeExtension(input.extension ?? extensionFromUri(input.sourceUri)),
        sizeBytes: input.sizeBytes,
        metadata: { alreadyPublic: true, ...(input.metadata ?? {}) },
      };
    }
    if (input.sourceUri.startsWith("file://")) {
      return this.fail(input, "FILE_URI_NOT_ALLOWED", "file:// não é aceito como origem de publicação social.", false);
    }

    const extension = normalizeExtension(input.extension ?? extensionFromUri(input.sourceUri));
    if (!extension) {
      return this.fail(input, "MISSING_EXTENSION", "Não foi possível identificar a extensão do artefato.", false);
    }
    if (!this.supportsExtension(input.mediaType, extension)) {
      return this.fail(input, "UNSUPPORTED_EXTENSION", `Extensão ${extension} não é suportada para ${input.mediaType}.`, false);
    }

    const absolutePath = this.resolveLocalPath(input.sourceUri, input.executionId);
    const file = await stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!file?.isFile()) {
      return this.fail(input, "LOCAL_FILE_NOT_FOUND", `Arquivo local não encontrado: ${input.sourceUri}.`, false);
    }
    if (file.size <= 0) {
      return this.fail(input, "EMPTY_FILE", `Arquivo local está vazio: ${input.sourceUri}.`, false);
    }
    if (file.size > (this.capabilities.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES)) {
      return this.fail(input, "FILE_TOO_LARGE", `Arquivo excede o limite de ${this.capabilities.maxSizeBytes} bytes.`, false);
    }

    const relativePath = normalizePublicPath(input.executionId ? `${input.executionId}/${input.sourceUri}` : input.sourceUri);
    const publicUrl = `${this.capabilities.publicBaseUrl}/${relativePath}`;

    return {
      status: "hosted",
      sourceUri: input.sourceUri,
      publicUrl,
      provider: this.capabilities.provider,
      fileName: input.fileName ?? path.basename(input.sourceUri),
      mimeType: input.mimeType,
      extension,
      sizeBytes: input.sizeBytes ?? file.size,
      metadata: {
        absolutePath,
        fakeHosting: true,
        ...(input.metadata ?? {}),
      },
    };
  }

  private resolveLocalPath(sourceUri: string, executionId?: string): string {
    const normalized = sourceUri.replace(/\\/g, "/").replace(/^\/+/, "");
    if (path.isAbsolute(sourceUri)) return path.resolve(sourceUri);
    if (executionId && !normalized.startsWith(`${executionId}/`)) {
      return path.resolve(this.rootDir, executionId, normalized);
    }
    return path.resolve(this.rootDir, normalized);
  }

  private supportsExtension(mediaType: ArtifactHostingMediaType, extension: string): boolean {
    if (mediaType === "video") return ["mp4", "mov", "webm"].includes(extension);
    if (mediaType === "image" || mediaType === "carousel") return ["png", "jpg", "jpeg", "webp"].includes(extension);
    if (mediaType === "archive") return ["zip"].includes(extension);
    return true;
  }

  private fail(input: Partial<ArtifactHostingInput>, code: string, message: string, retryable: boolean): ArtifactHostingResult {
    return {
      status: "failed",
      sourceUri: input.sourceUri ?? "",
      provider: this.capabilities.provider,
      fileName: input.fileName,
      mimeType: input.mimeType,
      extension: normalizeExtension(input.extension),
      sizeBytes: input.sizeBytes,
      metadata: input.metadata,
      error: { code, message, retryable },
    };
  }
}

function isPublicHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeExtension(extension: string | undefined): string | undefined {
  return extension?.trim().replace(/^\./, "").toLowerCase() || undefined;
}

function extensionFromUri(uri: string): string | undefined {
  const withoutQuery = uri.split("?")[0].split("#")[0];
  if (!withoutQuery.includes(".")) return undefined;
  return withoutQuery.split(".").pop();
}

function fileNameFromUri(uri: string): string | undefined {
  const withoutQuery = uri.split("?")[0].split("#")[0];
  const fileName = withoutQuery.split(/[\\/]/).pop();
  return fileName || undefined;
}

function sanitizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePublicPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
