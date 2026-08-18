/**
 * Forma de nó que o Satori aceita nativamente — sem JSX (ver decisão de arquitetura: não existe
 * tooling de JSX fora do Remotion neste projeto hoje, então os componentes são funções `.ts`
 * puras devolvendo esta árvore de objeto, no lugar de `.tsx`).
 */
export type SatoriNode = {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: SatoriNode | SatoriNode[] | string | Array<SatoriNode | string>;
    [key: string]: unknown;
  };
};

export function el(type: string, style: Record<string, string | number> = {}, children?: SatoriNode["props"]["children"]): SatoriNode {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}

const AVERAGE_CHAR_WIDTH_RATIO = 0.58;

/** Maior tamanho de fonte que cabe DENTRO da caixa (largura E altura), pro texto não vazar do
 * componente — sem isto, um preço/CTA longo estourava a caixa (achado ao vivo, teste manual do
 * renderer: "R$ 39,99" quebrando linha e vazando pra fora do cartão branco). `maxHeightRatio`
 * controla quanto da altura disponível o texto pode ocupar (deixa espaço pra padding). */
export function fitFontSizeToBox(text: string, widthPx: number, heightPx: number, maxHeightRatio = 0.6): number {
  const heightBasedSize = Math.round(heightPx * maxHeightRatio);
  const safeLength = Math.max(1, text.length);
  const widthBasedSize = Math.floor(widthPx / (safeLength * AVERAGE_CHAR_WIDTH_RATIO));
  return Math.max(10, Math.min(heightBasedSize, widthBasedSize));
}
