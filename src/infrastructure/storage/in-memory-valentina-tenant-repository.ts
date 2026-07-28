import type { ValentinaTenantRepositoryPort } from "../../application/tenancy/valentina-repository.port.js";
import type { TenantQuery, TenantRecord } from "../../application/tenancy/valentina.types.js";

export class InMemoryValentinaTenantRepository implements ValentinaTenantRepositoryPort {
  private readonly records = new Map<string, TenantRecord>();

  async save(record: TenantRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    return clone(this.records.get(id));
  }

  async findByClientId(clientId: string): Promise<TenantRecord | undefined> {
    return clone(Array.from(this.records.values()).find((record) => record.clientId === clientId));
  }

  async list(query: TenantQuery = {}): Promise<TenantRecord[]> {
    const status = query.status ?? "active";
    const records = Array.from(this.records.values()).filter((record) => {
      if (query.tenantId && record.id !== query.tenantId) return false;
      if (query.clientId && record.clientId !== query.clientId) return false;
      if (query.plan && record.plan !== query.plan) return false;
      if (query.environment && record.settings.environment !== query.environment) return false;
      if (status !== "all" && record.status !== status) return false;
      return true;
    });

    return (typeof query.limit === "number" ? records.slice(0, query.limit) : records).map(clone);
  }

  clear(): void {
    this.records.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
