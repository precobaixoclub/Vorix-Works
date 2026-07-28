import type pg from "pg";
import type { AuthPort } from "../../../application/ports/auth.port.js";
import type { AssetLibraryRepositoryPort } from "../../../application/ports/asset-library-repository.port.js";
import type { ChatRepositoryPort } from "../../../application/ports/chat-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../application/ports/workspace-repository.port.js";
import { createNoopAuthAdapter } from "../../../infrastructure/auth/noop-auth-adapter.js";
import { buildPlatformRepositories } from "../../../infrastructure/storage/build-platform-repositories.js";
import type { ApiConfig } from "../config/api-config.js";

/**
 * Raiz de composição da API — mesmo papel que `buildRuntime()` cumpre para a CLI
 * (`src/interfaces/cli/run-command.ts`), só que para o transporte HTTP. Ainda enxuto: Arthur/
 * Caio/Helena/Valentina/Clara/Icaro NÃO são conectados aqui (nenhum endpoint desta sprint os
 * consome — conectar sem uso seria acoplamento prematuro).
 *
 * Sprint 03 (Fase 5): os repositórios de Workspace/Asset Library/Chat entram aqui, mas a
 * CONSTRUÇÃO deles (memória vs. Postgres) não vive neste arquivo — vive em
 * `buildPlatformRepositories` (`src/infrastructure/storage/`), o único ponto compartilhável entre
 * API e uma futura CLI que precise dos mesmos Ports. Este container só decide "quais peças a API
 * usa", nunca "como construir uma peça" — essa segunda responsabilidade pertence à fábrica.
 */
export type ApiContainer = {
  authPort: AuthPort;
  workspaceRepository: WorkspaceRepositoryPort;
  assetLibraryRepository: AssetLibraryRepositoryPort;
  chatRepository: ChatRepositoryPort;
  /** Presente só quando `persistenceDriver === "postgres"` — `app.ts` fecha isto no hook `onClose`. */
  pool?: pg.Pool;
};

export function buildApiContainer(config?: Pick<ApiConfig, "persistenceDriver" | "databaseUrl" | "devPrincipal">): ApiContainer {
  const repositories = buildPlatformRepositories({
    driver: config?.persistenceDriver ?? "memory",
    databaseUrl: config?.databaseUrl,
  });

  return {
    authPort: createNoopAuthAdapter({ devPrincipal: config?.devPrincipal }),
    ...repositories,
  };
}
