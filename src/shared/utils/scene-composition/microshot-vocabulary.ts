/**
 * CINEMATIC SCENE COMPOSITION ENGINE — vocabulário de enquadramento/movimento por MICROPLANO
 * (seção 7/8 da sprint). Nunca duplica `ShotType`/`TransitionStyle` de `cinematic-reference-library.ts`
 * — aquele arquivo já cobre a granularidade CENA → SHOT ("s2-shot-3"); este módulo cobre a
 * granularidade FINA SHOT → MICROSHOT (vários microplanos dentro do MESMO Shot), então precisa de
 * um vocabulário mais rico (Hands/Screen/Reaction/Over Shoulder/POV não existem em `ShotType`).
 * `TransitionStyle` (cinematic-reference-library.ts) É reaproveitado diretamente para
 * transitionIn/transitionOut — não recriado aqui.
 */

export const MICROSHOT_FRAMINGS = [
  "wide",
  "medium",
  "close",
  "extreme_close",
  "over_shoulder",
  "pov",
  "detail",
  "hands",
  "reaction",
  "screen",
] as const;
export type MicroShotFraming = (typeof MICROSHOT_FRAMINGS)[number];

export const MICROSHOT_MOVEMENTS = [
  "static",
  "pan",
  "tilt",
  "zoom",
  "push",
  "pull",
  "tracking",
  "handheld",
  "slow_motion",
] as const;
export type MicroShotMovement = (typeof MICROSHOT_MOVEMENTS)[number];

/** Rótulos legíveis em pt-BR — só para relatório (seção 16), nunca usados como chave interna. */
export const MICROSHOT_FRAMING_LABEL: Record<MicroShotFraming, string> = {
  wide: "Plano Geral",
  medium: "Plano Médio",
  close: "Close",
  extreme_close: "Close Extremo",
  over_shoulder: "Por Cima do Ombro",
  pov: "Ponto de Vista",
  detail: "Detalhe",
  hands: "Mãos",
  reaction: "Reação",
  screen: "Tela",
};

export const MICROSHOT_MOVEMENT_LABEL: Record<MicroShotMovement, string> = {
  static: "Estático",
  pan: "Panorâmica",
  tilt: "Inclinação",
  zoom: "Zoom",
  push: "Aproximação",
  pull: "Afastamento",
  tracking: "Acompanhamento",
  handheld: "Câmera na Mão",
  slow_motion: "Câmera Lenta",
};
