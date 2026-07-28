import type { ShotIntent } from "../shot-intent.js";
import type { VisualSequenceRole } from "../../../application/ports/visual-asset-provider.port.js";
import type { MicroShot, MicroShotPriority } from "./microshot.model.js";
import type { MicroShotFraming, MicroShotMovement } from "./microshot-vocabulary.js";
import type { TransitionStyle } from "../cinematic-reference-library.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — SHOT DECOMPOSER (seção 1 da sprint). Entrada: `ShotIntent`
 * (já existe, `shot-intent.ts` — a mesma leitura estruturada do Shot já usada por Footage
 * Acquisition/Visual Validation, nunca um tipo de entrada novo e paralelo). Saída: 2 a 8
 * `MicroShot`s, nunca 1 só quando existir oportunidade narrativa (seção 1: "nunca gerar apenas um
 * plano quando existir oportunidade narrativa").
 *
 * Determinístico e baseado em regras (sem LLM disponível neste ambiente) — cada "oportunidade
 * narrativa" é uma condição objetiva do `ShotIntent` (há pessoa? há dispositivo? há tela? o
 * dispositivo é de mão ou de superfície?), nunca um palpite. Os dois exemplos da sprint ("O casal
 * confirma presença" / "O casal conhece o site") são ilustrativos, não um contrato de saída byte a
 * byte — a decomposição abaixo produz a MESMA estrutura cinematográfica (plano geral → aproximação
 * humana → revelação do dispositivo → tela → reação → fechamento de marca) sem hardcodar os dois
 * exemplos como casos especiais.
 */

const MIN_MICROSHOTS = 2;
const MAX_MICROSHOTS = 8;

type MicroShotSeed = {
  purpose: string;
  camera: MicroShotFraming;
  movement: MicroShotMovement;
  priority: MicroShotPriority;
  requiredElements: string[];
};

function isHandheldDevice(device: ShotIntent["device"]): boolean {
  return device === "phone" || device === "tablet";
}

function isSurfaceDevice(device: ShotIntent["device"]): boolean {
  return device === "notebook" || device === "desktop";
}

function needsHumanPresence(intent: ShotIntent, shotPurpose: VisualSequenceRole): boolean {
  return shotPurpose === "human_interaction" || shotPurpose === "reaction" || Boolean(intent.protagonist);
}

function isProductShot(intent: ShotIntent, shotPurpose: VisualSequenceRole): boolean {
  return shotPurpose === "product" || intent.screenVisibleRequired || intent.compositingRequired;
}

function buildSeeds(intent: ShotIntent, shotPurpose: VisualSequenceRole): MicroShotSeed[] {
  const seeds: MicroShotSeed[] = [];
  const human = needsHumanPresence(intent, shotPurpose);
  const product = isProductShot(intent, shotPurpose);
  const device = intent.device;
  const handheld = isHandheldDevice(device);
  const surface = isSurfaceDevice(device);

  // 1) Plano geral — sempre estabelece o contexto do microplano, primeira "oportunidade narrativa".
  seeds.push({
    purpose: "establishing_wide",
    camera: "wide",
    movement: "static",
    priority: "desejavel",
    requiredElements: ["scene_context"],
  });

  // 2) Aproximação humana — só quando o Shot de fato tem gente pra aproximar.
  if (human) {
    seeds.push({
      purpose: "human_close",
      camera: "close",
      movement: "push",
      priority: shotPurpose === "human_interaction" ? "obrigatorio" : "desejavel",
      requiredElements: ["human"],
    });
  }

  // 3) Revelação do dispositivo — mão (handheld) ou plano médio (superfície), nunca os dois iguais.
  if (handheld) {
    seeds.push({
      purpose: "hand_detail",
      camera: "hands",
      movement: "tracking",
      priority: "obrigatorio",
      requiredElements: ["device", "hands"],
    });
  } else if (surface) {
    seeds.push({
      purpose: "device_reveal",
      camera: "medium",
      movement: "pan",
      priority: "obrigatorio",
      requiredElements: ["device"],
    });
  }

  // 4) Tela — só quando o Shot realmente exige tela visível (nunca inventada).
  if (intent.screenVisibleRequired) {
    seeds.push({
      purpose: "screen_reveal",
      camera: "screen",
      movement: "zoom",
      priority: "obrigatorio",
      requiredElements: ["screen_visible"],
    });
  }

  // 5) REACTION ENGINE (seção 10) — sempre que há pessoa OU produto, nunca apresentar só telas.
  if (human || product) {
    seeds.push({
      purpose: "reaction",
      camera: "reaction",
      movement: "static",
      priority: "desejavel",
      requiredElements: human ? ["human", "emotion"] : ["emotion"],
    });
  }

  // 6) Fechamento de marca/produto — closing beat quando há produto ou o próprio Shot fecha a cena.
  if (product || shotPurpose === "closing") {
    seeds.push({
      purpose: "brand_detail",
      camera: "detail",
      movement: "static",
      priority: "desejavel",
      requiredElements: ["brand_or_cta"],
    });
  }

  // 7) Shot "rico" (pessoa + produto): um segundo detalhe de apoio para não faltar cobertura de B-roll.
  if (human && product && seeds.length < MAX_MICROSHOTS) {
    seeds.push({
      purpose: "supporting_detail",
      camera: "extreme_close",
      movement: "slow_motion",
      priority: "desejavel",
      requiredElements: ["texture_or_environment"],
    });
  }

  // Garante o mínimo de 2 (seção 1: nunca 1 plano só quando existe oportunidade narrativa —
  // um Shot puramente temático, sem pessoa/produto, ainda ganha um detalhe de apoio).
  if (seeds.length < MIN_MICROSHOTS) {
    seeds.push({
      purpose: "context_detail",
      camera: "detail",
      movement: "static",
      priority: "desejavel",
      requiredElements: ["scene_context"],
    });
  }

  return seeds.slice(0, MAX_MICROSHOTS);
}

function transitionFor(index: number, total: number): { transitionIn: TransitionStyle; transitionOut: TransitionStyle } {
  const transitionIn: TransitionStyle = index === 0 ? "cut" : "dissolve";
  const transitionOut: TransitionStyle = index === total - 1 ? "cut" : "dissolve";
  return { transitionIn, transitionOut };
}

/**
 * Distribui a duração total do Shot entre os microplanos — obrigatórios recebem mais tempo que
 * desejáveis (peso 1.4 vs 1.0), sempre respeitando VISUAL RHYTHM (seção 9): nunca dois microplanos
 * consecutivos com a mesma duração arredondada, para já nascer sem um "ritmo plano".
 */
function distributeDurations(seeds: MicroShotSeed[], totalDurationSeconds: number): number[] {
  const weights = seeds.map((seed) => (seed.priority === "obrigatorio" ? 1.4 : 1));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (weight / weightSum) * totalDurationSeconds);

  const durations = raw.map((value) => Math.max(0.6, Math.round(value * 10) / 10));
  for (let index = 1; index < durations.length; index += 1) {
    if (durations[index] === durations[index - 1]) {
      durations[index] = Math.max(0.6, Math.round((durations[index] + (index % 2 === 0 ? 0.4 : -0.4)) * 10) / 10);
    }
  }
  return durations;
}

export function decomposeShot(intent: ShotIntent, shotPurpose: VisualSequenceRole, totalDurationSeconds?: number): MicroShot[] {
  const shotId = intent.shotId ?? `scene-${intent.sceneOrder}-shot`;
  const seeds = buildSeeds(intent, shotPurpose);
  const duration = totalDurationSeconds ?? Math.max(intent.minDurationSeconds, seeds.length * 1.2);
  const durations = distributeDurations(seeds, duration);

  return seeds.map((seed, index) => {
    const { transitionIn, transitionOut } = transitionFor(index, seeds.length);
    return {
      id: `${shotId}::micro-${index + 1}`,
      parentShot: shotId,
      purpose: seed.purpose,
      duration: durations[index],
      priority: seed.priority,
      requiredElements: seed.requiredElements,
      preferredCamera: seed.camera,
      preferredMovement: seed.movement,
      emotion: intent.emotion ?? "neutro",
      transitionIn,
      transitionOut,
    };
  });
}
