import type { TenantQuery, TenantRecord } from "./valentina.types.js";

export type ValentinaTenantRepositoryPort = {
  save(record: TenantRecord): Promise<void>;
  findById(id: string): Promise<TenantRecord | undefined>;
  findByClientId(clientId: string): Promise<TenantRecord | undefined>;
  list(query?: TenantQuery): Promise<TenantRecord[]>;
};
