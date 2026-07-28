import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type {
  VisualAssetMetadata,
  VisualAssetProviderPort,
  VisualAssetSearchQuery,
  VisualAssetSearchResult,
} from "../../application/ports/visual-asset-provider.port.js";
import { inferKind, isVideoExtension, normalizeAspectRatio, readRasterDimensions, readVideoMetadata, type VisualAssetManifestEntry } from "./visual-asset-metadata.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension) || isVideoExtension(extension);
}

export type LocalVisualAssetLibraryOptions = {
  rootDir: string;
  manifestPath?: string;
  providerId?: string;
};

export class LocalVisualAssetLibrary implements VisualAssetProviderPort {
  readonly providerId: string;
  private readonly rootDir: string;
  private readonly manifestPath: string;

  constructor(options: LocalVisualAssetLibraryOptions) {
    this.rootDir = resolve(options.rootDir);
    this.manifestPath = resolve(options.manifestPath ?? join(options.rootDir, "manifest.json"));
    this.providerId = options.providerId ?? "local-visual-library";
  }

  async search(query: VisualAssetSearchQuery): Promise<VisualAssetSearchResult> {
    const warnings: string[] = [];
    const entries = await this.loadManifest(warnings);
    const assets: VisualAssetMetadata[] = [];
    for (const entry of entries) {
      try {
        const asset = await this.entryToMetadata(entry);
        if (matchesQuery(asset, query)) assets.push(asset);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { assets, warnings };
  }

  private async loadManifest(warnings: string[]): Promise<VisualAssetManifestEntry[]> {
    try {
      const raw = await readFile(this.manifestPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        warnings.push(`Manifesto de assets visuais precisa ser uma lista: ${this.manifestPath}.`);
        return [];
      }
      return parsed.filter((entry): entry is VisualAssetManifestEntry => isManifestEntry(entry));
    } catch {
      return this.scanDirectory(warnings);
    }
  }

  private async scanDirectory(warnings: string[]): Promise<VisualAssetManifestEntry[]> {
    const entries: VisualAssetManifestEntry[] = [];
    let files: string[] = [];
    try {
      files = await listFilesRecursive(this.rootDir);
    } catch {
      return entries;
    }
    for (const absolutePath of files) {
      const extension = extname(absolutePath).toLowerCase();
      if (!isSupportedExtension(extension)) continue;
      entries.push({
        id: toAssetId(absolutePath),
        path: absolutePath,
        provider: this.providerId,
        origin: "local_library",
        license: {
          name: "Arquivo local do usuário",
          allowsCommercialUse: true,
          requiresAttribution: false,
        },
        tags: inferTagsFromPath(absolutePath),
      });
    }
    if (entries.length === 0) warnings.push(`Nenhum asset visual local encontrado em ${this.rootDir}.`);
    return entries;
  }

  private async entryToMetadata(entry: VisualAssetManifestEntry): Promise<VisualAssetMetadata> {
    const absolutePath = resolve(dirname(this.manifestPath), entry.path);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) throw new Error(`Asset visual não é arquivo regular: ${absolutePath}`);
    const extension = extname(absolutePath).toLowerCase();
    if (!isSupportedExtension(extension)) throw new Error(`Extensão não suportada para asset visual ${absolutePath}.`);
    if (!entry.license) throw new Error(`Asset visual sem licença registrada: ${entry.id}.`);
    const tags = normalizeTags(entry.tags ?? inferTagsFromPath(absolutePath));
    const isVideo = isVideoExtension(extension);
    const videoMetadata = isVideo ? await readVideoMetadata(absolutePath) : undefined;
    const dimensions = videoMetadata ?? await readRasterDimensions(absolutePath);
    return {
      id: entry.id,
      provider: entry.provider ?? this.providerId,
      origin: entry.origin ?? "local_library",
      absolutePath,
      relativePath: absolutePath.startsWith(this.rootDir) ? absolutePath.slice(this.rootDir.length + 1).replace(/\\/g, "/") : undefined,
      author: entry.author,
      sourceUrl: entry.sourceUrl,
      license: entry.license,
      downloadedAt: entry.downloadedAt,
      tags,
      theme: entry.theme,
      emotion: entry.emotion,
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: normalizeAspectRatio(dimensions.width, dimensions.height),
      // Vídeo/b-roll/cinemagraph nunca são inferidos automaticamente de tags — o manifesto precisa
      // declarar `kind` explicitamente para essas categorias; sem isso, o padrão seguro é "video".
      kind: entry.kind ?? (isVideo ? "video" : inferKind(tags)),
      durationSeconds: videoMetadata?.durationSeconds,
      authenticityClassOverride: entry.authenticityClass,
    };
  }
}

function matchesQuery(asset: VisualAssetMetadata, query: VisualAssetSearchQuery): boolean {
  const haystack = normalizeTags([asset.theme, asset.emotion, asset.kind, ...asset.tags].filter(Boolean) as string[]);
  const required = normalizeTags(query.requiredTags);
  if (required.length === 0) return true;
  return required.some((tag) => haystack.some((candidate) => candidate.includes(tag) || tag.includes(candidate)));
}

function isManifestEntry(value: unknown): value is VisualAssetManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VisualAssetManifestEntry>;
  return typeof entry.id === "string" && typeof entry.path === "string" && typeof entry.license === "object";
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(absolutePath));
    if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function inferTagsFromPath(filePath: string): string[] {
  return normalizeTags(filePath.replace(/\\/g, "/").split(/[\/_.\-\s]+/g));
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}

function toAssetId(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
