import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { computeFileHash } from "../media-catalog/media-hash.js";
import { readRasterDimensions, normalizeAspectRatio } from "../visual-assets/visual-asset-metadata.js";
import { PRODUCT_SCREEN_SEEDS } from "./product-screen-seeds.js";
import type {
  ProductScreenCatalogPort,
  ProductScreenRecord,
  ProductScreenScanResult,
  ProductScreenSelectionQuery,
  ProductScreenApprovalStatus,
  ProductScreenDeviceTarget,
} from "../../application/ports/product-screen-catalog.port.js";
import { PRODUCT_SCREEN_NARRATIVE_INTENT_MAP } from "../../application/ports/product-screen-catalog.port.js";

function sanitizeFilePath(filePath: string): string {
  if (!filePath || filePath.includes("\0")) throw new Error("Caminho de arquivo inválido para o catálogo de telas de produto.");
  return filePath;
}

function normalizedText(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * PRODUCT COMPOSITING ENGINE — catálogo de telas do produto Rumo ao Altar, mesma convenção de
 * persistência JSON flat-array de `MediaCatalogRepository`/`MediaAcquisitionLogRepository` (carrega
 * uma vez, reescreve o arquivo inteiro a cada mutação). `scan()` NUNCA varre pastas arbitrárias —
 * só materializa os registros a partir de `PRODUCT_SCREEN_SEEDS` (curadoria manual, ver esse
 * arquivo), para nunca "inventar" uma tela de produto a partir de uma imagem que não é interface.
 */
export class ProductScreenCatalogRepository implements ProductScreenCatalogPort {
  private readonly filePath: string;
  private readonly libraryRoot: string;
  private readonly clientId: string;
  private readonly product: string;
  private records = new Map<string, ProductScreenRecord>();
  private loaded = false;

  constructor(options: { filePath: string; libraryRoot: string; clientId?: string; product?: string }) {
    this.filePath = sanitizeFilePath(options.filePath);
    this.libraryRoot = options.libraryRoot;
    this.clientId = options.clientId ?? "rumo-ao-altar";
    this.product = options.product ?? "Rumo ao Altar";
  }

  async scan(): Promise<ProductScreenScanResult> {
    await this.loadOnce();
    let added = 0;
    let updated = 0;
    const warnings: string[] = [];

    for (const seed of PRODUCT_SCREEN_SEEDS) {
      const absolutePath = join(this.libraryRoot, seed.relativePath);
      try {
        const rawDimensions = await readRasterDimensions(absolutePath);
        const hash = await computeFileHash(absolutePath);
        const crop = seed.contentCropRect;
        const width = crop?.width ?? rawDimensions.width;
        const height = crop?.height ?? rawDimensions.height;
        if (crop && (crop.x < 0 || crop.y < 0 || crop.x + crop.width > rawDimensions.width || crop.y + crop.height > rawDimensions.height)) {
          warnings.push(`Semente "${seed.relativePath}": contentCropRect fora dos limites da imagem (${rawDimensions.width}x${rawDimensions.height}) — ignorada.`);
          continue;
        }

        const screenId = `product-screen-${seed.functionality}-${hash.slice(0, 12)}`;
        const existing = this.records.get(screenId);
        const record: ProductScreenRecord = {
          screenId,
          clientId: this.clientId,
          product: this.product,
          functionality: seed.functionality,
          sourcePath: absolutePath,
          sourceType: seed.sourceType,
          deviceTarget: seed.deviceTarget,
          orientation: height >= width ? "portrait" : "landscape",
          resolution: { width, height },
          aspectRatio: normalizeAspectRatio(width, height),
          sourceEnvironment: "local_project_asset",
          approvalStatus: existing?.approvalStatus ?? "needs_review",
          tags: seed.tags,
          license: seed.license,
          hash,
          version: existing?.version ?? "1.0",
          contentCropRect: crop,
          notes: existing?.notes ?? [
            "Fonte: mockup de campanha (Pedro/Bianca), não screenshot de site publicado — este projeto simula uma agência sem site real implantado.",
            "contentCropRect determinado por inspeção visual manual (não detecção automática).",
          ],
          indexedAt: new Date().toISOString(),
        };
        this.records.set(screenId, record);
        if (existing) updated += 1; else added += 1;
      } catch (error) {
        warnings.push(`Falha ao processar semente "${seed.relativePath}": ${error instanceof Error ? error.message : String(error)}.`);
      }
    }

    await this.persist();
    return { scanned: PRODUCT_SCREEN_SEEDS.length, added, updated, unavailable: 0, warnings };
  }

  async list(filter?: { approvalStatus?: ProductScreenApprovalStatus; deviceTarget?: ProductScreenDeviceTarget }): Promise<ProductScreenRecord[]> {
    await this.loadOnce();
    let records = [...this.records.values()];
    if (filter?.approvalStatus) records = records.filter((record) => record.approvalStatus === filter.approvalStatus);
    if (filter?.deviceTarget) records = records.filter((record) => record.deviceTarget === filter.deviceTarget);
    return records.sort((a, b) => a.screenId.localeCompare(b.screenId));
  }

  async get(screenId: string): Promise<ProductScreenRecord | undefined> {
    await this.loadOnce();
    return this.records.get(screenId);
  }

  /**
   * Seleção por funcionalidade/intenção narrativa (seção 8) — nunca devolve "qualquer tela" quando
   * nada corresponde; a lista pode vir vazia, e o chamador deve tratar isso como gap real, não
   * preencher com uma tela genérica.
   */
  async select(query: ProductScreenSelectionQuery): Promise<ProductScreenRecord[]> {
    await this.loadOnce();
    let records = [...this.records.values()];
    if (query.requireApproved !== false) records = records.filter((record) => record.approvalStatus === "approved");
    if (query.deviceTarget) records = records.filter((record) => record.deviceTarget === query.deviceTarget);

    if (query.functionality) {
      const target = normalizedText(query.functionality);
      records = records.filter((record) => normalizedText(record.functionality) === target || record.tags.some((tag) => normalizedText(tag) === target));
    } else if (query.narrativeIntent) {
      const intentText = normalizedText(query.narrativeIntent);
      const matchingFunctionalities = Object.entries(PRODUCT_SCREEN_NARRATIVE_INTENT_MAP)
        .filter(([, phrases]) => phrases.some((phrase) => intentText.includes(normalizedText(phrase))))
        .map(([functionality]) => functionality);
      if (matchingFunctionalities.length > 0) {
        records = records.filter((record) => matchingFunctionalities.includes(record.functionality));
      }
    }

    return records;
  }

  async approve(screenId: string): Promise<ProductScreenRecord> {
    await this.loadOnce();
    const record = this.require(screenId);
    const updated: ProductScreenRecord = { ...record, approvalStatus: "approved" };
    this.records.set(screenId, updated);
    await this.persist();
    return updated;
  }

  async reject(screenId: string, reason?: string): Promise<ProductScreenRecord> {
    await this.loadOnce();
    const record = this.require(screenId);
    const notes = reason ? [...(record.notes ?? []), `Rejeitado: ${reason}`] : record.notes;
    const updated: ProductScreenRecord = { ...record, approvalStatus: "rejected", notes };
    this.records.set(screenId, updated);
    await this.persist();
    return updated;
  }

  async upsert(record: ProductScreenRecord): Promise<void> {
    await this.loadOnce();
    this.records.set(record.screenId, record);
    await this.persist();
  }

  private require(screenId: string): ProductScreenRecord {
    const record = this.records.get(screenId);
    if (!record) throw new Error(`Tela de produto não encontrada no catálogo: ${screenId}.`);
    return record;
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const records = JSON.parse(raw) as ProductScreenRecord[];
      for (const record of records) this.records.set(record.screenId, record);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const records = [...this.records.values()].sort((a, b) => a.screenId.localeCompare(b.screenId));
    await writeFile(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}
