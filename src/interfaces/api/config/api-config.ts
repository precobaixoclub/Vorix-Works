/**
 * Configuração da camada HTTP — lê variáveis de ambiente uma única vez, com padrões seguros para
 * desenvolvimento local. Nenhum valor aqui habilita banco de dados, autenticação real ou billing
 * (ver `.env.example` — `JWT_SECRET`/`DATABASE_URL` são lidos só para existirem no formato certo
 * quando as Sprints 03/04 precisarem deles; nenhum código desta sprint os utiliza de verdade).
 */
export type ApiConfig = {
  port: number;
  host: string;
  /** Preparado para a Sprint 04 (autenticação real). Não utilizado por nenhum código nesta sprint. */
  jwtSecret?: string;
  /** Preparado para a Sprint 03 (banco de dados real). Não utilizado por nenhum código nesta sprint. */
  databaseUrl?: string;
  logLevel: string;
};

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = parsePort(env.API_PORT) ?? DEFAULT_PORT;
  const host = env.API_HOST?.trim() || DEFAULT_HOST;
  const jwtSecret = env.JWT_SECRET?.trim() || undefined;
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const logLevel = env.ZUNO_LOG_LEVEL?.trim() || "info";

  return { port, host, jwtSecret, databaseUrl, logLevel };
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return undefined;
  return parsed;
}
