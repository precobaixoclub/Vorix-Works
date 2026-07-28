import type { ClaraKnowledgeRepositoryPort } from "../../application/knowledge/clara-repository.port.js";
import type { ClaraKnowledgeRecord, ClaraKnowledgeSearchQuery } from "../../application/knowledge/clara.types.js";

export class InMemoryClaraKnowledgeRepository implements ClaraKnowledgeRepositoryPort {
  private readonly records = new Map<string, ClaraKnowledgeRecord>();

  async save(record: ClaraKnowledgeRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async findById(id: string): Promise<ClaraKnowledgeRecord | undefined> {
    return clone(this.records.get(id));
  }

  async list(): Promise<ClaraKnowledgeRecord[]> {
    return Array.from(this.records.values()).map(clone);
  }

  async search(query: ClaraKnowledgeSearchQuery): Promise<ClaraKnowledgeRecord[]> {
    const records = await this.list();
    const normalizedText = normalize(query.text ?? "");
    const keywords = (query.keywords ?? []).map(normalize).filter(Boolean);

    if (!normalizedText && keywords.length === 0) return records;

    return records.filter((record) => {
      const haystack = normalize(JSON.stringify({
        title: record.title,
        module: record.module,
        tags: record.tags,
        payload: record.payload,
      }));
      const matchesText = normalizedText ? haystack.includes(normalizedText) : true;
      const matchesKeywords = keywords.length ? keywords.some((keyword) => haystack.includes(keyword)) : true;
      return matchesText && matchesKeywords;
    });
  }

  clear(): void {
    this.records.clear();
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}# ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
