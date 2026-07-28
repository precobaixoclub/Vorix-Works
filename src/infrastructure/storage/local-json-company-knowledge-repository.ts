import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CompanyKnowledgeRepositoryPort } from "../../application/company-intelligence/company-knowledge-repository.port.js";
import type { CompanyKnowledgeBase } from "../../domain/company-intelligence/company-intelligence.model.js";

/** Persistência local em JSON, uma base por domínio — mesmo padrão load-once/full-rewrite de `LocalJsonClaraKnowledgeRepository`. */
export class LocalJsonCompanyKnowledgeRepository implements CompanyKnowledgeRepositoryPort {
  private readonly filePath: string;
  private readonly byDomain = new Map<string, CompanyKnowledgeBase>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = sanitizeFilePath(filePath);
  }

  async save(base: CompanyKnowledgeBase): Promise<void> {
    await this.loadOnce();
    this.byDomain.set(base.profile.domain, base);
    await this.persist();
  }

  async findByDomain(domain: string): Promise<CompanyKnowledgeBase | undefined> {
    await this.loadOnce();
    return this.byDomain.get(domain);
  }

  async list(): Promise<CompanyKnowledgeBase[]> {
    await this.loadOnce();
    return Array.from(this.byDomain.values());
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const bases = JSON.parse(raw) as CompanyKnowledgeBase[];
      for (const base of bases) this.byDomain.set(base.profile.domain, base);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(Array.from(this.byDomain.values()), null, 2), "utf8");
  }
}

function sanitizeFilePath(filePath: string): string {
  if (!filePath?.trim()) throw new Error("Caminho do arquivo de conhecimento de empresa é obrigatório.");
  if (filePath.includes("\0")) throw new Error("Caminho do arquivo de conhecimento de empresa contém caractere inválido.");
  return filePath;
}
