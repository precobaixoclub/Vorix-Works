import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { InMemoryMediaCatalog } from "./in-memory-media-catalog.js";
import { scanMediaFiles, type MediaManifestSeed } from "./media-file-scanner.js";
import type { VisualAssetManifestEntry } from "../visual-assets/visual-asset-metadata.js";
import type { VisualAssetKind } from "../../application/ports/visual-asset-provider.port.js";

function mapVisualKindToMediaType(kind: VisualAssetKind | undefined): MediaAssetType | undefined {
  switch (kind) {
    case "photo": return "photo";
    case "video": return "video";
    case "b_roll": return "b_roll";
    case "cinemagraph": return "cinemagraph";
    case "mockup": return "mockup";
    case "graphic": return "graphic";
    default: return undefined;
  }
}
import type {
  MediaAssetRecord,
  MediaAssetType,
  MediaApprovalStatus,
  MediaAssetUsageRecord,
  MediaCatalogPort,
  MediaCollectionRecord,
  MediaCollectionStats,
  MediaGapAnalysisResult,
  MediaHealthReport,
  MediaLicenseStatus,
  MediaScanOptions,
  MediaScanResult,
  MediaSearchQuery,
  MediaSearchResult,
  MediaShotPlanEntry,
} from "../../application/ports/media-catalog.port.js";

function sanitizeFilePath(filePath: string): string {
  if (!filePath || filePath.includes("\0")) throw new Error("Caminho de arquivo inválido para o catálogo de mídia.");
  return filePath;
}

/**
 * MEDIA INTELLIGENCE ENGINE — persistência JSON do catálogo, seguindo exatamente o mesmo padrão de
 * `LocalJsonClaraKnowledgeRepository`/`LocalJsonValentinaTenantRepository`: carrega o arquivo inteiro
 * uma vez (`loadOnce`), delega toda a lógica real para `InMemoryMediaCatalog`, e reescreve o arquivo
 * inteiro a cada mutação (`persist`) — sem envelope de versão, sem lock de concorrência, mesma
 * limitação já aceita pelos outros repositórios deste projeto. Dois arquivos JSON (assets e
 * coleções), cada um um array plano, no mesmo espírito dos repositórios existentes.
 */
export class MediaCatalogRepository implements MediaCatalogPort {
  private readonly assetsFilePath: string;
  private readonly collectionsFilePath: string;
  private readonly memory = new InMemoryMediaCatalog();
  private readonly defaultRoots: string[];
  /**
   * Manifestos legados (ex.: `assets/visual/library/manifest.json`) autorados à mão em sprints
   * anteriores, com autor/licença/tags/tema JÁ CONHECIDOS para arquivos específicos — usados como
   * semente na primeira varredura de cada arquivo, para nunca reportar `licenseStatus: "unknown"`
   * quando a licença real já está documentada em algum lugar do projeto (ver `MediaManifestSeed`).
   */
  private readonly legacyManifestPaths: string[];
  private loaded = false;

  constructor(options: { assetsFilePath: string; collectionsFilePath: string; defaultRoots: string[]; legacyManifestPaths?: string[] }) {
    this.assetsFilePath = sanitizeFilePath(options.assetsFilePath);
    this.collectionsFilePath = sanitizeFilePath(options.collectionsFilePath);
    this.legacyManifestPaths = options.legacyManifestPaths ?? [];
    this.defaultRoots = options.defaultRoots;
  }

  async scan(options?: MediaScanOptions): Promise<MediaScanResult> {
    await this.loadOnce();
    const existingRecords = await this.memory.list();
    const roots = options?.roots && options.roots.length > 0 ? options.roots : this.defaultRoots;
    const manifestSeeds = await this.loadManifestSeeds();
    const { records, result } = await scanMediaFiles({ roots, existingRecords, manifestSeeds });
    for (const record of records) await this.memory.upsert(record);
    await this.persistAssets();
    return result;
  }

  private async loadManifestSeeds(): Promise<MediaManifestSeed[]> {
    const seeds: MediaManifestSeed[] = [];
    for (const manifestPath of this.legacyManifestPaths) {
      try {
        const raw = await readFile(manifestPath, "utf8");
        const entries = JSON.parse(raw) as VisualAssetManifestEntry[];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!entry.path) continue;
          seeds.push({
            absolutePath: resolve(dirname(manifestPath), entry.path),
            author: entry.author,
            sourceUrl: entry.sourceUrl,
            license: entry.license,
            tags: entry.tags,
            themes: entry.theme ? [entry.theme] : undefined,
            emotion: entry.emotion,
            origin: entry.origin === "developer_assisted" ? "developer_assisted" : entry.origin === "free_provider" ? "external_provider" : "local_library",
            type: mapVisualKindToMediaType(entry.kind),
          });
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
    }
    return seeds;
  }

  async list(filter?: { type?: MediaAssetType; approvalStatus?: MediaApprovalStatus; licenseStatus?: MediaLicenseStatus }): Promise<MediaAssetRecord[]> {
    await this.loadOnce();
    return this.memory.list(filter);
  }

  async get(assetId: string): Promise<MediaAssetRecord | undefined> {
    await this.loadOnce();
    return this.memory.get(assetId);
  }

  async search(query: MediaSearchQuery): Promise<MediaSearchResult> {
    await this.loadOnce();
    return this.memory.search(query);
  }

  async tag(assetIdOrPath: string, tags: string[]): Promise<MediaAssetRecord> {
    await this.loadOnce();
    const updated = await this.memory.tag(assetIdOrPath, tags);
    await this.persistAssets();
    return updated;
  }

  async approve(assetId: string, note?: string): Promise<MediaAssetRecord> {
    await this.loadOnce();
    const updated = await this.memory.approve(assetId, note);
    await this.persistAssets();
    return updated;
  }

  async reject(assetId: string, reason?: string): Promise<MediaAssetRecord> {
    await this.loadOnce();
    const updated = await this.memory.reject(assetId, reason);
    await this.persistAssets();
    return updated;
  }

  async remove(assetId: string): Promise<void> {
    await this.loadOnce();
    await this.memory.remove(assetId);
    await this.persistAssets();
  }

  async recordUsage(assetId: string, usage: MediaAssetUsageRecord): Promise<void> {
    await this.loadOnce();
    await this.memory.recordUsage(assetId, usage);
    await this.persistAssets();
  }

  async indexAcquiredAsset(record: MediaAssetRecord): Promise<void> {
    await this.loadOnce();
    await this.memory.upsert(record);
    await this.persistAssets();
  }

  async healthReport(): Promise<MediaHealthReport> {
    await this.loadOnce();
    return this.memory.healthReport();
  }

  async gapAnalysis(shotPlan: MediaShotPlanEntry[]): Promise<MediaGapAnalysisResult> {
    await this.loadOnce();
    return this.memory.gapAnalysis(shotPlan);
  }

  async listCollections(): Promise<MediaCollectionRecord[]> {
    await this.loadOnce();
    return this.memory.listCollections();
  }

  async createCollection(input: { name: string; description?: string; assetIds: string[] }): Promise<MediaCollectionRecord> {
    await this.loadOnce();
    const record = await this.memory.createCollection(input);
    await this.persistCollections();
    return record;
  }

  async collectionStats(collectionId: string): Promise<MediaCollectionStats | undefined> {
    await this.loadOnce();
    return this.memory.collectionStats(collectionId);
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.assetsFilePath, "utf8");
      const records = JSON.parse(raw) as MediaAssetRecord[];
      for (const record of records) await this.memory.upsert(record);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    try {
      const raw = await readFile(this.collectionsFilePath, "utf8");
      const records = JSON.parse(raw) as MediaCollectionRecord[];
      await this.memory.loadCollections(records);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persistAssets(): Promise<void> {
    await mkdir(dirname(this.assetsFilePath), { recursive: true });
    const records = await this.memory.list();
    await writeFile(this.assetsFilePath, JSON.stringify(records, null, 2), "utf8");
  }

  private async persistCollections(): Promise<void> {
    await mkdir(dirname(this.collectionsFilePath), { recursive: true });
    const records = await this.memory.listCollections();
    await writeFile(this.collectionsFilePath, JSON.stringify(records, null, 2), "utf8");
  }
}
