import pg from "pg";
import type { AssetLibraryRepositoryPort } from "../../application/ports/asset-library-repository.port.js";
import type { ChatRepositoryPort } from "../../application/ports/chat-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";
import { InMemoryAssetLibraryRepository } from "./in-memory-asset-library-repository.js";
import { InMemoryChatRepository } from "./in-memory-chat-repository.js";
import { InMemoryWorkspaceRepository } from "./in-memory-workspace-repository.js";
import { PostgresAssetLibraryRepository } from "./postgres/postgres-asset-library-repository.js";
import { PostgresChatRepository } from "./postgres/postgres-chat-repository.js";
import { PostgresWorkspaceRepository } from "./postgres/postgres-workspace-repository.js";

const { Pool } = pg;

export type PersistenceDriver = "memory" | "postgres";

export type PlatformRepositories = {
  workspaceRepository: WorkspaceRepositoryPort;
  assetLibraryRepository: AssetLibraryRepositoryPort;
  chatRepository: ChatRepositoryPort;
  /** Só existe quando `driver === "postgres"` — quem chama esta função é responsável por fechar (`pool.end()`) no shutdown. */
  pool?: InstanceType<typeof Pool>;
};

/**
 * Único ponto de construção dos repositórios de Workspace/Asset Library/Chat — Sprint 03 (Fase
 * 5, "composition root"). Hoje só a API (`src/interfaces/api/di/container.ts`) chama isto; a CLI
 * (`buildRuntime()`, em `src/interfaces/cli/run-command.ts`, NÃO tocado nesta sprint) ainda não
 * conhece estes três domínios — não há nada para "desduplicar" entre os dois ainda, porque a CLI
 * nunca chegou a construir estes repositórios.
 *
 * O que esta função estabelece é o PONTO DE EXTENSÃO certo para quando isso deixar de ser
 * verdade: se um futuro comando de CLI precisar de Workspace/Asset Library/Chat, ele deve chamar
 * `buildPlatformRepositories` também — nunca reimplementar a escolha "memória ou Postgres" em
 * outro lugar. Isso é o que evita "dois núcleos divergentes": existe só UM lugar no projeto que
 * decide qual adapter usar para estes Ports.
 */
export function buildPlatformRepositories(options: { driver: PersistenceDriver; databaseUrl?: string }): PlatformRepositories {
  if (options.driver === "memory") {
    return {
      workspaceRepository: new InMemoryWorkspaceRepository(),
      assetLibraryRepository: new InMemoryAssetLibraryRepository(),
      chatRepository: new InMemoryChatRepository(),
    };
  }

  if (!options.databaseUrl) {
    throw new Error('PERSISTENCE_DRIVER="postgres" exige DATABASE_URL configurado (ver .env.example).');
  }

  const pool = new Pool({ connectionString: options.databaseUrl });
  return {
    workspaceRepository: new PostgresWorkspaceRepository(pool),
    assetLibraryRepository: new PostgresAssetLibraryRepository(pool),
    chatRepository: new PostgresChatRepository(pool),
    pool,
  };
}
