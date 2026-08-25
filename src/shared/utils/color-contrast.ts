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

/** Achado ao vivo em produção: `CreativeContext.brandColors` pode vir como NOME de cor em
 * português (ex.: "verde", "amarelo" — extraído/descrito em linguagem natural, útil pro prompt do
 * modelo de imagem, que entende o nome), nunca hex. Um consumidor que espera hex (ex.: o
 * `accentColor` do renderer determinístico) e usa a string direto como cor CSS sem validar antes
 * quebra silenciosamente: "verde" não é uma cor CSS válida, o fundo vira transparente/nada, e
 * `pickReadableTextColor` (sem conseguir calcular contraste) cai no texto escuro padrão — texto
 * escuro sobre fundo indefinido em cima de uma imagem escura = completamente invisível. Use isto
 * pra validar ANTES de tratar uma string como cor CSS real, nunca confiar que `brandColors` é
 * sempre hex só porque geralmente é. */
export function isValidHexColor(value: string): boolean {
  return hexToRgb(value) !== undefined;
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

/** Escolhe entre `lightColor`/`darkColor` a que rende MAIS contraste sobre `backgroundColor`
 * (ex.: uma cor de marca escolhida em tempo real pode ser clara ou escura — texto fixo nunca é
 * seguro). Cai em `darkColor` (o padrão histórico do renderer) quando `backgroundColor` não é um
 * hex válido, nunca lança. */
export function pickReadableTextColor(backgroundColor: string, lightColor = "#FFFFFF", darkColor = "#111111"): string {
  const contrastWithLight = computeContrastRatio(backgroundColor, lightColor);
  const contrastWithDark = computeContrastRatio(backgroundColor, darkColor);
  if (contrastWithLight === undefined || contrastWithDark === undefined) return darkColor;
  return contrastWithLight >= contrastWithDark ? lightColor : darkColor;
}
