/**
 * Geração de MOVIMENTO por IA (imagem → vídeo curto) para o motor híbrido de vídeos. Um provedor recebe a
 * foto ORIGINAL do produto e um prompt de movimento e devolve um clipe curto; o motor FFmpeg continua
 * editando, legendando e exportando. Novos provedores entram implementando esta interface — o restante
 * (custo, limite, registro, fidelidade, timeline) não muda.
 *
 * Preços: tabela por modelo, conferida na página oficial de cada provedor (campo `pricingSource`). O
 * custo é ESTIMADO antes de gerar (segundos × preço, com cobrança mínima) e é o que o limite controla.
 */

export type MotionAspect = "9:16" | "16:9" | "1:1";

export type MotionModelSpec = {
  provider: string;
  model: string;
  label: string;
  /** Durações aceitas pela API, em segundos (a menor é a duração mínima do clipe). */
  durations: readonly number[];
  usdPerSecond: number;
  /** Cobrança mínima por geração (ex.: Runway Gen-4 Turbo: 10 créditos = US$ 0,10). */
  minimumUsd: number;
  resolution: "720p" | "1080p";
  aspects: readonly MotionAspect[];
  /** O clipe vem com áudio gerado (o motor descarta: a trilha é a do vídeo). */
  audio: boolean;
  pricingSource: string;
  /** Data em que o preço foi conferido. */
  pricingCheckedAt: string;
};

export type MotionRequest = {
  model: string;
  image: { bytes: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp" };
  prompt: string;
  seconds: number;
  aspect: MotionAspect;
};

export type MotionResult = { providerJobId: string; video: Buffer; mimeType: string };

export class MotionProviderError extends Error {
  constructor(readonly code: "rejected" | "failed" | "timeout" | "network" | "not_configured" | "invalid", message: string) {
    super(message);
    this.name = "MotionProviderError";
  }
}

export interface MotionProvider {
  readonly id: string;
  readonly configured: boolean;
  models(): readonly MotionModelSpec[];
  generate(request: MotionRequest, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<MotionResult>;
}

/** Menor duração aceita que cubra o pedido (o provedor não gera menos que o mínimo). */
export function billableSeconds(spec: MotionModelSpec, wanted: number): number {
  return spec.durations.find((seconds) => seconds >= wanted) ?? spec.durations[spec.durations.length - 1]!;
}

export function estimateMotionCost(spec: MotionModelSpec, wantedSeconds: number): { seconds: number; usd: number } {
  const seconds = billableSeconds(spec, wantedSeconds);
  return { seconds, usd: Math.round(Math.max(spec.minimumUsd, seconds * spec.usdPerSecond) * 10000) / 10000 };
}

export class MotionProviderRegistry {
  private readonly providers = new Map<string, MotionProvider>();
  register(provider: MotionProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }
  get(id: string): MotionProvider | undefined {
    return this.providers.get(id);
  }
  spec(providerId: string, model: string): MotionModelSpec | undefined {
    return this.providers.get(providerId)?.models().find((item) => item.model === model);
  }
  list(): { id: string; configured: boolean; models: readonly MotionModelSpec[] }[] {
    return [...this.providers.values()].map((provider) => ({ id: provider.id, configured: provider.configured, models: provider.models() }));
  }
}

/** Espera com timeout e cancelamento (polling das operações longas dos provedores). */
export async function pollUntil<T>(check: () => Promise<{ done: boolean; value?: T }>, options: { intervalMs: number; timeoutMs: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (options.signal?.aborted) throw new MotionProviderError("failed", "geração cancelada");
    const state = await check();
    if (state.done) return state.value as T;
    if (Date.now() > deadline) throw new MotionProviderError("timeout", "o provedor não terminou a geração no tempo limite");
    await sleep(options.intervalMs);
  }
}
