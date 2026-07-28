import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ValentinaTenantRepositoryPort } from "../../application/tenancy/valentina-repository.port.js";
import type { TenantQuery, TenantRecord } from "../../application/tenancy/valentina.types.js";
import { InMemoryValentinaTenantRepository } from "./in-memory-valentina-tenant-repository.js";

export class LocalJsonValentinaTenantRepository implements ValentinaTenantRepositoryPort {
  private readonly filePath: string;
  private readonly memory = new InMemoryValentinaTenantRepository();
  private loaded = false;

  constructor(filePath: string) {
    // Mesma observação de LocalJsonClaraKnowledgeRepository: o caminho final é informado uma única
    // vez pelo chamador (não há relativePath por chamada para confinar dentro de um rootDir).
    this.filePath = sanitizeFilePath(filePath);
  }

  async save(record: TenantRecord): Promise<void> {
    await this.loadOnce();
    await this.memory.save(record);
    await this.persist();
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    await this.loadOnce();
    return this.memory.findById(id);
  }

  async findByClientId(clientId: string): Promise<TenantRecord | undefined> {
    await this.loadOnce();
    return this.memory.findByClientId(clientId);
  }

  async list(query: TenantQuery = {}): Promise<TenantRecord[]> {
    await this.loadOnce();
    return this.memory.list(query);
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const records = JSON.parse(raw) as TenantRecord[];
      for (const record of records) await this.memory.save(record);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const records = await this.memory.list({ status: "all" });
    await writeFile(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}

function sanitizeFilePath(filePath: string): string {
  if (!filePath?.trim()) throw new Error("Caminho do arquivo de tenants local é obrigatório.");
  if (filePath.includes("\0")) throw new Error("Caminho do arquivo de tenants local contém caractere inválido.");
  return filePath;
}
