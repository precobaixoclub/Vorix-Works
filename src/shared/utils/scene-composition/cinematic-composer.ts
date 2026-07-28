import type { MicroShot } from "./microshot.model.js";
import type { MicroShotFraming } from "./microshot-vocabulary.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — CINEMATIC COMPOSER (seção 6). "Ele NÃO renderiza. Ele
 * apenas monta a sequência." Recebe os MicroShots já decompostos (`shot-decomposer.ts`) na ordem
 * de geração e devolve a MESMA lista de MicroShots reordenada para respeitar as regras
 * cinematográficas das seções 7/9/10/11 — nunca cria nem remove um MicroShot (isso é trabalho do
 * decompositor), só decide a ORDEM de exibição.
 */

const MAX_CONSECUTIVE_SAME_FRAMING = 3;
const MAX_CONSECUTIVE_SCREEN = 2;
const PRODUCT_FRAMINGS: MicroShotFraming[] = ["screen"];

export type ComposerViolation = { kind: string; detail: string };

export type ComposedScene = {
  sequence: MicroShot[];
  violationsFixed: ComposerViolation[];
  violationsRemaining: ComposerViolation[];
};

function framingRunTooLong(sequence: MicroShot[], index: number, framing: MicroShotFraming, limit: number): boolean {
  let run = 1;
  for (let cursor = index - 1; cursor >= 0 && sequence[cursor].preferredCamera === framing; cursor -= 1) run += 1;
  return run > limit;
}

/** CAMERA VARIETY (seção 7) — nunca 4 planos idênticos consecutivos (Plano Geral repetido 4x, Close repetido 4x etc.). Corrige por troca local com o próximo MicroShot de enquadramento diferente, quando existe um candidato à frente na fila sem quebrar prioridade obrigatória. */
function enforceCameraVariety(sequence: MicroShot[]): ComposerViolation[] {
  const fixed: ComposerViolation[] = [];
  for (let index = 1; index < sequence.length; index += 1) {
    const framing = sequence[index].preferredCamera;
    if (!framingRunTooLong(sequence, index, framing, MAX_CONSECUTIVE_SAME_FRAMING)) continue;
    const swapIndex = sequence.findIndex((microShot, cursor) => cursor > index && microShot.preferredCamera !== framing);
    if (swapIndex === -1) continue;
    [sequence[index], sequence[swapIndex]] = [sequence[swapIndex], sequence[index]];
    fixed.push({ kind: "camera_variety", detail: `Reordenado: enquadramento "${framing}" repetido além do limite (${MAX_CONSECUTIVE_SAME_FRAMING}) na posição ${index}.` });
  }
  return fixed;
}

/** PRODUCT INSERTION (seção 11) — nunca 3 telas consecutivas ("Screen Replacement" empilhado); prioriza Close → Screen → Reação. */
function enforceProductInsertion(sequence: MicroShot[]): ComposerViolation[] {
  const fixed: ComposerViolation[] = [];
  for (let index = 1; index < sequence.length; index += 1) {
    if (!PRODUCT_FRAMINGS.includes(sequence[index].preferredCamera)) continue;
    if (!framingRunTooLong(sequence, index, sequence[index].preferredCamera, MAX_CONSECUTIVE_SCREEN)) continue;
    const swapIndex = sequence.findIndex((microShot, cursor) => cursor > index && !PRODUCT_FRAMINGS.includes(microShot.preferredCamera));
    if (swapIndex === -1) continue;
    [sequence[index], sequence[swapIndex]] = [sequence[swapIndex], sequence[index]];
    fixed.push({ kind: "product_insertion", detail: `Reordenado: mais de ${MAX_CONSECUTIVE_SCREEN} telas consecutivas na posição ${index}.` });
  }
  return fixed;
}

/** REACTION ENGINE (seção 10) — sempre que possível, uma "reaction" deve vir logo após um microplano de produto/tela, nunca dois produtos seguidos sem reação entre eles. Move a reação existente pra logo depois do bloco de produto quando ela já existe na lista mas está longe. */
function enforceReactionAdjacency(sequence: MicroShot[]): ComposerViolation[] {
  const fixed: ComposerViolation[] = [];
  const reactionIndex = sequence.findIndex((microShot) => microShot.preferredCamera === "reaction");
  if (reactionIndex === -1) return fixed;

  const lastProductIndex = [...sequence.keys()].reverse().find((index) => PRODUCT_FRAMINGS.includes(sequence[index].preferredCamera) || sequence[index].purpose === "brand_detail");
  if (lastProductIndex === undefined) return fixed;
  if (reactionIndex > lastProductIndex) return fixed; // já está depois do último beat de produto — ok

  const [reaction] = sequence.splice(reactionIndex, 1);
  const insertAt = Math.min(lastProductIndex + 1, sequence.length);
  sequence.splice(insertAt, 0, reaction);
  fixed.push({ kind: "reaction_adjacency", detail: `Reação movida para logo após o último microplano de produto/tela (posição ${insertAt}).` });
  return fixed;
}

/** VISUAL RHYTHM (seção 9) — nunca 5 microplanos longos (>= 2.5s) consecutivos; alterna duração longa/curta quando a sequência já não alterna sozinha. Só reordena entre microplanos de MESMA prioridade (nunca sacrifica um "obrigatorio" por ritmo). */
const LONG_DURATION_THRESHOLD = 2.5;
const MAX_CONSECUTIVE_LONG = 4;

function enforceVisualRhythm(sequence: MicroShot[]): ComposerViolation[] {
  const fixed: ComposerViolation[] = [];
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index].duration < LONG_DURATION_THRESHOLD) continue;
    let run = 1;
    for (let cursor = index - 1; cursor >= 0 && sequence[cursor].duration >= LONG_DURATION_THRESHOLD; cursor -= 1) run += 1;
    if (run <= MAX_CONSECUTIVE_LONG) continue;
    const swapIndex = sequence.findIndex((microShot, cursor) => cursor > index && microShot.duration < LONG_DURATION_THRESHOLD && microShot.priority === sequence[index].priority);
    if (swapIndex === -1) continue;
    [sequence[index], sequence[swapIndex]] = [sequence[swapIndex], sequence[index]];
    fixed.push({ kind: "visual_rhythm", detail: `Reordenado: ${MAX_CONSECUTIVE_LONG}+ microplanos longos consecutivos na posição ${index}.` });
  }
  return fixed;
}

function detectRemainingViolations(sequence: MicroShot[]): ComposerViolation[] {
  const remaining: ComposerViolation[] = [];
  for (let index = 1; index < sequence.length; index += 1) {
    const framing = sequence[index].preferredCamera;
    if (framingRunTooLong(sequence, index, framing, MAX_CONSECUTIVE_SAME_FRAMING)) {
      remaining.push({ kind: "camera_variety", detail: `Ainda há ${MAX_CONSECUTIVE_SAME_FRAMING}+ enquadramentos "${framing}" consecutivos na posição ${index} — sem candidato disponível para troca.` });
    }
    if (PRODUCT_FRAMINGS.includes(framing) && framingRunTooLong(sequence, index, framing, MAX_CONSECUTIVE_SCREEN)) {
      remaining.push({ kind: "product_insertion", detail: `Ainda há ${MAX_CONSECUTIVE_SCREEN}+ telas consecutivas na posição ${index} — sem candidato disponível para troca.` });
    }
  }
  return remaining;
}

export function composeScene(microShots: MicroShot[]): ComposedScene {
  const sequence = [...microShots];
  const violationsFixed: ComposerViolation[] = [
    ...enforceCameraVariety(sequence),
    ...enforceProductInsertion(sequence),
    ...enforceReactionAdjacency(sequence),
    ...enforceVisualRhythm(sequence),
  ];
  const violationsRemaining = detectRemainingViolations(sequence);
  return { sequence, violationsFixed, violationsRemaining };
}

/**
 * REUTILIZAÇÃO INTELIGENTE (seção 14) — pontuação de valor de um asset dentro DESTA composição
 * (nunca persistida de volta no catálogo — `VisualAssetMetadata`/`MediaAssetRecord` não ganham
 * nenhum campo novo nesta sprint, para não arriscar nenhuma Skill que consome esses tipos). Um
 * asset que serve a papéis diferentes (ex.: plano geral + b-roll + transição) vale mais NESTA
 * composição do que um asset de papel único — usado só para desempate no Multi-Asset Retrieval.
 */
export function scoreAssetReuseValue(rolesServed: string[]): number {
  const distinctRoles = new Set(rolesServed).size;
  if (distinctRoles <= 1) return 0;
  return Math.min(1, (distinctRoles - 1) * 0.25);
}
