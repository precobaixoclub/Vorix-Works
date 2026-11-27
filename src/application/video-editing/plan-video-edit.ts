/**
 * Planejamento audiovisual por IA: pedido + materiais → plano de edição validado.
 *
 * - Usa o AI Gateway (`video_edit_planning`): créditos, limites, circuit breaker, validação
 *   estrutural e semântica são do gateway. Nada aqui chama SDK de provedor.
 * - A IA devolve um rascunho; `buildPlanFromDraft` monta o plano. Se o plano for recusado, a IA
 *   recebe os problemas exatos e tem UMA chance de corrigir (custo limitado: no máximo 2 chamadas).
 * - Revisão por conversa: o escopo permitido vem de `videoRevisionPermissions` (mesma regra da
 *   refação pelo WhatsApp); o plano revisado que mexer fora do escopo é recusado.
 */

import { randomUUID } from "node:crypto";
import type { AiFailureCategory, AiGatewayPort } from "../ports/ai-gateway.port.js";
import { VIDEO_EDIT_PLANNING_POLICY } from "../ai-gateway/policies.js";
import { applyVideoEditDraftSemanticValidation, validateVideoEditDraftStructure, type VideoEditDraft } from "../ai-gateway/schemas/video-edit-draft.v1.js";
import type { VideoEditPlanningContext } from "../ai-gateway/prompts/video-edit-plan.v1.js";
import type { VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { buildPlanFromDraft, type BuildPlanContext } from "./build-plan-from-draft.js";
import { videoRevisionPermissions, videoRevisionViolations, type VideoRevisionPermissions } from "./video-revision-scope.js";

export type PlanningUsage = { calls: number; inputTokens: number; outputTokens: number; costUsd: number; model?: string };

export type PlanningOutcome =
  | { ok: true; draft: VideoEditDraft; plan: VideoEditPlan; warnings: string[]; rationale: string; usage: PlanningUsage }
  | { ok: false; category: AiFailureCategory | "plan_rejected" | "out_of_scope"; message: string; issues: string[]; usage: PlanningUsage };

export type PlanningRequest = BuildPlanContext & {
  tenantId: string;
  products?: { name: string; details?: string }[];
  recentStrategies?: string[];
};

function promptInput(request: PlanningRequest, extra: Partial<VideoEditPlanningContext>): Record<string, unknown> {
  const context: VideoEditPlanningContext = {
    mode: "create",
    request: request.request,
    aspect: request.aspect,
    ...(request.targetDurationSeconds ? { targetDurationSeconds: request.targetDurationSeconds } : {}),
    style: { editing: request.style.editing, transitions: request.style.transitions, captions: request.style.captions, music: request.style.music },
    brand: { name: request.brand.name, tone: request.brand.tone, palette: [request.brand.primaryHex, request.brand.accentHex, request.brand.lightHex, request.brand.darkHex], ctaExamples: request.brand.ctaExamples },
    materials: request.materials
      .filter((material) => material.kind !== "audio" && material.role !== "logo")
      .map((material) => ({ id: material.id, kind: material.kind, role: material.role, label: material.label, orientation: material.width && material.height ? (material.width > material.height * 1.05 ? "horizontal" : material.height > material.width * 1.05 ? "vertical" : "quadrado") : undefined, durationSeconds: material.durationSeconds, hasSpeech: material.hasSpeech, colors: material.colors })),
    sentences: request.sentences.map((sentence) => ({ id: sentence.id, materialId: sentence.materialId, start: sentence.start, end: sentence.end, text: sentence.text })),
    products: request.products,
    recentStrategies: request.recentStrategies,
    ...extra,
  };
  return context as unknown as Record<string, unknown>;
}

/**
 * Para conferir o escopo da revisão, tempos DERIVADOS não contam como mudança: encurtar a abertura
 * desloca o início das cenas seguintes, das legendas e do logo, sem que elas tenham mudado.
 */
function scopeView(plan: VideoEditPlan): VideoEditPlan {
  return {
    ...plan,
    durationSeconds: 0,
    clips: plan.clips.map((clip) => ({ ...clip, recordStartSeconds: 0 })),
    ...(plan.captions ? { captions: { ...plan.captions, segments: [] } } : {}),
    ...(plan.logo ? { logo: { ...plan.logo, startSeconds: 0, durationSeconds: 0 } } : {}),
  };
}

const ORDINALS: Record<string, number> = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, setima: 7, oitava: 8, nona: 9, decima: 10 };

/**
 * Escopo de um pedido de alteração por conversa, com o vocabulário de vídeo ("abertura", "final",
 * "terceira cena", "música", "legenda", "transições", "duração"). Sem nada reconhecível, cai na
 * regra da refação pelo WhatsApp (\`videoRevisionPermissions\`).
 */
export function conversationalScope(plan: VideoEditPlan, request: string): VideoRevisionPermissions {
  const fallback = videoRevisionPermissions(plan, request);
  const text = request.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const ids = plan.clips.map((clip) => clip.id);
  const all = { ...fallback, visualClipIds: ids, textClipIds: ids, captions: true, logo: true, audio: true };
  // Mudanças globais: duração, ritmo, transições, estilo geral, remover/trocar ordem de cenas.
  if (/\b(\d+\s*s(egundos)?|duracao|mais curto|mais longo|reduz|encurt|ritmo|transic|versao|estilo|premium|remov|tire a|ordem|invert)/.test(text)) return all;
  const visual = new Set<string>();
  const texts = new Set<string>();
  let matched = false;
  const scene = (index: number, what: "visual" | "text" | "both") => {
    const id = ids[index];
    if (!id) return;
    matched = true;
    if (what !== "text") visual.add(id);
    if (what !== "visual") texts.add(id);
  };
  const isTextOnly = /\b(texto|titulo|frase|escrit)/.test(text) && !/\b(imagem|foto|visual|movimento|zoom|cena inteira)/.test(text);
  if (/\b(abertura|inicio|comeco|primeiros segundos|gancho)\b/.test(text)) scene(0, isTextOnly ? "text" : "both");
  if (/\b(final|encerramento|fim|ultima cena|cta|chamada)\b/.test(text)) scene(ids.length - 1, isTextOnly ? "text" : "both");
  for (const match of text.matchAll(/\b(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima|\d+[ªa]?)\s+cena/g)) {
    const word = match[1]!;
    const index = (ORDINALS[word] ?? Number.parseInt(word, 10)) - 1;
    if (Number.isFinite(index)) scene(index, isTextOnly ? "text" : "both");
  }
  const audio = /\b(musica|trilha|som|volume|audio|narrac)/.test(text);
  const captions = /\blegenda/.test(text);
  const logo = /\b(logo|marca d)/.test(text);
  if (!matched && !audio && !captions && !logo) {
    // "mostre mais a estampa/o produto": visual de todas as cenas, textos intactos.
    if (/\b(estampa|produto|detalhe|zoom|aproxim|enquadr)/.test(text)) return { ...fallback, visualClipIds: ids, textClipIds: [], captions: false, logo: false, audio: false };
    return fallback;
  }
  return { ...fallback, visualClipIds: [...visual], textClipIds: [...texts], captions, logo, audio };
}

export class VideoEditPlanningService {
  constructor(private readonly gateway: AiGatewayPort) {}

  private async ask(request: PlanningRequest, input: Record<string, unknown>, usage: PlanningUsage): Promise<{ ok: true; draft: VideoEditDraft; warnings: readonly string[] } | { ok: false; category: AiFailureCategory; message: string }> {
    const result = await this.gateway.execute({
      operation: "video_edit_planning",
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      correlationId: randomUUID(),
      input,
      outputSchema: { id: "video-edit-draft", version: 1 },
      policy: VIDEO_EDIT_PLANNING_POLICY,
      metadata: { planId: request.planId },
    });
    usage.calls += 1;
    if (!result.ok) return { ok: false, category: result.error.category, message: result.error.message };
    usage.inputTokens += result.data.usage.inputTokens;
    usage.outputTokens += result.data.usage.outputTokens;
    usage.costUsd += result.data.usage.estimatedCost;
    usage.model = result.data.model;
    return { ok: true, draft: result.data.output as VideoEditDraft, warnings: result.data.warnings };
  }

  /** Cria o plano a partir do pedido. No máximo 2 chamadas à IA (criação + uma correção). */
  async create(request: PlanningRequest): Promise<PlanningOutcome> {
    const usage: PlanningUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const first = await this.ask(request, promptInput(request, { mode: "create" }), usage);
    if (!first.ok) return { ok: false, category: first.category, message: first.message, issues: [], usage };
    let draft = first.draft;
    let built = buildPlanFromDraft(draft, request);
    if (!built.ok) {
      const repair = await this.ask(request, promptInput(request, { mode: "repair", previousDraft: draft, repairIssues: built.issues.slice(0, 12) }), usage);
      if (!repair.ok) return { ok: false, category: repair.category, message: repair.message, issues: built.issues, usage };
      draft = repair.draft;
      built = buildPlanFromDraft(draft, request);
      if (!built.ok) return { ok: false, category: "plan_rejected", message: "A IA não conseguiu montar um plano válido com estes materiais.", issues: built.issues, usage };
    }
    return { ok: true, draft, plan: built.plan, warnings: [...first.warnings, ...built.warnings], rationale: draft.rationale, usage };
  }

  /**
   * Revisão por conversa ("deixe a abertura mais impactante", "troque a música"): só o escopo que
   * o pedido permite pode mudar; o resto do plano fica idêntico.
   */
  async revise(request: PlanningRequest, previous: { draft: VideoEditDraft; plan: VideoEditPlan }, revisionRequest: string): Promise<PlanningOutcome> {
    const usage: PlanningUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const permissions = conversationalScope(previous.plan, revisionRequest);
    const index = (clipId: string) => previous.plan.clips.findIndex((clip) => clip.id === clipId);
    const visual = permissions.visualClipIds.map(index).filter((i) => i >= 0);
    const texts = permissions.textClipIds.map(index).filter((i) => i >= 0);
    const everything = visual.length === previous.plan.clips.length;
    const revisionScope = {
      scenesAllowed: everything ? ("all" as const) : [...new Set([...visual, ...texts])].sort((a, b) => a - b),
      textsOnly: visual.length === 0 && texts.length > 0,
      captions: permissions.captions,
      audio: permissions.audio,
      logo: permissions.logo,
    };
    const input = promptInput({ ...request, request: previous.plan.prompt }, { mode: "revise", previousDraft: previous.draft, revisionRequest, revisionScope });
    let attempt = await this.ask(request, input, usage);
    for (let round = 0; round < 2; round += 1) {
      if (!attempt.ok) return { ok: false, category: attempt.category, message: attempt.message, issues: [], usage };
      const built = buildPlanFromDraft(attempt.draft, { ...request, planId: request.planId });
      const problems = built.ok ? videoRevisionViolations(scopeView(previous.plan), scopeView(built.plan), permissions) : built.issues;
      if (built.ok && problems.length === 0) return { ok: true, draft: attempt.draft, plan: built.plan, warnings: [...attempt.warnings, ...built.warnings], rationale: attempt.draft.rationale, usage };
      if (round === 1) return { ok: false, category: built.ok ? "out_of_scope" : "plan_rejected", message: built.ok ? "A alteração mexeu em partes que o pedido não permitia; nada foi mudado." : "A IA não conseguiu montar a nova versão.", issues: problems, usage };
      attempt = await this.ask(request, { ...input, mode: "repair", previousDraft: attempt.draft, repairIssues: problems.slice(0, 12) }, usage);
    }
    return { ok: false, category: "plan_rejected", message: "Revisão não concluída.", issues: [], usage };
  }
}

/**
 * Rascunho que já chega pronto — escrito pelo diretor criativo do piloto automático (Codex, no
 * servidor), não pela IA paga do gateway. Passa pela MESMA validação (estrutura, materiais e frases
 * existentes, nada de número inventado) e pelo mesmo construtor determinístico. Numa versão derivada
 * (refação), o escopo do motivo vale igual à revisão por conversa: mexer fora dele é recusado.
 */
export function planFromPresetDraft(request: PlanningRequest, raw: unknown, previous?: { plan: VideoEditPlan; reason: string }): PlanningOutcome {
  const usage: PlanningUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const structure = validateVideoEditDraftStructure(raw);
  if (!structure.valid) return { ok: false, category: "plan_rejected", message: "Rascunho do diretor criativo inválido.", issues: [...structure.errors], usage };
  const semantic = applyVideoEditDraftSemanticValidation(structure.data, promptInput(request, {}));
  if (!semantic.valid) return { ok: false, category: "plan_rejected", message: "Rascunho do diretor criativo recusado pela validação.", issues: [...semantic.errors], usage };
  const built = buildPlanFromDraft(semantic.data, request);
  if (!built.ok) return { ok: false, category: "plan_rejected", message: "O plano do diretor criativo não pôde ser montado.", issues: built.issues, usage };
  if (previous) {
    const problems = videoRevisionViolations(scopeView(previous.plan), scopeView(built.plan), conversationalScope(previous.plan, previous.reason));
    if (problems.length) return { ok: false, category: "out_of_scope", message: "A nova versão mexeu em partes que o motivo não pedia.", issues: problems, usage };
  }
  return { ok: true, draft: semantic.data, plan: built.plan, warnings: [...semantic.warnings, ...built.warnings], rationale: semantic.data.rationale, usage };
}
