import { CONTEXT_TAG_SIGNAL, END_CARD_TAG_SIGNAL, HUMAN_TAG_SIGNAL, PRODUCT_TAG_SIGNAL, SCREENSHOT_TAG_SIGNAL } from "../visual-asset-tag-signals.js";
import type { AssetSignal } from "./asset-signal.js";
import type { RequirementState } from "./requirement-state.js";
import { REQUIREMENT_CATEGORY_FAMILY, type RequirementCategory } from "./requirement-taxonomy.js";
import type { ShotRequirement } from "./shot-requirement.model.js";

/**
 * UNIFIED COVERAGE MODEL — EXECUTIVE PRODUCER (seção 1/11 da sprint), agora formalizado como UMA
 * única função, dispatched por FAMÍLIA (`requirement-taxonomy.ts`), nunca uma por categoria. Este é
 * o consolidado de três implementações independentes que respondiam à mesma pergunta ("este asset
 * resolve este requisito?") com resultados potencialmente divergentes:
 *   - `evaluateExecutiveProducerVerdict` (production-readiness.ts)
 *   - `evaluateStructuredShotRequirements` (in-memory-media-catalog.ts, Gap Analysis)
 *   - checagens ad hoc dentro de `computeCompositingReadinessScores`/`computeAssetDiversityMetrics`
 * Todas as três agora chamam ESTA função (ver `production-readiness.ts`, `asset-diversity-gate.ts`,
 * `in-memory-media-catalog.ts` após a integração desta sprint).
 */

/** Mesmo piso usado historicamente em `visual-candidate-validator.ts`/`production-readiness.ts`/`in-memory-media-catalog.ts` (três constantes hardcoded coincidentemente iguais) — agora um único valor. */
export const MIN_INTERACTION_THRESHOLD = 0.12;
export const MIN_DEVICE_CONFIDENCE_THRESHOLD = 0.2;

/**
 * Piso independente de qualidade mínima aceitável (seção 10 da sprint: Lucas não deve ter
 * checklist independente) — antes vivia hardcoded DUAS vezes: `MIN_LUCAS_PRODUCTION_HUMAN_PRESENCE`/
 * `MIN_LUCAS_PRODUCTION_SHOT_VARIETY` em `lucas-quality-review.skill.ts` e, coincidentemente com o
 * mesmo valor, em `blocker-classifier.ts` (`MIN_SCENE_DIVERSITY`/`MIN_PRODUCT_COVERAGE`). Um único
 * valor agora, consumido pelos dois. Continua sendo um piso DELIBERADAMENTE independente do
 * `minProductionReadiness` do perfil de qualidade (defesa em profundidade: um vídeo com cobertura
 * humana/variedade claramente insuficiente nunca passa só porque o perfil `standard`/`draft` não
 * bloqueava) — a mudança desta sprint é onde o número mora, nunca o princípio de tê-lo.
 */
export const MIN_ACCEPTABLE_HUMAN_COVERAGE = 0.5;
export const MIN_ACCEPTABLE_ASSET_VARIETY = 0.5;
export const MIN_ACCEPTABLE_SCENE_DIVERSITY = 0.5;
export const MIN_ACCEPTABLE_PRODUCT_COVERAGE = 0.5;

export type RequirementEvidence = { source: string; detail: string };
export type RequirementEvaluation = { requirement: ShotRequirement; state: RequirementState; evidence: RequirementEvidence };

function normalizedText(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function hasTagSignal(signal: AssetSignal, vocabulary: string[]): boolean {
  const text = normalizedText(signal.theme, signal.emotion, signal.kind, ...signal.tags);
  return vocabulary.some((word) => text.includes(word));
}

function hasKeyword(signal: AssetSignal, keywords: string[]): boolean {
  const text = normalizedText(signal.theme, ...signal.tags);
  return keywords.some((word) => text.includes(word));
}

const SCENE_KEYWORDS: Partial<Record<RequirementCategory, string[]>> = {
  ceremony: ["cerimonia", "altar", "votos", "aliança", "alianca"],
  preparation: ["preparativo", "making of", "making-of", "arrumação", "arrumacao", "vestido", "noiva se arrumando"],
  celebration: ["festa", "recepcao", "recepção", "celebracao", "celebração", "dança", "danca", "brinde"],
};

const EMOTION_KEYWORDS: Partial<Record<RequirementCategory, string[]>> = {
  joy: ["alegria", "sorriso", "riso", "felicidade"],
  emotion_growth: ["alivio", "alívio", "crescimento", "superacao", "superação"],
};

const PRODUCT_FEATURE_KEYWORDS: Partial<Record<RequirementCategory, string[]>> = {
  homepage: ["homepage", "pagina inicial", "página inicial", "site oficial"],
  rsvp: ["rsvp", "confirmacao de presenca", "confirmação de presença"],
  gift_list: ["lista de presentes", "presente", "gift"],
  album: ["album", "álbum", "album colaborativo"],
  timeline: ["cronograma", "timeline", "linha do tempo"],
  guest_info: ["convidado", "guest", "informacoes do convidado", "informações do convidado"],
  cta: [...END_CARD_TAG_SIGNAL],
};

function evaluateHumanPresence(signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (hasTagSignal(signal, HUMAN_TAG_SIGNAL)) {
    return { state: "fulfilled", evidence: { source: "tag_signal", detail: "Sinal de presença humana encontrado nas tags/tema do asset." } };
  }
  return { state: "missing", evidence: { source: "tag_signal", detail: "Nenhum sinal de presença humana nas tags/tema do asset." } };
}

function evaluateDevicePresence(category: RequirementCategory, signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  const wantsSpecificDevice = category !== "device";
  if (wantsSpecificDevice && signal.deviceType !== undefined) {
    return signal.deviceType === category
      ? { state: "fulfilled", evidence: { source: "structured_field", detail: `deviceType="${signal.deviceType}" corresponde ao dispositivo pedido.` } }
      : { state: "rejected", evidence: { source: "structured_field", detail: `Dispositivo pedido "${category}", candidato registrado como "${signal.deviceType}".` } };
  }
  if ((signal.deviceConfidence ?? 0) >= MIN_DEVICE_CONFIDENCE_THRESHOLD) {
    return { state: "candidate_found", evidence: { source: "structured_field", detail: `deviceConfidence=${signal.deviceConfidence} acima do piso (${MIN_DEVICE_CONFIDENCE_THRESHOLD}), mas sem deviceType confirmado.` } };
  }
  if (signal.deviceConfidence === undefined) {
    return { state: "unknown", evidence: { source: "structured_field", detail: "Asset nunca passou pela validação visual de dispositivo (deviceConfidence ausente)." } };
  }
  return { state: "missing", evidence: { source: "structured_field", detail: `deviceConfidence=${signal.deviceConfidence} abaixo do piso (${MIN_DEVICE_CONFIDENCE_THRESHOLD}).` } };
}

function evaluateScreenVisibility(signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (signal.screenVisible === true) {
    return { state: "fulfilled", evidence: { source: "structured_field", detail: "screenVisible=true (validação visual heurística confirmou tela candidata)." } };
  }
  if (signal.screenVisible === false) {
    return { state: "rejected", evidence: { source: "structured_field", detail: "screenVisible=false — validação visual heurística não encontrou tela candidata." } };
  }
  if (hasTagSignal(signal, PRODUCT_TAG_SIGNAL) || hasTagSignal(signal, SCREENSHOT_TAG_SIGNAL)) {
    return { state: "candidate_found", evidence: { source: "tag_signal", detail: "Asset não passou pela validação visual, mas carrega tag de mockup/screenshot já conhecida." } };
  }
  // Sem validação visual E sem tag: honestamente "unknown" (nunca validamos isto), não "missing"
  // (que afirmaria ter confirmado a ausência de tela — uma alegação mais forte do que os dados sustentam).
  return { state: "unknown", evidence: { source: "tag_signal", detail: "Nenhum sinal de tela visível — nem validação visual nem tag de mockup/screenshot; nunca avaliado, não confirmado ausente." } };
}

/**
 * Pergunta mais forte que `evaluateScreenVisibility`: "este asset já resolve a EXIGÊNCIA DE
 * COMPOSIÇÃO do Shot?" (nunca só "a tela aparece no quadro"). Consolidado a partir de
 * `evaluateExecutiveProducerVerdict` (production-readiness.ts) — usa `validated` (não
 * `candidate_found`) para o caso "tela visível confirmada visualmente, mas a Pre-composition
 * Simulator concluiu que não compensa tentar compor": é uma evidência mais forte que um mero
 * palpite por tag, mas ainda não é aprovação. `production-readiness.ts` chama esta função
 * diretamente para preservar a semântica exata do Executive Producer (`SIM`/`NAO`).
 */
export function evaluateProductScreenCompositingReadiness(signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (signal.compositingReady === true) {
    return { state: "fulfilled", evidence: { source: "structured_field", detail: `Validação visual heurística confirmou tela candidata visível (compositingReady=true, screenVisible=${signal.screenVisible}) — resolve a exigência do Shot.` } };
  }
  if (signal.screenVisible === false) {
    return { state: "rejected", evidence: { source: "structured_field", detail: "Validação visual heurística não encontrou tela candidata visível neste asset — não resolve a exigência de mostrar o produto, mesmo que o restante da filmagem seja adequado." } };
  }
  if (signal.screenVisible === undefined) {
    const hasProductSignal = hasTagSignal(signal, PRODUCT_TAG_SIGNAL) || hasTagSignal(signal, SCREENSHOT_TAG_SIGNAL);
    return hasProductSignal
      ? { state: "candidate_found", evidence: { source: "tag_signal", detail: "Asset é mockup/composição de produto já aprovada (não passou pela validação visual da Intent-Based Footage Acquisition, mas carrega sinal de produto já verificado por outro gate)." } }
      : { state: "missing", evidence: { source: "tag_signal", detail: "Nenhum sinal de produto/tela — nem validação visual heurística nem tag de mockup/screenshot conhecida." } };
  }
  return { state: "validated", evidence: { source: "structured_field", detail: "Tela candidata foi detectada, mas a simulação de pré-composição concluiu que não vale a pena tentar compor (ver notas do asset)." } };
}

export function evaluateInteractionForCompositing(signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  return evaluateInteraction(signal);
}

function evaluateInteraction(signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (signal.humanInteractionScore === undefined) {
    return { state: "unknown", evidence: { source: "structured_field", detail: "Asset nunca passou pela validação visual de interação (humanInteractionScore ausente)." } };
  }
  if (signal.humanInteractionScore >= MIN_INTERACTION_THRESHOLD) {
    return { state: "fulfilled", evidence: { source: "structured_field", detail: `humanInteractionScore=${signal.humanInteractionScore} atinge o piso (${MIN_INTERACTION_THRESHOLD}).` } };
  }
  if (signal.humanInteractionScore > 0) {
    return { state: "candidate_found", evidence: { source: "structured_field", detail: `humanInteractionScore=${signal.humanInteractionScore} abaixo do piso, mas não é zero.` } };
  }
  return { state: "missing", evidence: { source: "structured_field", detail: "humanInteractionScore=0 — ninguém interagindo com o dispositivo." } };
}

function evaluateMediaType(category: RequirementCategory, signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (category === "real_video") {
    const isVideoKind = signal.kind === "video" || signal.kind === "b_roll";
    if (!isVideoKind) return { state: "missing", evidence: { source: "structured_field", detail: `kind="${signal.kind}" não é vídeo/b-roll.` } };
    const procedural = signal.footageClassification === "procedural_background" || signal.footageClassification === "motion_graphics" || signal.footageClassification === "animated_still" || signal.footageClassification === "mockup_animation";
    return procedural
      ? { state: "rejected", evidence: { source: "structured_field", detail: `footageClassification="${signal.footageClassification}" é procedural/sintético — nunca conta como filmagem real.` } }
      : { state: "fulfilled", evidence: { source: "structured_field", detail: `kind="${signal.kind}", sem classificação procedural — filmagem real.` } };
  }
  return signal.kind === category
    ? { state: "fulfilled", evidence: { source: "structured_field", detail: `kind="${signal.kind}" corresponde ao tipo pedido.` } }
    : { state: "missing", evidence: { source: "structured_field", detail: `kind="${signal.kind}" não corresponde ao tipo pedido ("${category}").` } };
}

function evaluateProductSignal(category: RequirementCategory, signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (category === "product_screen") return evaluateProductScreenCompositingReadiness(signal);
  if (category === "product_recording") {
    const isVideoKind = signal.kind === "video" || signal.kind === "b_roll";
    if (isVideoKind && (signal.compositingReady === true || signal.screenVisible === true)) {
      return { state: "fulfilled", evidence: { source: "structured_field", detail: "Filmagem real com tela de produto visível/composta." } };
    }
    if (hasTagSignal(signal, PRODUCT_TAG_SIGNAL)) {
      return { state: "candidate_found", evidence: { source: "tag_signal", detail: "Tag de produto encontrada, mas sem validação visual de vídeo+tela confirmada." } };
    }
    return { state: "missing", evidence: { source: "structured_field", detail: "Nenhuma gravação de produto real detectada." } };
  }
  if (category === "cta") {
    return hasTagSignal(signal, END_CARD_TAG_SIGNAL) || hasKeyword(signal, PRODUCT_FEATURE_KEYWORDS.cta ?? [])
      ? { state: "fulfilled", evidence: { source: "tag_signal", detail: "Sinal de end card/CTA (logo/marca/URL) encontrado." } }
      : { state: "missing", evidence: { source: "tag_signal", detail: "Nenhum sinal de end card/CTA nas tags/tema." } };
  }
  const keywords = PRODUCT_FEATURE_KEYWORDS[category];
  if (keywords && hasKeyword(signal, keywords)) {
    return { state: "fulfilled", evidence: { source: "tag_signal", detail: `Palavra-chave de "${category}" encontrada nas tags/tema.` } };
  }
  if (hasTagSignal(signal, PRODUCT_TAG_SIGNAL) || hasTagSignal(signal, SCREENSHOT_TAG_SIGNAL)) {
    return { state: "candidate_found", evidence: { source: "tag_signal", detail: "Sinal genérico de produto encontrado, mas sem palavra-chave específica desta funcionalidade." } };
  }
  return { state: "missing", evidence: { source: "tag_signal", detail: `Nenhum sinal de "${category}" nas tags/tema — avaliação best-effort por palavra-chave (seção de limitações conhecidas).` } };
}

function evaluateSceneTheme(category: RequirementCategory, signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (category === "scene") {
    return hasTagSignal(signal, CONTEXT_TAG_SIGNAL)
      ? { state: "fulfilled", evidence: { source: "tag_signal", detail: "Sinal de contexto de cena encontrado." } }
      : { state: "unknown", evidence: { source: "tag_signal", detail: "Categoria genérica de cena — sem sinal específico suficiente para decidir." } };
  }
  const keywords = SCENE_KEYWORDS[category] ?? [];
  return hasKeyword(signal, keywords)
    ? { state: "fulfilled", evidence: { source: "tag_signal", detail: `Palavra-chave de "${category}" encontrada nas tags/tema.` } }
    : { state: "missing", evidence: { source: "tag_signal", detail: `Nenhuma palavra-chave de "${category}" nas tags/tema — avaliação best-effort (limitação conhecida).` } };
}

function evaluateEmotionTheme(category: RequirementCategory, signal: AssetSignal): { state: RequirementState; evidence: RequirementEvidence } {
  if (category === "emotion") {
    return signal.emotion
      ? { state: "fulfilled", evidence: { source: "structured_field", detail: `Campo emotion="${signal.emotion}" presente.` } }
      : { state: "unknown", evidence: { source: "structured_field", detail: "Campo emotion ausente no asset." } };
  }
  const keywords = EMOTION_KEYWORDS[category] ?? [];
  return hasKeyword(signal, keywords)
    ? { state: "fulfilled", evidence: { source: "tag_signal", detail: `Palavra-chave emocional de "${category}" encontrada.` } }
    : { state: "unknown", evidence: { source: "tag_signal", detail: `Nenhuma palavra-chave emocional de "${category}" — avaliação best-effort (limitação conhecida).` } };
}

/**
 * Requisitos de áudio (narração/música) e de diversidade agregada (visual/câmera/cena) NUNCA são
 * avaliáveis contra um único asset visual — o primeiro grupo é validado no pipeline de áudio da
 * Nora (fora do escopo deste avaliador); o segundo só existe como propriedade do CONJUNTO de Shots
 * (ver `coverage-graph.ts`, que deriva esses estados a partir de `ProductionDiversityViolation`).
 * Retornar `unknown` aqui é honesto — nunca finge ter validado o que não pode validar por asset.
 */
function evaluateNotEvaluablePerAsset(category: RequirementCategory): { state: RequirementState; evidence: RequirementEvidence } {
  return { state: "unknown", evidence: { source: "not_evaluable", detail: `"${category}" não é avaliável por asset individual — validado em outra etapa do pipeline ou no nível do conjunto de Shots.` } };
}

export function evaluateRequirement(requirement: ShotRequirement, signal: AssetSignal | undefined): RequirementEvaluation {
  if (!signal) {
    return { requirement, state: "missing", evidence: { source: "resolver", detail: "Nenhum asset resolvido para este Shot." } };
  }

  const family = REQUIREMENT_CATEGORY_FAMILY[requirement.category];
  const result = (() => {
    switch (family) {
      case "human_presence": return evaluateHumanPresence(signal);
      case "device_presence": return evaluateDevicePresence(requirement.category, signal);
      case "screen_visibility": return evaluateScreenVisibility(signal);
      case "interaction": return evaluateInteraction(signal);
      case "media_type": return evaluateMediaType(requirement.category, signal);
      case "product_signal": return evaluateProductSignal(requirement.category, signal);
      case "scene_theme": return evaluateSceneTheme(requirement.category, signal);
      case "emotion_theme": return evaluateEmotionTheme(requirement.category, signal);
      case "audio_pipeline":
      case "aggregate_diversity":
        return evaluateNotEvaluablePerAsset(requirement.category);
      default:
        return evaluateNotEvaluablePerAsset(requirement.category);
    }
  })();

  return { requirement, state: result.state, evidence: result.evidence };
}
