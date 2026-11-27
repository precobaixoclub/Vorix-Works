/**
 * Worker do motor de vídeo (Marketing › Criar vídeo com IA) — processo SEPARADO da API.
 *
 * Um render por vez no ambiente (a fila garante), threads do FFmpeg limitadas, lease com heartbeat,
 * retentativa limitada, cancelamento, limpeza da pasta de trabalho. Limites de CPU/memória vêm do
 * container (ver `docker-compose.zuno.yml`, serviço `video-worker`, perfil `video`).
 *
 * Variáveis: DATABASE_URL, JWT_SECRET, OBJECT_STORAGE_* (mesmas da API), ANTHROPIC_API_KEY (ou a
 * chave do painel admin), VIDEO_AI_MODEL, VIDEO_WORK_DIR, VIDEO_RENDER_THREADS (2),
 * VIDEO_RENDER_PRESET (veryfast), VIDEO_MAX_DURATION_SECONDS (90), VIDEO_MUSIC_LIBRARY_DIR (opcional),
 * VIDEO_PROCEDURAL_MUSIC (true: trilha original sintetizada quando não há biblioteca),
 * MEETINGS_WHISPER_* (mesma transcrição do Meetings).
 */

import { join } from "node:path";
import { processNextVideoVersion } from "../../application/video-editing/process-video-version.js";
import { pruneVideoCache } from "../../infrastructure/video-editing/ffmpeg-edit-executor.js";
import { createVideoWorkerRuntime } from "./video-worker-runtime.js";

const env = process.env;
const int = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);
const log = (message: string, details?: Record<string, unknown>) => console.log(`[video-worker] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const { deps, workDir, close } = await createVideoWorkerRuntime();
  const workerId = deps.workerId;
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; log(`${signal}: terminando após a versão atual`); });
  log("iniciado", { workerId, workDir, threads: int(env.VIDEO_RENDER_THREADS, 2), music: Boolean(deps.pickMusic) });
  // Retenção do cache de intermediários (reedições recentes reaproveitam; o resto sai do disco).
  const cacheTtlMs = int(env.VIDEO_CACHE_TTL_DAYS, 7) * 24 * 3600 * 1000;
  let lastPrune = 0;
  while (!stopping) {
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      const pruned = await pruneVideoCache(join(workDir, "cache"), cacheTtlMs).catch(() => ({ removed: 0, freedBytes: 0 }));
      if (pruned.removed > 0) log("cache limpo", pruned);
    }
    try {
      const result = await processNextVideoVersion(deps);
      if (!result) await sleep(int(env.VIDEO_POLL_MS, 3_000));
    } catch (error) {
      log("erro no ciclo", { message: error instanceof Error ? error.message : String(error) });
      await sleep(5_000);
    }
  }
  await close();
}

main().catch((error) => {
  console.error(`[video-worker] não iniciou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
