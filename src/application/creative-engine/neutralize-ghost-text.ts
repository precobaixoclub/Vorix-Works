import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativePlanRect } from "../../shared/utils/gpt-creative-plan.types.js";
import {
  classifyGhostTextIntensity,
  escalateGhostTextIntensity,
  resolveGhostTextTreatmentParams,
  type GhostTextIntensity,
} from "./resolve-actual-safe-area.js";

/**
 * ETAPA 3.1 (Rodada 4, benchmark de qualidade criativa) — achado do smoke real de produção
 * (ETAPA 3, commit 16c6d18): a detecção e o roteamento de texto fantasma estavam corretos, mas o
 * TRATAMENTO VISUAL (blur de sigma fixo) nem sempre esconde o texto por completo — um preço
 * fantasma de alto contraste continuou parcialmente legível em 2 tentativas seguidas.
 *
 * Esta função aplica a ordem de defesa pedida: tratar → reavaliar → confirmar → só escalar se
 * ainda legível → no máximo 2 passes, nunca um loop infinito. Nunca cobre texto fantasma com o
 * texto determinístico por cima sem antes CONFIRMAR que o fantasma sumiu — "cobrir com texto" não
 * é a mesma coisa que "neutralizar" (brief, ponto 12).
 */

const MAX_GHOST_TEXT_PASSES = 2;

export type GhostTextZoneNeutralizationResult = {
  /** `true` quando a reverificação confirmou (resposta explícita) que não há mais texto legível
   * na região tratada. `false` = esgotou os 2 passes e ainda está legível — ver
   * `UNRECOVERABLE_GHOST_TEXT` (`evaluate-creative-quality-gate.ts`), que precisa de reparo
   * completo (nenhum tratamento local a mais resolveria). */
  neutralizedLocally: boolean;
  passes: number;
  finalIntensity: GhostTextIntensity;
  backgroundIsDark: boolean;
};

// ETAPA 3.3.2 (Rodada 4) — achado real do smoke de produção: cheguei a tentar uma validação
// determinística independente aqui (comparar desvio-padrão de luminância antes/depois do
// tratamento, pra nunca confiar só na mesma visão que diz "limpo"). Descartado depois de medir
// contra o pipeline real: cada composição (logo, render de texto) passa por reencode JPEG, e o
// RUÍDO de recompressão sozinho (sem nenhum texto real) já varia o suficiente pra tanto mascarar
// uma queda real quanto produzir uma queda falsa — não dava pra calibrar um limiar confiável sem
// arriscar re-escalar tratamento (e eventualmente regenerar) por causa de ruído de compressão,
// não de texto. A causa raiz confirmada (ver `widenToCommercialBand`,
// `resolve-actual-safe-area.ts`) já é resolvida estruturalmente pela cobertura de largura da
// faixa comercial — tratar a reverificação em si como pouco confiável fica documentado aqui como
// limitação conhecida, não escondido.

export type NeutralizeGhostTextDeps = {
  computeRegionPixelStats(imageBuffer: Buffer, rect: CreativePlanRect): Promise<{ meanLuminance: number; stdDevLuminance: number } | undefined>;
  applyLocalBlur(imageBuffer: Buffer, rect: CreativePlanRect, sigma: number): Promise<Buffer>;
  applyLocalScrim(imageBuffer: Buffer, rect: CreativePlanRect, opacity: number, color: "light" | "dark"): Promise<Buffer>;
  extractRegionBuffer(imageBuffer: Buffer, rect: CreativePlanRect): Promise<Buffer | undefined>;
  objectStorage: Pick<ObjectStoragePort, "put">;
};

/**
 * Pergunta objetiva e ISOLADA (só o recorte da região tratada, nunca a peça inteira — mais barato
 * e mais preciso, a visão não se distrai com o resto da composição). Best-effort CONSERVADOR: só
 * aceita "resolvido" com um `false` EXPLÍCITO no JSON — qualquer falha/resposta incompleta/
 * ambígua conta como "ainda pode estar legível" (nunca declara sucesso sem confirmação real).
 */
async function recheckRegionLegibility(
  icaro: IcaroBrainPort,
  input: { imageUrl: string; specialistId: string; onCost?: (response: IcaroAIResponse | undefined) => void },
): Promise<boolean> {
  try {
    const response = await icaro.request({
      taskType: "review",
      prompt:
        "Esta imagem é um recorte de uma peça publicitária, depois de um tratamento aplicado para esconder texto indesejado. Há ALGUM texto (letras ou números) ainda legível ou reconhecível nesta imagem, mesmo parcialmente? Responda APENAS JSON, sem markdown, no formato exato: " +
        '{"hasLegibleText": true|false}',
      specialistId: input.specialistId,
      imageUrls: [input.imageUrl],
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.1,
      maxTokens: 50,
      timeoutMs: 15_000,
    });
    input.onCost?.(response);
    if (response.status !== "completed") return true;
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Ghost Text Recheck")) as { hasLegibleText?: unknown };
    return parsed.hasLegibleText !== false;
  } catch {
    return true;
  }
}

/**
 * Orquestra UMA zona com texto fantasma confirmado: aplica blur+véu adaptativos (intensidade a
 * partir de estatística de pixel real), reverifica SÓ a região tratada, escalona a intensidade se
 * ainda legível — no máximo 2 passes. Retorna o buffer já tratado (blur+scrim aplicados de verdade
 * nos pixels, nunca deferido para o renderer) e o resultado da neutralização.
 */
export async function neutralizeGhostTextZone(
  icaro: IcaroBrainPort,
  deps: NeutralizeGhostTextDeps,
  input: {
    imageBuffer: Buffer;
    rect: CreativePlanRect;
    tenantId: string;
    specialistId: string;
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<{ imageBuffer: Buffer; result: GhostTextZoneNeutralizationResult }> {
  let buffer = input.imageBuffer;
  const initialStats = await deps.computeRegionPixelStats(buffer, input.rect);
  const backgroundIsDark = initialStats ? initialStats.meanLuminance < 128 : false;
  let intensity = classifyGhostTextIntensity(initialStats);

  for (let pass = 1; pass <= MAX_GHOST_TEXT_PASSES; pass++) {
    const params = resolveGhostTextTreatmentParams(intensity);
    buffer = await deps.applyLocalBlur(buffer, input.rect, params.blurSigma);
    buffer = await deps.applyLocalScrim(buffer, input.rect, params.scrimOpacity, backgroundIsDark ? "light" : "dark");

    let stillLegible = true;
    const croppedBuffer = await deps.extractRegionBuffer(buffer, input.rect);
    if (croppedBuffer) {
      try {
        const uploaded = await deps.objectStorage.put({
          key: `ghost-text-recheck/${input.tenantId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`,
          body: croppedBuffer,
          contentType: "image/png",
        });
        stillLegible = await recheckRegionLegibility(icaro, { imageUrl: uploaded.url, specialistId: input.specialistId, onCost: input.onCost });
      } catch {
        stillLegible = true;
      }
    }

    if (!stillLegible) {
      return { imageBuffer: buffer, result: { neutralizedLocally: true, passes: pass, finalIntensity: intensity, backgroundIsDark } };
    }
    if (pass < MAX_GHOST_TEXT_PASSES) intensity = escalateGhostTextIntensity(intensity);
  }

  return { imageBuffer: buffer, result: { neutralizedLocally: false, passes: MAX_GHOST_TEXT_PASSES, finalIntensity: intensity, backgroundIsDark } };
}
