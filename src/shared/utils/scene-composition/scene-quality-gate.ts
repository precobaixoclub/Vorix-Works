import type { ComposedScene } from "./cinematic-composer.js";
import type { MicroShot } from "./microshot.model.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — GATE DE QUALIDADE DE CENA (seção 15 da sprint).
 *
 * DECISÃO DE ESCOPO (documentada explicitamente, não uma omissão): o preâmbulo desta sprint lista
 * "Lucas" entre os componentes que "NÃO altera... continuam exatamente iguais" — uma frase mais
 * forte e explícita do que a seção 15 ("Lucas deverá avaliar: Ritmo, Variedade..."), que entra em
 * tensão direta com ela (avaliar Ritmo/Variedade/Mudanças de câmera exigiria adicionar essas
 * checagens ao `lucas-quality-review.skill.ts`, ou seja, alterá-lo). Resolvida a favor da
 * instrução mais explícita: `lucas-quality-review.skill.ts` continua BYTE A BYTE o mesmo desta
 * sprint. Este arquivo implementa exatamente os critérios pedidos na seção 15 como um avaliador
 * INDEPENDENTE, no mesmo ESPÍRITO/vocabulário de `LucasIssue` (severidade + código + mensagem),
 * pronto para ser conectado a Lucas em uma sprint futura que reabra essa decisão — mas não
 * conectado nesta.
 */

export type SceneQualityIssueSeverity = "low" | "medium" | "high";

export type SceneQualityIssue = {
  code: string;
  severity: SceneQualityIssueSeverity;
  message: string;
};

function issue(code: string, severity: SceneQualityIssueSeverity, message: string): SceneQualityIssue {
  return { code, severity, message };
}

const MAX_SCREEN_TIME_RATIO = 0.5;

export function evaluateSceneQualityGate(composed: ComposedScene): SceneQualityIssue[] {
  const issues: SceneQualityIssue[] = [];
  const sequence: MicroShot[] = composed.sequence;
  if (sequence.length === 0) return issues;

  // RITMO — violações de ritmo que o compositor não conseguiu corrigir por reordenação.
  for (const violation of composed.violationsRemaining.filter((entry) => entry.kind === "visual_rhythm")) {
    issues.push(issue("SCENE_RHYTHM_FLAT", "medium", violation.detail));
  }

  // VARIEDADE / MUDANÇAS DE CÂMERA — enquadramento e movimento pouco variados na cena inteira.
  const distinctFramings = new Set(sequence.map((microShot) => microShot.preferredCamera)).size;
  if (sequence.length >= 3 && distinctFramings < 2) {
    issues.push(issue("SCENE_CAMERA_VARIETY_LOW", "high", `Apenas ${distinctFramings} enquadramento(s) distinto(s) em ${sequence.length} microplanos — cena tende a parecer estática/repetitiva.`));
  }
  const distinctMovements = new Set(sequence.map((microShot) => microShot.preferredMovement)).size;
  if (sequence.length >= 3 && distinctMovements < 2) {
    issues.push(issue("SCENE_MOTION_VARIETY_LOW", "medium", `Apenas ${distinctMovements} movimento(s) de câmera distinto(s) em ${sequence.length} microplanos.`));
  }

  // REPETIÇÃO / PLANOS CONSECUTIVOS — violações de câmera/produto que o compositor não corrigiu.
  for (const violation of composed.violationsRemaining.filter((entry) => entry.kind === "camera_variety" || entry.kind === "product_insertion")) {
    issues.push(issue("SCENE_CONSECUTIVE_REPEAT", "high", violation.detail));
  }

  // NARRATIVA — microplanos obrigatórios sem transição de entrada/saída definida (sinal de decomposição incompleta).
  const mandatoryWithoutTransition = sequence.filter((microShot) => microShot.priority === "obrigatorio" && (!microShot.transitionIn || !microShot.transitionOut));
  if (mandatoryWithoutTransition.length > 0) {
    issues.push(issue("SCENE_NARRATIVE_GAP", "medium", `${mandatoryWithoutTransition.length} microplano(s) obrigatório(s) sem transição de entrada/saída definida.`));
  }

  // TEMPO EM TELA — fração da duração total ocupada por microplanos de "screen" acima do teto.
  const totalDuration = sequence.reduce((sum, microShot) => sum + microShot.duration, 0) || 1;
  const screenDuration = sequence.filter((microShot) => microShot.preferredCamera === "screen").reduce((sum, microShot) => sum + microShot.duration, 0);
  const screenRatio = screenDuration / totalDuration;
  if (screenRatio > MAX_SCREEN_TIME_RATIO) {
    issues.push(issue("SCENE_SCREEN_TIME_EXCESSIVE", "high", `Tela ocupa ${Math.round(screenRatio * 100)}% do tempo da cena (máximo recomendado: ${Math.round(MAX_SCREEN_TIME_RATIO * 100)}%) — risco de parecer demonstração de produto, não comercial.`));
  }

  return issues;
}
