import { statSync } from "node:fs";

/**
 * Healthcheck do `vorix-worker` — Módulo Conversas, Fase 6. Pensado para rodar como `HEALTHCHECK`
 * do Docker (`docker-compose.zuno.yml`), nunca via HTTP (o worker não tem servidor HTTP de
 * negócio, só `/metrics` opcional). Um `docker ps` saudável só prova que o PROCESSO existe — não
 * prova que ele ainda está consumindo de verdade (event loop travado, conexão zumbi com o
 * RabbitMQ...). Este script checa a IDADE do arquivo de heartbeat (tocado a cada
 * `INBOX_WORKER_HEARTBEAT_INTERVAL_MS` pelo próprio worker, ver `inbox-worker.ts`) — se estiver
 * mais velho que o teto configurado, o worker é considerado travado e o Docker reinicia o
 * container (`restart: unless-stopped`).
 *
 * Exit 0 = saudável; exit 1 = travado ou arquivo ausente/inacessível.
 */

const heartbeatFile = process.env.INBOX_WORKER_HEARTBEAT_FILE?.trim() || `${process.cwd()}/.inbox-worker-heartbeat`;
const maxAgeMs = Number.parseInt(process.env.INBOX_WORKER_HEARTBEAT_MAX_AGE_MS ?? "", 10) || 90_000;

try {
  const stats = statSync(heartbeatFile);
  const ageMs = Date.now() - stats.mtimeMs;
  if (ageMs > maxAgeMs) {
    console.error(`[inbox-worker-healthcheck] heartbeat com ${Math.round(ageMs / 1000)}s (> ${Math.round(maxAgeMs / 1000)}s) — worker considerado travado.`);
    process.exit(1);
  }
  console.log(`[inbox-worker-healthcheck] OK — heartbeat com ${Math.round(ageMs / 1000)}s.`);
  process.exit(0);
} catch (error) {
  console.error(`[inbox-worker-healthcheck] falha ao ler o arquivo de heartbeat ("${heartbeatFile}"):`, error instanceof Error ? error.message : error);
  process.exit(1);
}
