import { END_CARD_TAG_SIGNAL, PRODUCT_TAG_SIGNAL } from "../visual-asset-tag-signals.js";
import { MIN_SEGMENT_DURATION_SECONDS } from "../scene-composition/composite-shot-coverage.js";
import { CUT_CROSSFADE_SECONDS, DEFAULT_CROSSFADE_SECONDS, MIN_CLIP_DURATION_SECONDS, XFADE_TRANSITION_BY_STYLE } from "../video-timing-constants.js";

/**
 * NARRATIVE TIMING REBALANCING — modelo de restrição temporal (seção 2). Tipo de entrada
 * DELIBERADAMENTE agnóstico de Skill (nunca importa `DiegoShotTimelineEntry`/`VideoRenderShot`
 * diretamente — violaria a fronteira Clean Architecture entre `shared/utils` e `skills/*`): quem
 * chama (Rafa) mapeia seus próprios tipos para este formato mínimo. Todos os campos já existem
 * em algum lugar do pipeline (Diego/Vanessa/Bruno) — nada aqui é inventado.
 */
export type TimingShotInput = {
  shotId: string;
  sceneOrder: number;
  shotOrder: number;
  /** Vocabulário existente de `ShotPurpose`/`VisualSequenceRole` — nunca um vocabulário novo. */
  purpose: string;
  allocatedDuration: number;
  entranceTransition: string;
  exitTransition: string;
  /** Tags do `visualAssetRequirement` (Vanessa/Diego) — mesmo vocabulário de `visual-asset-tag-signals.ts`. */
  tags: string[];
  /** Presente só quando o Shot tem uma composição pendente com déficit conhecido (seção 4). */
  requiredMinimumDuration?: number;
  /** Texto livre de continuidade/sincronização (Diego) — usado só como sinal informativo, nunca veto absoluto (ver `audioDependency`, seção 10 do relatório). */
  syncNotes?: string;
};

export type TimingFlexibilityClass = "locked" | "minimum_bound" | "flexible" | "decorative" | "composite_required";

export type TimingConstraint = {
  shotId: string;
  allocatedDuration: number;
  minimumDuration: number;
  preferredDuration: number;
  maximumDuration?: number;
  isTimingLocked: boolean;
  timingFlexibility: TimingFlexibilityClass;
  /** 0 (baixa) a 2 (alta) — quanto maior, menos disposto a ceder tempo (seção 8: minimizar impacto narrativo). */
  timingPriority: number;
  /** 0-1 — densidade de conteúdo (nº de tags de conteúdo relevantes / piso de legibilidade aplicado). */
  contentDensity: number;
  /** Autêntico: narração é UMA faixa contínua por CENA (nunca por Shot) — ver auditoria da sprint. Preservar a duração da CENA garante zero impacto na faixa de áudio; `audioDependency` é informativo, não um veto por si só. */
  audioDependency: boolean;
  textReadabilityDependency: boolean;
  /** Sobrecarga de transição (seção 12) — segundos que a transição de ENTRADA consome de exposição visível útil. */
  transitionDependency: number;
};

/** Mesmo piso de "fica ilegível/imperceptível abaixo disso" já usado pelo Composite Shot Coverage — nunca uma fórmula nova (seção 11: "reutilizar regras existentes de legibilidade quando disponíveis"). */
export const READABILITY_FLOOR_SECONDS = MIN_SEGMENT_DURATION_SECONDS;

function hasAnyTag(tags: string[], signals: string[]): boolean {
  const normalized = tags.map((tag) => tag.toLowerCase());
  return signals.some((signal) => normalized.includes(signal));
}

/** Seção 12 — quanto da duração NOMINAL de um Shot é consumido pela transição de ENTRADA (crossfade sobrepõe o fim do Shot anterior com o início deste, então o início "nominal" deste Shot já está parcialmente visível durante a transição — nunca contado duas vezes, só descontado da exposição própria do Shot doador anterior). Reaproveita a MESMA tabela do compilador FFmpeg real (`timeline-to-filter-compiler.ts`), nunca uma tabela paralela. */
export function transitionOverheadSeconds(transition: string): number {
  if (transition === "cut") return CUT_CROSSFADE_SECONDS;
  const entry = (XFADE_TRANSITION_BY_STYLE as Record<string, { name: string; durationSeconds: number }>)[transition];
  return entry?.durationSeconds ?? DEFAULT_CROSSFADE_SECONDS;
}

/** Seção 12 — duração efetivamente visível de um Shot, descontando a sobreposição da transição de saída (a de entrada já foi contabilizada no Shot anterior — nunca descontar as duas pontas, senão o Shot perde tempo em dobro). */
export function effectiveVisibleDurationSeconds(allocatedDuration: number, exitTransition: string): number {
  const overhead = transitionOverheadSeconds(exitTransition);
  return Math.max(0, allocatedDuration - overhead);
}

function classifyTimingFlexibility(input: TimingShotInput, minimumDuration: number, isLocked: boolean): TimingFlexibilityClass {
  if (input.requiredMinimumDuration !== undefined) return "composite_required";
  if (isLocked) return "locked";
  if (input.allocatedDuration <= minimumDuration + 0.001) return "minimum_bound";
  // "decorative" nunca decidido só pelo texto do purpose (seção 3, "IMPORTANTE") — exige AUSÊNCIA
  // simultânea de conteúdo de produto/CTA/legibilidade E purpose de baixo peso narrativo.
  const isLowWeightPurpose = input.purpose === "establishing" || input.purpose === "reaction";
  const hasContentSignal = hasAnyTag(input.tags, PRODUCT_TAG_SIGNAL) || hasAnyTag(input.tags, END_CARD_TAG_SIGNAL);
  if (isLowWeightPurpose && !hasContentSignal) return "decorative";
  return "flexible";
}

/**
 * Deriva o modelo de restrição temporal (seção 2) de um Shot a partir de dados JÁ existentes —
 * nunca pergunta nada novo às Skills anteriores. Determinístico, sem heurística de texto livre
 * além da detecção de tags/purpose já usada em outras partes do pipeline (Official Asset
 * Authenticity Policy, Composite Shot Coverage).
 */
export function deriveTimingConstraint(input: TimingShotInput): TimingConstraint {
  const isCtaOrEndCard = input.purpose === "closing" && hasAnyTag(input.tags, END_CARD_TAG_SIGNAL);
  const hasProductContent = hasAnyTag(input.tags, PRODUCT_TAG_SIGNAL);
  const textReadabilityDependency = isCtaOrEndCard || hasProductContent;

  // CTA/end-card e conteúdo de produto/interface exigem o piso de legibilidade (seção 11); Shots
  // puramente decorativos/contextuais mantêm o piso técnico de flicker (seção 1 da auditoria:
  // MIN_CLIP_DURATION_SECONDS = 0.4s).
  const minimumDuration = textReadabilityDependency ? READABILITY_FLOOR_SECONDS : MIN_CLIP_DURATION_SECONDS;

  // "locked" (seção 3): CTA/end-card com piso mínimo — perder tempo o levaria abaixo do que a
  // sprint anterior (Official Asset Priority) e esta mesma exigem para legibilidade; nunca uma
  // detecção de texto livre em `syncNotes` (esse texto é um lembrete editorial UNIFORME que Diego
  // aplica a TODO Shot da campanha — não diferencia nada, confirmado na auditoria desta sprint).
  const isTimingLocked = isCtaOrEndCard;

  const timingFlexibility = classifyTimingFlexibility(input, minimumDuration, isTimingLocked);
  const timingPriority = isTimingLocked ? 2 : textReadabilityDependency ? 1 : 0;

  const transitionDependency = transitionOverheadSeconds(input.entranceTransition);

  return {
    shotId: input.shotId,
    allocatedDuration: input.allocatedDuration,
    minimumDuration: Math.max(minimumDuration, input.requiredMinimumDuration ?? 0),
    preferredDuration: input.allocatedDuration,
    isTimingLocked,
    timingFlexibility,
    timingPriority,
    contentDensity: input.tags.length === 0 ? 0 : Math.min(1, input.tags.length / 10),
    // Narração é uma faixa CONTÍNUA por cena (auditoria seção 3) — todo Shot depende dela no
    // sentido de "toca por baixo", mas só a duração da CENA (soma dos Shots) afeta o arquivo de
    // áudio de verdade. Sinalizado aqui para o rebalancer preferir doadores/receptores da MESMA
    // cena (seção 9), nunca como veto absoluto de um Shot específico.
    audioDependency: true,
    textReadabilityDependency,
    transitionDependency,
  };
}
