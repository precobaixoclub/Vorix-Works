/**
 * Adaptadores de movimento por IA. Sem chave configurada o provedor fica `configured=false` e nunca chama a
 * rede. `fetch` é injetável (os testes nunca fazem chamada paga).
 *
 * - Google Veo (Gemini API): POST models/{model}:predictLongRunning → operação → vídeo.
 *   Preço oficial por segundo (com áudio, padrão): Lite US$ 0,05 (720p) · Fast US$ 0,10 · Standard US$ 0,40.
 *   Durações 4, 6 ou 8 s (8 obrigatório em 1080p/4k e com imagens de referência).
 * - Runway (API Dev): POST /v1/image_to_video → tarefa → URL do vídeo.
 *   Créditos a US$ 0,01: Gen-4 Turbo 5/s (mínimo 10 créditos) · Gen-4.5 12/s. Duração 2–10 s.
 */

import { MotionProviderError, pollUntil, type MotionModelSpec, type MotionProvider, type MotionRequest, type MotionResult } from "../../application/video-motion/motion-provider.js";

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

type ProviderOptions = { apiKey?: string; fetch?: FetchLike; pollIntervalMs?: number; sleep?: (ms: number) => Promise<void> };

const VEO_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";
const RUNWAY_PRICING = "https://docs.dev.runwayml.com/guides/pricing/";
const CHECKED = "2026-11-27";

export const VEO_MODELS: readonly MotionModelSpec[] = [
  { provider: "google-veo", model: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite (720p)", durations: [4, 6, 8], usdPerSecond: 0.05, minimumUsd: 0, resolution: "720p", aspects: ["9:16", "16:9"], audio: true, pricingSource: VEO_PRICING, pricingCheckedAt: CHECKED },
  { provider: "google-veo", model: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast (720p)", durations: [4, 6, 8], usdPerSecond: 0.1, minimumUsd: 0, resolution: "720p", aspects: ["9:16", "16:9"], audio: true, pricingSource: VEO_PRICING, pricingCheckedAt: CHECKED },
  { provider: "google-veo", model: "veo-3.1-generate-preview", label: "Veo 3.1 Standard (720p)", durations: [4, 6, 8], usdPerSecond: 0.4, minimumUsd: 0, resolution: "720p", aspects: ["9:16", "16:9"], audio: true, pricingSource: VEO_PRICING, pricingCheckedAt: CHECKED },
];

export const RUNWAY_MODELS: readonly MotionModelSpec[] = [
  { provider: "runway", model: "gen4_turbo", label: "Runway Gen-4 Turbo", durations: [5, 10], usdPerSecond: 0.05, minimumUsd: 0.1, resolution: "720p", aspects: ["9:16", "16:9", "1:1"], audio: false, pricingSource: RUNWAY_PRICING, pricingCheckedAt: CHECKED },
  { provider: "runway", model: "gen4.5", label: "Runway Gen-4.5", durations: [5, 10], usdPerSecond: 0.12, minimumUsd: 0, resolution: "720p", aspects: ["9:16", "16:9", "1:1"], audio: false, pricingSource: RUNWAY_PRICING, pricingCheckedAt: CHECKED },
];

function dataUrl(request: MotionRequest): string {
  return `data:${request.image.mimeType};base64,${request.image.bytes.toString("base64")}`;
}

function checkRequest(models: readonly MotionModelSpec[], request: MotionRequest): MotionModelSpec {
  const spec = models.find((item) => item.model === request.model);
  if (!spec) throw new MotionProviderError("invalid", `modelo não suportado: ${request.model}`);
  if (!spec.durations.includes(request.seconds)) throw new MotionProviderError("invalid", `duração ${request.seconds}s não aceita por ${spec.label} (${spec.durations.join(", ")}s)`);
  if (!spec.aspects.includes(request.aspect)) throw new MotionProviderError("invalid", `formato ${request.aspect} não aceito por ${spec.label}`);
  if (!request.prompt.trim() || request.prompt.length > 1500) throw new MotionProviderError("invalid", "prompt de movimento vazio ou longo demais");
  return spec;
}

async function failure(response: { status: number; text(): Promise<string> }, provider: string): Promise<never> {
  const body = (await response.text().catch(() => "")).slice(0, 300);
  if (response.status === 400 || response.status === 422) throw new MotionProviderError("rejected", `${provider} recusou o pedido (${response.status}): ${body}`);
  throw new MotionProviderError("failed", `${provider} respondeu ${response.status}: ${body}`);
}

export class GoogleVeoMotionProvider implements MotionProvider {
  readonly id = "google-veo";
  private readonly base = "https://generativelanguage.googleapis.com/v1beta";
  constructor(private readonly options: ProviderOptions = {}) {}
  get configured() {
    return Boolean(this.options.apiKey);
  }
  models() {
    return VEO_MODELS;
  }

  async generate(request: MotionRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<MotionResult> {
    if (!this.options.apiKey) throw new MotionProviderError("not_configured", "Google Veo sem chave configurada");
    checkRequest(VEO_MODELS, request);
    const fetchImpl = this.options.fetch ?? (fetch as unknown as FetchLike);
    const headers = { "x-goog-api-key": this.options.apiKey, "content-type": "application/json" };
    const started = await fetchImpl(`${this.base}/models/${request.model}:predictLongRunning`, {
      method: "POST", headers, signal: options.signal,
      body: JSON.stringify({ instances: [{ prompt: request.prompt, image: { bytesBase64Encoded: request.image.bytes.toString("base64"), mimeType: request.image.mimeType } }], parameters: { aspectRatio: request.aspect, durationSeconds: request.seconds, resolution: "720p" } }),
    });
    if (!started.ok) await failure(started, "Google Veo");
    const operation = (await started.json()) as { name?: string };
    if (!operation.name) throw new MotionProviderError("failed", "Google Veo não devolveu a operação");
    const uri = await pollUntil<string>(async () => {
      const response = await fetchImpl(`${this.base}/${operation.name}`, { headers, signal: options.signal });
      if (!response.ok) await failure(response, "Google Veo");
      const state = (await response.json()) as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } } };
      if (!state.done) return { done: false };
      if (state.error) throw new MotionProviderError("failed", `Google Veo: ${state.error.message ?? "falha"}`);
      const sample = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!sample) throw new MotionProviderError("rejected", `Google Veo não gerou o vídeo (${(state.response?.generateVideoResponse?.raiMediaFilteredReasons ?? []).join("; ") || "sem motivo"})`);
      return { done: true, value: sample };
    }, { intervalMs: this.options.pollIntervalMs ?? 10_000, timeoutMs: options.timeoutMs ?? 6 * 60_000, signal: options.signal, sleep: this.options.sleep });
    const file = await fetchImpl(uri, { headers: { "x-goog-api-key": this.options.apiKey }, signal: options.signal });
    if (!file.ok) await failure(file, "Google Veo (download)");
    return { providerJobId: operation.name, video: Buffer.from(await file.arrayBuffer()), mimeType: "video/mp4" };
  }
}

export class RunwayMotionProvider implements MotionProvider {
  readonly id = "runway";
  private readonly base = "https://api.dev.runwayml.com/v1";
  constructor(private readonly options: ProviderOptions = {}) {}
  get configured() {
    return Boolean(this.options.apiKey);
  }
  models() {
    return RUNWAY_MODELS;
  }

  async generate(request: MotionRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<MotionResult> {
    if (!this.options.apiKey) throw new MotionProviderError("not_configured", "Runway sem chave configurada");
    checkRequest(RUNWAY_MODELS, request);
    const fetchImpl = this.options.fetch ?? (fetch as unknown as FetchLike);
    const headers = { authorization: `Bearer ${this.options.apiKey}`, "x-runway-version": "2024-11-06", "content-type": "application/json" };
    const ratio = { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960" }[request.aspect];
    const started = await fetchImpl(`${this.base}/image_to_video`, { method: "POST", headers, signal: options.signal, body: JSON.stringify({ model: request.model, promptImage: dataUrl(request), promptText: request.prompt, ratio, duration: request.seconds }) });
    if (!started.ok) await failure(started, "Runway");
    const task = (await started.json()) as { id?: string };
    if (!task.id) throw new MotionProviderError("failed", "Runway não devolveu a tarefa");
    const url = await pollUntil<string>(async () => {
      const response = await fetchImpl(`${this.base}/tasks/${task.id}`, { headers, signal: options.signal });
      if (!response.ok) await failure(response, "Runway");
      const state = (await response.json()) as { status?: string; output?: string[]; failure?: string };
      if (state.status === "SUCCEEDED" && state.output?.[0]) return { done: true, value: state.output[0] };
      if (state.status === "FAILED" || state.status === "CANCELLED") throw new MotionProviderError("rejected", `Runway: ${state.failure ?? state.status}`);
      return { done: false };
    }, { intervalMs: this.options.pollIntervalMs ?? 5_000, timeoutMs: options.timeoutMs ?? 6 * 60_000, signal: options.signal, sleep: this.options.sleep });
    const file = await fetchImpl(url, { signal: options.signal });
    if (!file.ok) await failure(file, "Runway (download)");
    return { providerJobId: task.id, video: Buffer.from(await file.arrayBuffer()), mimeType: "video/mp4" };
  }
}
