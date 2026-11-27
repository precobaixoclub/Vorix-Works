/**
 * Movimento por IA no motor híbrido: estimativa de custo ANTES de gerar, limite mensal por workspace,
 * registro de cada geração, armazenamento seguro do clipe, verificação automática de fidelidade do produto,
 * decisão final com a revisão visual e descarte do clipe reprovado. Quem chama decide a alternativa
 * (a foto original) quando o clipe não é aprovado.
 *
 * Nada aqui é ativado sozinho: sem `enabled`, sem chave do provedor ou com limite zero, a geração é
 * bloqueada e registrada — nenhuma chamada paga acontece.
 */

import { createHash, randomUUID } from "node:crypto";
import { estimateMotionCost, MotionProviderError, type MotionAspect, type MotionProviderRegistry } from "./motion-provider.js";

export type MotionStatus = "blocked_budget" | "blocked_disabled" | "submitted" | "failed" | "generated" | "approved" | "rejected";

export type MotionGeneration = {
  id: string; tenantId: string; workspaceId: string; provider: string; model: string;
  sourceObjectKey: string; sourceSha256: string; prompt: string; seconds: number; estimatedUsd: number;
  status: MotionStatus; providerJobId?: string; clipObjectKey?: string; clipSha256?: string;
  fidelity?: unknown; review?: unknown; error?: string; origin: Record<string, unknown>;
  createdAt: string; updatedAt: string;
};

export interface MotionGenerationRepository {
  insert(record: MotionGeneration): Promise<void>;
  update(id: string, patch: Partial<MotionGeneration>): Promise<void>;
  get(scope: { tenantId: string; workspaceId: string }, id: string): Promise<MotionGeneration | undefined>;
  /** Soma do custo estimado das gerações enviadas ao provedor no mês (UTC) — base do limite. */
  spentThisMonth(scope: { tenantId: string; workspaceId: string }, now: Date): Promise<number>;
}

export type MotionPolicy = {
  enabled: boolean;
  /** Workspaces liberados ("*" = todos os habilitados). */
  workspaces: readonly string[];
  /** Limite mensal em US$ por workspace (0 = nenhuma geração paga). */
  monthlyUsdPerWorkspace: number;
  /** Limite por geração (protege contra um modelo caro escolhido por engano). */
  maxUsdPerGeneration: number;
};

export type FidelityCheck = (input: { originalImage: Buffer; clip: Buffer; region?: { x: number; y: number; w: number; h: number } }) => Promise<{ report: { verdict: "pass" | "fail"; reasons: string[] }; sheet: Buffer }>;

export type MotionGenerationDeps = {
  registry: MotionProviderRegistry;
  repository: MotionGenerationRepository;
  policy: MotionPolicy;
  storage: { put(input: { key: string; body: Buffer; contentType: string }): Promise<unknown>; delete?(key: string): Promise<unknown> };
  fidelity: FidelityCheck;
  now?: () => Date;
  id?: () => string;
};

export type GenerateMotionInput = {
  scope: { tenantId: string; workspaceId: string };
  provider: string;
  model: string;
  source: { objectKey: string; bytes: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp" };
  prompt: string;
  seconds: number;
  aspect: MotionAspect;
  region?: { x: number; y: number; w: number; h: number };
  origin?: Record<string, unknown>;
};

export type GenerateMotionOutcome =
  | { ok: true; generation: MotionGeneration; clip: Buffer; fidelitySheet: Buffer }
  | { ok: false; generation: MotionGeneration; reason: string; fallback: "original_image" };

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export class MotionGenerationService {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly deps: MotionGenerationDeps) {
    this.now = deps.now ?? (() => new Date());
    this.id = deps.id ?? (() => `vmg-${randomUUID()}`);
  }

  /** Custo estimado (sem chamar o provedor). */
  estimate(provider: string, model: string, seconds: number) {
    const spec = this.deps.registry.spec(provider, model);
    if (!spec) throw new MotionProviderError("invalid", `modelo desconhecido: ${provider}/${model}`);
    return { ...estimateMotionCost(spec, seconds), spec };
  }

  async budget(scope: { tenantId: string; workspaceId: string }) {
    const spent = await this.deps.repository.spentThisMonth(scope, this.now());
    return { limitUsd: this.deps.policy.monthlyUsdPerWorkspace, spentUsd: Math.round(spent * 10000) / 10000, remainingUsd: Math.max(0, Math.round((this.deps.policy.monthlyUsdPerWorkspace - spent) * 10000) / 10000) };
  }

  async generate(input: GenerateMotionInput): Promise<GenerateMotionOutcome> {
    const { seconds, usd, spec } = this.estimate(input.provider, input.model, input.seconds);
    const at = this.now().toISOString();
    const generation: MotionGeneration = {
      id: this.id(), ...input.scope, provider: input.provider, model: input.model, sourceObjectKey: input.source.objectKey, sourceSha256: sha(input.source.bytes),
      prompt: input.prompt.slice(0, 1500), seconds, estimatedUsd: usd, status: "submitted", origin: input.origin ?? {}, createdAt: at, updatedAt: at,
    };
    const block = async (status: "blocked_budget" | "blocked_disabled", reason: string): Promise<GenerateMotionOutcome> => {
      Object.assign(generation, { status, error: reason });
      await this.deps.repository.insert(generation);
      return { ok: false, generation, reason, fallback: "original_image" };
    };
    const provider = this.deps.registry.get(input.provider);
    const policy = this.deps.policy;
    if (!policy.enabled || !(policy.workspaces.includes("*") || policy.workspaces.includes(input.scope.workspaceId))) return block("blocked_disabled", "movimento por IA desligado para esta marca");
    if (!provider?.configured) return block("blocked_disabled", `provedor ${input.provider} sem chave configurada`);
    if (!spec.aspects.includes(input.aspect)) return block("blocked_disabled", `${spec.label} não gera ${input.aspect}`);
    if (usd > policy.maxUsdPerGeneration) return block("blocked_budget", `geração estimada em US$ ${usd.toFixed(2)} passa do limite por geração (US$ ${policy.maxUsdPerGeneration.toFixed(2)})`);
    const { remainingUsd } = await this.budget(input.scope);
    if (usd > remainingUsd) return block("blocked_budget", `limite mensal da marca: restam US$ ${remainingUsd.toFixed(2)}, a geração custa ~US$ ${usd.toFixed(2)}`);

    await this.deps.repository.insert(generation);
    let clip: Buffer;
    try {
      const result = await provider.generate({ model: input.model, image: { bytes: input.source.bytes, mimeType: input.source.mimeType }, prompt: input.prompt, seconds, aspect: input.aspect });
      clip = result.video;
      generation.providerJobId = result.providerJobId;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : String(error);
      await this.deps.repository.update(generation.id, { status: "failed", error: reason, updatedAt: this.now().toISOString() });
      return { ok: false, generation: { ...generation, status: "failed", error: reason }, reason, fallback: "original_image" };
    }
    if (clip.length < 1000 || clip.length > 80 * 1024 * 1024) {
      const reason = `clipe inválido (${clip.length} bytes)`;
      await this.deps.repository.update(generation.id, { status: "failed", error: reason, providerJobId: generation.providerJobId, updatedAt: this.now().toISOString() });
      return { ok: false, generation: { ...generation, status: "failed", error: reason }, reason, fallback: "original_image" };
    }
    // Fidelidade automática ANTES de guardar: clipe reprovado nem chega ao storage.
    const { report, sheet } = await this.deps.fidelity({ originalImage: input.source.bytes, clip, region: input.region });
    if (report.verdict !== "pass") {
      const reason = `produto não preservado: ${report.reasons.slice(0, 4).join("; ")}`;
      await this.deps.repository.update(generation.id, { status: "rejected", fidelity: report, error: reason, providerJobId: generation.providerJobId, clipSha256: sha(clip), updatedAt: this.now().toISOString() });
      return { ok: false, generation: { ...generation, status: "rejected", fidelity: report, error: reason }, reason, fallback: "original_image" };
    }
    const clipSha256 = sha(clip);
    const key = `${input.scope.tenantId}/${input.scope.workspaceId}/video-motion/${generation.id}-${clipSha256.slice(0, 16)}.mp4`;
    await this.deps.storage.put({ key, body: clip, contentType: "video/mp4" });
    const patch = { status: "generated" as const, clipObjectKey: key, clipSha256, fidelity: report, providerJobId: generation.providerJobId, updatedAt: this.now().toISOString() };
    await this.deps.repository.update(generation.id, patch);
    return { ok: true, generation: { ...generation, ...patch }, clip, fidelitySheet: sheet };
  }

  /**
   * Decisão final, com a revisão visual (Codex/pessoa). Só aprova clipe que passou na medida automática E na
   * revisão; reprovado é descartado do storage e quem chama usa a foto original.
   */
  async decide(scope: { tenantId: string; workspaceId: string }, id: string, review: { approved: boolean; findings: string[]; reviewer: string }): Promise<MotionGeneration> {
    const generation = await this.deps.repository.get(scope, id);
    if (!generation || generation.status !== "generated") throw new Error("geração não está aguardando decisão");
    const status: MotionStatus = review.approved ? "approved" : "rejected";
    if (!review.approved && generation.clipObjectKey) await this.deps.storage.delete?.(generation.clipObjectKey).catch(() => undefined);
    const patch = { status, review, ...(review.approved ? {} : { clipObjectKey: undefined, error: `revisão visual: ${review.findings.slice(0, 4).join("; ")}` }), updatedAt: this.now().toISOString() };
    await this.deps.repository.update(id, patch);
    return { ...generation, ...patch };
  }
}

export class InMemoryMotionGenerationRepository implements MotionGenerationRepository {
  readonly rows = new Map<string, MotionGeneration>();
  async insert(record: MotionGeneration) { this.rows.set(record.id, { ...record }); }
  async update(id: string, patch: Partial<MotionGeneration>) { const row = this.rows.get(id); if (row) this.rows.set(id, { ...row, ...patch }); }
  async get(scope: { tenantId: string; workspaceId: string }, id: string) { const row = this.rows.get(id); return row && row.tenantId === scope.tenantId && row.workspaceId === scope.workspaceId ? { ...row } : undefined; }
  async spentThisMonth(scope: { tenantId: string; workspaceId: string }, now: Date) {
    const month = now.toISOString().slice(0, 7);
    return [...this.rows.values()].filter((row) => row.tenantId === scope.tenantId && row.workspaceId === scope.workspaceId && row.createdAt.slice(0, 7) === month && !row.status.startsWith("blocked")).reduce((sum, row) => sum + row.estimatedUsd, 0);
  }
}
