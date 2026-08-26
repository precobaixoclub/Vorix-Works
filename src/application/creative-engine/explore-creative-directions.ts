import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativeContext } from "../../shared/utils/gpt-creative-plan.types.js";

/**
 * Exploração barata de direções criativas — auditoria "qualidade visual e direção de arte" (ponto
 * 9: "exploração textual de 2-3 micro-direções antes da geração cara"). DELIBERADAMENTE uma ÚNICA
 * chamada de TEXTO (sem `imageUrls`, sem gerar nenhuma imagem) — nunca reativa o candidate planning
 * pesado do motor legado (que gerava um plano JSON COMPLETO por candidato, com textZones/
 * assetPlacements, pra depois descartar os perdedores). Aqui os "candidatos" são só um nome + 1-2
 * frases de conceito + nota de originalidade — o suficiente pra escolher uma ÂNCORA criativa antes
 * do plano detalhado (`buildCreativePlanPrompt`), sem pagar o custo de detalhar 3 planos inteiros
 * pra jogar 2 fora.
 *
 * Também é o mecanismo real do ponto 10 (detecção de repetição visual entre gerações): o prompt
 * recebe os conceitos das peças recentes do workspace (`context.recentHistory`, já existente antes
 * desta auditoria) e é instruído a nunca repeti-los nem variar superficialmente em cima deles.
 *
 * Best-effort, mesmo espírito do resto do motor: falha/resposta malformada nunca bloqueia a
 * geração — `undefined` faz `run-gpt-creative-engine.ts` seguir direto pro plano detalhado sem
 * âncora, exatamente como funcionava antes desta auditoria.
 */

export type CreativeDirectionCandidate = {
  name: string;
  coreIdea: string;
  whyItFits: string;
  originalityScore: number;
};

export type CreativeDirectionExploration = {
  candidates: CreativeDirectionCandidate[];
  chosenIndex: number;
  chosenReasoning: string;
};

function buildExplorationPrompt(context: CreativeContext): string {
  const recentConcepts = (context.recentHistory ?? []).map((entry) => entry.visualConcept).filter((concept): concept is string => Boolean(concept?.trim()));
  return [
    "Você é um diretor de criação sênior. Antes de detalhar o plano completo desta peça publicitária, proponha 2 a 3 DIREÇÕES CRIATIVAS distintas e curtas — nunca o plano inteiro, só o conceito de cada uma.",
    `Marca: ${context.brandName}.`,
    `Objetivo: ${context.objective}.`,
    `Pedido/ideia atual: ${context.ideaText}.`,
    recentConcepts.length > 0
      ? `Direções visuais JÁ USADAS recentemente por este workspace (NUNCA repita nenhuma delas nem proponha uma variação superficial em cima delas — busque algo genuinamente diferente): ${recentConcepts.map((concept) => `"${concept}"`).join("; ")}.`
      : "",
    "Para cada direção, dê: um nome curto, a ideia visual central em 1-2 frases CONCRETAS (nunca \"visual moderno\"/\"alto impacto\" — descreva o que apareceria na tela), por que ela se encaixa no objetivo, e uma nota de originalidade de 0 a 10 (10 = nunca visto num anúncio antes, 0 = clichê batido de mercado).",
    "Depois escolha a MELHOR direção entre as propostas (o melhor equilíbrio entre originalidade e adequação real ao objetivo/produto) e explique o motivo em 1 frase objetiva.",
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    '{"candidates": [{"name": "...", "coreIdea": "...", "whyItFits": "...", "originalityScore": 0-10}], "chosenIndex": 0, "chosenReasoning": "..."}',
  ].filter(Boolean).join("\n");
}

export async function exploreCreativeDirections(
  icaro: IcaroBrainPort,
  context: CreativeContext,
  input: {
    specialistId: string;
    executionId?: string;
    correlationId?: string;
    /** Auditoria de custo — achado crítico: esta chamada nunca entrava em NENHUM total de custo
     * do motor antes desta correção. Opcional e best-effort, mesmo espírito do resto da função —
     * nunca lançar por causa disto. */
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<CreativeDirectionExploration | undefined> {
  try {
    const response = await icaro.request({
      // Deliberadamente DISTINTO de "analysis" (usado pelo `creative_plan` estruturado) e "review"
      // (usado pelos gates de qualidade/estética) — mantém a contagem de chamadas de cada etapa
      // do motor separável (auditoria, testes, custo) mesmo com as três etapas convivendo na
      // mesma execução.
      taskType: "text_generation",
      prompt: buildExplorationPrompt(context),
      specialistId: input.specialistId,
      executionId: input.executionId,
      correlationId: input.correlationId,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.7,
      maxTokens: 600,
      timeoutMs: 25_000,
    });
    input.onCost?.(response);
    if (response.status !== "completed") return undefined;

    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Creative Direction Exploration")) as {
      candidates?: unknown;
      chosenIndex?: unknown;
      chosenReasoning?: unknown;
    };
    if (!Array.isArray(parsed.candidates) || parsed.candidates.length < 2 || parsed.candidates.length > 3) return undefined;

    const candidates: CreativeDirectionCandidate[] = [];
    for (const item of parsed.candidates) {
      if (typeof item !== "object" || item === null) return undefined;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const coreIdea = typeof record.coreIdea === "string" ? record.coreIdea.trim() : "";
      const whyItFits = typeof record.whyItFits === "string" ? record.whyItFits.trim() : "";
      const originalityScore = record.originalityScore;
      if (!name || !coreIdea || !whyItFits || typeof originalityScore !== "number" || !Number.isFinite(originalityScore)) return undefined;
      candidates.push({ name, coreIdea, whyItFits, originalityScore });
    }

    const chosenIndex = parsed.chosenIndex;
    if (typeof chosenIndex !== "number" || !Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= candidates.length) return undefined;
    const chosenReasoning = typeof parsed.chosenReasoning === "string" && parsed.chosenReasoning.trim() ? parsed.chosenReasoning.trim() : "Sem justificativa.";

    return { candidates, chosenIndex, chosenReasoning };
  } catch {
    return undefined;
  }
}
