import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClaraKnowledgeRepositoryPort } from "../../application/knowledge/clara-repository.port.js";
import type { ClaraKnowledgeRecord, ClaraKnowledgeSearchQuery } from "../../application/knowledge/clara.types.js";
import { InMemoryClaraKnowledgeRepository } from "./in-memory-clara-knowledge-repository.js";

export class LocalJsonClaraKnowledgeRepository implements ClaraKnowledgeRepositoryPort {
  private readonly filePath: string;
  private readonly memory = new InMemoryClaraKnowledgeRepository();
  private loaded = false;

  constructor(filePath: string) {
    // Ao contrário de LocalArtifactDelivery (que recebe um `relativePath` por chamada e o resolve
    // com segurança dentro de um `rootDir`), aqui o chamador informa o caminho final completo uma
    // única vez, na construção — não há travessia de diretório para confinar, só uma checagem
    // sanitária contra caminho vazio ou com byte nulo (vetor de injeção em algumas APIs de arquivo).
    this.filePath = sanitizeFilePath(filePath);
  }

  async save(record: ClaraKnowledgeRecord): Promise<void> {
    await this.loadOnce();
    await this.memory.save(record);
    await this.persist();
  }

  async findById(id: string): Promise<ClaraKnowledgeRecord | undefined> {
    await this.loadOnce();
    return this.memory.findById(id);
  }

  async list(): Promise<ClaraKnowledgeRecord[]> {
    await this.loadOnce();
    return this.memory.list();
  }

  async search(query: ClaraKnowledgeSearchQuery): Promise<ClaraKnowledgeRecord[]> {
    await this.loadOnce();
    return this.memory.search(query);
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const records = JSON.parse(raw) as ClaraKnowledgeRecord[];
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
  if (!filePath?.trim()) throw new Error("Caminho do arquivo de conhecimento local é obrigatório.");
  if (filePath.includes("\0")) throw new Error("Caminho do arquivo de conhecimento local contém caractere inválido.");
  return filePath;
}
