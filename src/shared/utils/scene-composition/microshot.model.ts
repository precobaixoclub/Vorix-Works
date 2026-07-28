import type { TransitionStyle } from "../cinematic-reference-library.js";
import type { MicroShotFraming, MicroShotMovement } from "./microshot-vocabulary.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — `MicroShot` (seção 2 da sprint): a unidade que este motor
 * introduz ENTRE o Shot existente (`s2-shot-3`, já produzido por `planShotsForScene` em
 * `cinematic-reference-library.ts`/consumido como `VisualAssetSearchQuery.shotId` pelo resto do
 * pipeline) e o asset final. Um Shot nunca precisa mais ser satisfeito por um único asset — ele é
 * decomposto em 2 a 8 `MicroShot`s, e cada um pode receber seu próprio asset.
 *
 * `priority` reaproveita EXATAMENTE o vocabulário `ShotPriority` já usado por
 * `production-readiness.ts` (`"obrigatorio" | "desejavel"`) — mesmo conceito, mesma escala, nunca
 * um terceiro vocabulário paralelo — mas como TIPO LITERAL local (não importado) para não criar
 * uma dependência de import em um arquivo do Unified Coverage Model que esta sprint promete não
 * alterar (importar um tipo não o altera, mas manter o literal aqui deixa essa garantia óbvia por
 * inspeção, sem depender de nenhuma decisão futura sobre aquele arquivo).
 */
export type MicroShotPriority = "obrigatorio" | "desejavel";

export type MicroShot = {
  id: string;
  parentShot: string;
  purpose: string;
  duration: number;
  priority: MicroShotPriority;
  requiredElements: string[];
  preferredCamera: MicroShotFraming;
  preferredMovement: MicroShotMovement;
  emotion: string;
  transitionIn: TransitionStyle;
  transitionOut: TransitionStyle;
};

export type MicroShotPlan = {
  parentShotId: string;
  sceneOrder: number;
  totalDurationSeconds: number;
  microShots: MicroShot[];
};
