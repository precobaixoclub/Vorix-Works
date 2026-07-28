import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AcquisitionLogEntry } from "./media-acquisition.js";

/**
 * REAL FOOTAGE ACQUISITION — persistência do log de aquisição (`--media-acquisition-report`),
 * mesmo padrão de `MediaCatalogRepository`: array plano em JSON, carregado uma vez, reescrito
 * inteiro a cada `append`. Guarda TODA tentativa (adquirida ou rejeitada), nunca só os sucessos —
 * o relatório de aquisição precisa mostrar rejeições para ser honesto.
 */
export class MediaAcquisitionLogRepository {
  private readonly filePath: string;
  private entries: AcquisitionLogEntry[] = [];
  private loaded = false;

  constructor(filePath: string) {
    if (!filePath || filePath.includes("\0")) throw new Error("Caminho de arquivo inválido para o log de aquisição.");
    this.filePath = filePath;
  }

  async append(entries: AcquisitionLogEntry[]): Promise<void> {
    await this.loadOnce();
    this.entries.push(...entries);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.entries, null, 2), "utf8");
  }

  async list(): Promise<AcquisitionLogEntry[]> {
    await this.loadOnce();
    return [...this.entries];
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.entries = JSON.parse(raw) as AcquisitionLogEntry[];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
}
