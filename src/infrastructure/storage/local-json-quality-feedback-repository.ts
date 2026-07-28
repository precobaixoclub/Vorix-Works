import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QualityFeedbackRepositoryPort } from "../../application/quality-feedback/quality-feedback-repository.port.js";
import type { QualityFeedbackRecord } from "../../application/quality-feedback/quality-feedback.types.js";
import { InMemoryQualityFeedbackRepository } from "./in-memory-quality-feedback-repository.js";

export class LocalJsonQualityFeedbackRepository implements QualityFeedbackRepositoryPort {
  private readonly filePath: string;
  private readonly memory = new InMemoryQualityFeedbackRepository();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = sanitizeFilePath(filePath);
  }

  async save(record: QualityFeedbackRecord): Promise<void> {
    await this.loadOnce();
    await this.memory.save(record);
    await this.persist();
  }

  async list(): Promise<QualityFeedbackRecord[]> {
    await this.loadOnce();
    return this.memory.list();
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const records = JSON.parse(raw) as QualityFeedbackRecord[];
      for (const record of records) await this.memory.save(record);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const records = await this.memory.list();
    await writeFile(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}

function sanitizeFilePath(filePath: string): string {
  if (!filePath?.trim()) throw new Error("Caminho do arquivo de feedback local é obrigatório.");
  if (filePath.includes("\0")) throw new Error("Caminho do arquivo de feedback local contém caractere inválido.");
  return filePath;
}
