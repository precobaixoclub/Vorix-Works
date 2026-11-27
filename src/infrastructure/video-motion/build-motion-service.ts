/** Monta o serviço de movimento por IA a partir da configuração (sem chave/flag: tudo bloqueado e registrado). */
import { join } from "node:path";
import { tmpdir } from "node:os";
import type pg from "pg";
import { MotionProviderRegistry } from "../../application/video-motion/motion-provider.js";
import { InMemoryMotionGenerationRepository, MotionGenerationService } from "../../application/video-motion/motion-generation.service.js";
import { PostgresMotionGenerationRepository } from "../storage/postgres/postgres-motion-generation-repository.js";
import { GoogleVeoMotionProvider, RunwayMotionProvider } from "./motion-providers.js";
import { fidelityCheckIn } from "./product-fidelity.js";

export type VideoMotionConfig = { enabled: boolean; workspaces: readonly string[]; monthlyUsdPerWorkspace: number; maxUsdPerGeneration: number; provider: string; model: string; googleApiKey?: string; runwayApiKey?: string };

export function buildMotionGenerationService(input: { config: VideoMotionConfig; pool?: pg.Pool; storage: { put(input: { key: string; body: Buffer; contentType: string }): Promise<unknown>; delete?(key: string): Promise<unknown> }; workDir?: string }) {
  const registry = new MotionProviderRegistry()
    .register(new GoogleVeoMotionProvider({ apiKey: input.config.googleApiKey }))
    .register(new RunwayMotionProvider({ apiKey: input.config.runwayApiKey }));
  const service = new MotionGenerationService({
    registry,
    repository: input.pool ? new PostgresMotionGenerationRepository(input.pool) : new InMemoryMotionGenerationRepository(),
    policy: { enabled: input.config.enabled, workspaces: input.config.workspaces, monthlyUsdPerWorkspace: input.config.monthlyUsdPerWorkspace, maxUsdPerGeneration: input.config.maxUsdPerGeneration },
    storage: input.storage,
    fidelity: fidelityCheckIn(input.workDir ?? join(tmpdir(), "vorix-motion")),
  });
  return { service, registry, defaults: { provider: input.config.provider, model: input.config.model } };
}
