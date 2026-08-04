import type { Pool } from "pg";
import type {
  AssetLibraryRepositoryPort,
  CreateAssetLibraryInput,
  RegisterAssetInput,
} from "../../../application/ports/asset-library-repository.port.js";
import type { AssetKind, AssetLibrary, AssetRecord, AssetStorageRef } from "../../../domain/asset-library/asset-library.model.js";

export type AssetLibraryIdGenerator = (prefix: string) => string;

const defaultIdGenerator: AssetLibraryIdGenerator = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

type AssetLibraryRow = { id: string; workspace_id: string; created_at: Date; updated_at: Date };

type AssetRow = {
  id: string;
  library_id: string;
  kind: string;
  name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  tags: string[] | null;
  storage_ref: AssetStorageRef | null;
};

/**
 * Adapter Postgres de `AssetLibraryRepositoryPort` — Sprint 03 (Fase 4). Os mesmos códigos de erro
 * do adapter em memória (`ASSET_LIBRARY_ALREADY_EXISTS`, `ASSET_LIBRARY_NOT_FOUND`,
 * `ASSET_NOT_FOUND`) são preservados aqui, mas derivados de constraints reais do banco
 * (`unique`/`foreign key`) em vez de checagem manual em Map — a regra "uma library por workspace"
 * e "asset precisa de library existente" agora é garantida pelo próprio schema, não só pelo
 * código do adapter.
 */
export class PostgresAssetLibraryRepository implements AssetLibraryRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: AssetLibraryIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: AssetLibraryIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async createLibrary(input: CreateAssetLibraryInput): Promise<AssetLibrary> {
    const id = this.idGenerator("asset-library");
    try {
      const result = await this.pool.query<AssetLibraryRow>(
        `insert into asset_libraries (id, workspace_id, created_at, updated_at) values ($1, $2, now(), now()) returning *`,
        [id, input.workspaceId],
      );
      return this.toLibraryDomain(result.rows[0]);
    } catch (error) {
      if (isPgError(error) && error.code === UNIQUE_VIOLATION) {
        throw new Error(`ASSET_LIBRARY_ALREADY_EXISTS: workspace "${input.workspaceId}" já tem uma Asset Library.`);
      }
      throw error;
    }
  }

  async getLibraryByWorkspace(workspaceId: string): Promise<AssetLibrary | undefined> {
    const result = await this.pool.query<AssetLibraryRow>("select * from asset_libraries where workspace_id = $1", [workspaceId]);
    return result.rows[0] ? this.toLibraryDomain(result.rows[0]) : undefined;
  }

  async registerAsset(input: RegisterAssetInput): Promise<AssetRecord> {
    const id = this.idGenerator("asset");
    try {
      const result = await this.pool.query<AssetRow>(
        `insert into assets (id, library_id, kind, name, status, created_at, updated_at, tags, storage_ref)
         values ($1, $2, $3, $4, 'active', now(), now(), $5, $6::jsonb)
         returning *`,
        [id, input.libraryId, input.kind, input.name, input.tags ?? [], input.storageRef ? JSON.stringify(input.storageRef) : null],
      );
      return this.toAssetDomain(result.rows[0]);
    } catch (error) {
      if (isPgError(error) && error.code === FOREIGN_KEY_VIOLATION) {
        throw new Error(`ASSET_LIBRARY_NOT_FOUND: library "${input.libraryId}" não existe.`);
      }
      throw error;
    }
  }

  async deleteAsset(assetId: string): Promise<void> {
    await this.pool.query("delete from assets where id = $1", [assetId]);
  }

  async listAssets(libraryId: string, filter?: { kind?: AssetKind }): Promise<AssetRecord[]> {
    const conditions = ["library_id = $1"];
    const params: unknown[] = [libraryId];
    if (filter?.kind) {
      params.push(filter.kind);
      conditions.push(`kind = $${params.length}`);
    }
    const result = await this.pool.query<AssetRow>(`select * from assets where ${conditions.join(" and ")} order by created_at asc`, params);
    return result.rows.map((row) => this.toAssetDomain(row));
  }

  async getAsset(assetId: string): Promise<AssetRecord | undefined> {
    const result = await this.pool.query<AssetRow>("select * from assets where id = $1", [assetId]);
    return result.rows[0] ? this.toAssetDomain(result.rows[0]) : undefined;
  }

  async archiveAsset(assetId: string): Promise<AssetRecord> {
    const existing = await this.pool.query("select id from assets where id = $1", [assetId]);
    if (existing.rows.length === 0) {
      throw new Error(`ASSET_NOT_FOUND: asset "${assetId}" não existe.`);
    }
    const result = await this.pool.query<AssetRow>(
      `update assets set status = 'archived', archived_at = now(), updated_at = now() where id = $1 returning *`,
      [assetId],
    );
    return this.toAssetDomain(result.rows[0]);
  }

  private toLibraryDomain(row: AssetLibraryRow): AssetLibrary {
    return { id: row.id, workspaceId: row.workspace_id, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  private toAssetDomain(row: AssetRow): AssetRecord {
    return {
      id: row.id,
      libraryId: row.library_id,
      kind: row.kind as AssetKind,
      name: row.name,
      status: row.status as AssetRecord["status"],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      archivedAt: row.archived_at ? row.archived_at.toISOString() : undefined,
      tags: row.tags ?? [],
      storageRef: row.storage_ref ?? undefined,
    };
  }
}

function isPgError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
