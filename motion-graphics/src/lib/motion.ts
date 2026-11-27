import { Easing } from "remotion";

/** Parâmetros de movimento vindos do Brand Motion System × Emotion Engine (via plano). */
export type MotionProps = {
  personality?: string;
  easing?: "expo" | "quint" | "sine" | "back";
  intensity?: number;
  overshoot?: number;
  radius?: number;
  textCase?: "upper" | "sentence";
  letterSpacing?: number;
  grain?: number;
  glow?: number;
  composition?: "airy" | "tight";
};

/** Área ocupada pela interface das plataformas (frações do quadro). */
export type Safe = { top: number; bottom: number; left: number; right: number };
export const DEFAULT_SAFE: Safe = { top: 0.12, bottom: 0.22, left: 0.06, right: 0.14 };

const OUT = {
  expo: Easing.bezier(0.16, 1, 0.3, 1),
  quint: Easing.bezier(0.22, 1, 0.36, 1),
  sine: Easing.bezier(0.39, 0.575, 0.565, 1),
  back: Easing.bezier(0.34, 1.4, 0.64, 1),
};
const IN_OUT = {
  expo: Easing.bezier(0.87, 0, 0.13, 1),
  quint: Easing.bezier(0.83, 0, 0.17, 1),
  sine: Easing.bezier(0.37, 0, 0.63, 1),
  back: Easing.bezier(0.68, -0.25, 0.32, 1.25),
};

/** Curvas, molas e estilo de texto resolvidos para a cena. */
export function resolveMotion(motion: MotionProps | undefined) {
  const easing = motion?.easing ?? "quint";
  const overshoot = motion?.overshoot ?? 0;
  const intensity = motion?.intensity ?? 1;
  return {
    out: OUT[easing],
    inOut: IN_OUT[easing === "back" ? "quint" : easing],
    intensity,
    // Mola: sem quique para marcas sóbrias; quique leve para energia/surpresa.
    spring: { damping: overshoot > 0.08 ? 11 : overshoot > 0 ? 15 : 22, stiffness: overshoot > 0 ? 140 : 95, mass: 0.9 },
    radius: motion?.radius ?? 24,
    upper: (motion?.textCase ?? "upper") === "upper",
    letterSpacing: motion?.letterSpacing ?? 0,
    grain: motion?.grain ?? 0.15,
    glow: motion?.glow ?? 0.35,
    airy: motion?.composition !== "tight",
  };
}
export type Motion = ReturnType<typeof resolveMotion>;

/** Caixa segura em pixels. */
export function safeBox(safe: Safe | undefined, width: number, height: number) {
  const s = safe ?? DEFAULT_SAFE;
  return { top: s.top * height, bottom: height - s.bottom * height, left: s.left * width, right: width - s.right * width, width: width * (1 - s.left - s.right), height: height * (1 - s.top - s.bottom) };
}
