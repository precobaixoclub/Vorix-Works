/**
 * Cálculo de contraste WCAG (luminância relativa + razão de contraste) — função pura, sem I/O.
 * Usada pelo quality gate de tipografia do Lucas (Fase 16) pra checar `TYPOGRAPHY_CONTRAST_LOW`
 * a partir da geometria REAL que o renderer usou, sem precisar de nenhuma chamada de IA.
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const normalized = hex.trim().replace(/^#/, "");
  const full = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Razão de contraste WCAG entre duas cores hex (#RRGGBB ou #RGB) — `undefined` quando uma das
 * cores não é um hex válido (nunca lança, ex.: cor "transparent" ou nome de cor não-hex). */
export function computeContrastRatio(colorA: string, colorB: string): number | undefined {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  if (!rgbA || !rgbB) return undefined;
  const luminanceA = relativeLuminance(rgbA);
  const luminanceB = relativeLuminance(rgbB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}
