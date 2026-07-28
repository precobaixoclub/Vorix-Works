import type { PersistenceDriver } from "../../../infrastructure/storage/build-platform-repositories.js";

/**
 * Configuração da camada HTTP — lê variáveis de ambiente uma única vez, com padrões seguros para
 * desenvolvimento local. `JWT_SECRET` continua preparado, nunca aplicado (Sprint 04). `DATABASE_URL`
 * passou a ser usado de verdade nesta sprint (Sprint 03), mas só quando `PERSISTENCE_DRIVER=postgres`
 * for definido explicitamente — o padrão (`memory`) preserva o comportamento das Sprints 01/02
 * sem exigir banco nenhum para subir a API.
 */
export type ApiConfig = {
  port: number;
  host: string;
  /** Preparado para a Sprint 04 (autenticação real). Não utilizado por nenhum código nesta sprint. */
  jwtSecret?: string;
  /** Qual adapter os repositórios de Workspace/Asset Library/Chat usam — ver `buildPlatformRepositories`. */
  persistenceDriver: PersistenceDriver;
  /** Só obrigatório quando `persistenceDriver === "postgres"`. */
  databaseUrl?: string;
  logLevel: string;
  /**
   * "Usuário de desenvolvimento" fixo para o `NoopAuthAdapter` — só existe quando
   * `DEV_PRINCIPAL_TENANT_ID` está definido (ver `.env.example`). Nunca usado em produção real;
   * existe só para exercitar endpoints com isolamento por tenant antes da Sprint 04 (autenticação
   * real).
   */
  devPrincipal?: { userId: string; tenantId: string };
};

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const PERSISTENCE_DRIVERS: readonly PersistenceDriver[] = ["memory", "postgres"];

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = parsePort(env.API_PORT) ?? DEFAULT_PORT;
  const host = env.API_HOST?.trim() || DEFAULT_HOST;
  const jwtSecret = env.JWT_SECRET?.trim() || undefined;
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const logLevel = env.ZUNO_LOG_LEVEL?.trim() || "info";
  const persistenceDriver = parsePersistenceDriver(env.PERSISTENCE_DRIVER);
  const devPrincipalTenantId = env.DEV_PRINCIPAL_TENANT_ID?.trim() || undefined;
  const devPrincipal = devPrincipalTenantId
    ? { userId: env.DEV_PRINCIPAL_USER_ID?.trim() || "dev-user", tenantId: devPrincipalTenantId }
    : undefined;

  return { port, host, jwtSecret, persistenceDriver, databaseUrl, logLevel, devPrincipal };
}

function parsePersistenceDriver(raw: string | undefined): PersistenceDriver {
  const trimmed = raw?.trim();
  if (trimmed && (PERSISTENCE_DRIVERS as readonly string[]).includes(trimmed)) return trimmed as PersistenceDriver;
  return "memory";
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return undefined;
  return parsed;
}
