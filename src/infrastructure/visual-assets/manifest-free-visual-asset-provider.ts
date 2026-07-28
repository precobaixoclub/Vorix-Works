import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  VisualAssetMetadata,
  VisualAssetProviderPort,
  VisualAssetSearchQuery,
  VisualAssetSearchResult,
} from "../../application/ports/visual-asset-provider.port.js";
import { inferKind, normalizeAspectRatio, readRasterDimensions, type VisualAssetManifestEntry } from "./visual-asset-metadata.js";

export type ManifestFreeVisualAssetProviderOptions = {
  manifestPath: string;
  cacheDir: string;
  providerId?: string;
};

/**
 * Provedor gratuito opcional por manifesto. Ele prepara o contrato para Pexels/Pixabay/Unsplash
 * sem acoplar Skills a APIs externas: cada entrada precisa trazer URL/origem/licença e pode
 * apontar para um arquivo local já baixado ou para `downloadUrl` em ambientes que autorizem rede.
 */
export class ManifestFreeVisualAssetProvider implements VisualAssetProviderPort {
  readonly providerId: string;
  private readonly manifestPath: string;
  private readonly cacheDir: string;

  constructor(options: ManifestFreeVisualAssetProviderOptions) {
    this.manifestPath = resolve(options.manifestPath);
    this.cacheDir = resolve(options.cacheDir);
    this.providerId = options.providerId ?? "manifest-free-provider";
  }

  async search(query: VisualAssetSearchQuery): Promise<VisualAssetSearchResult> {
    const warnings: string[] = [];
    let parsed: Array<VisualAssetManifestEntry & { downloadUrl?: string }> = [];
    try {
      parsed = JSON.parse(await readFile(this.manifestPath, "utf8"));
      if (!Array.isArray(parsed)) return { assets: [], warnings: [`Manifesto gratuito inválido: ${this.manifestPath}.`] };
    } catch {
      return { assets: [], warnings: [] };
    }

    const assets: VisualAssetMetadata[] = [];
    for (const entry of parsed) {
      try {
        const absolutePath = await this.ensureLocalFile(entry);
        const dimensions = await readRasterDimensions(absolutePath);
        const tags = normalizeTags(entry.tags ?? []);
        const haystack = normalizeTags([entry.theme, entry.emotion, entry.kind, ...tags].filter(Boolean) as string[]);
        const required = normalizeTags(query.requiredTags);
        if (required.length > 0 && !required.some((tag) => haystack.some((candidate) => candidate.includes(tag) || tag.includes(candidate)))) continue;
        assets.push({
          id: entry.id,
          provider: entry.provider ?? this.providerId,
          origin: "free_provider",
          absolutePath,
          author: entry.author,
          sourceUrl: entry.sourceUrl ?? entry.downloadUrl,
          license: entry.license,
          downloadedAt: entry.downloadedAt ?? new Date().toISOString(),
          tags,
          theme: entry.theme,
          emotion: entry.emotion,
          width: dimensions.width,
          height: dimensions.height,
          aspectRatio: normalizeAspectRatio(dimensions.width, dimensions.height),
          kind: entry.kind ?? inferKind(tags),
        });
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { assets, warnings };
  }

  private async ensureLocalFile(entry: VisualAssetManifestEntry & { downloadUrl?: string }): Promise<string> {
    const localPath = resolve(dirname(this.manifestPath), entry.path);
    try {
      const fileStat = await stat(localPath);
      if (fileStat.isFile() && fileStat.size > 0) return localPath;
    } catch {
      // segue para download opcional
    }
    if (!entry.downloadUrl) throw new Error(`Asset gratuito sem arquivo local e sem downloadUrl: ${entry.id}.`);
    await mkdir(this.cacheDir, { recursive: true });
    const targetPath = resolve(this.cacheDir, entry.path.replace(/[\\/]/g, "-"));
    if (entry.downloadUrl.startsWith("file://")) {
      await copyFile(entry.downloadUrl.replace(/^file:\/\//, ""), targetPath);
      return targetPath;
    }
    if (typeof fetch !== "function") throw new Error(`fetch indisponível para baixar ${entry.id}.`);
    const response = await fetch(entry.downloadUrl);
    if (!response.ok) throw new Error(`Falha ao baixar ${entry.id}: HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await BunlessWriteFile(targetPath, bytes);
    return targetPath;
  }
}

async function BunlessWriteFile(path: string, bytes: Uint8Array): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, bytes);
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}
