/**
 * Auditoria "motor de geração de criativos" — achado ao vivo em produção: `gpt-image-1` só
 * suporta 3 tamanhos fixos (quadrado/retrato/paisagem, ver `resolveOpenAiImageSize` na camada de
 * infraestrutura), nenhum deles exatamente `4:5`/`9:16`/`16:9` — o resultado é cortado,
 * centralizado, pro valor exato DEPOIS (`cropToTargetAspectRatio`). O modelo de imagem desenha
 * sobre o canvas NATIVO (maior que o final), sem saber que uma faixa das bordas será removida —
 * uma instrução de margem de segurança genérica ("6% de cada borda", valor arbitrário) não
 * corresponde à margem REAL que o corte remove, então um elemento a 6-8% da borda do canvas
 * nativo ainda pode cair inteiramente na faixa cortada.
 *
 * Esta função replica a MESMA matemática de `cropToTargetAspectRatio`/`resolveOpenAiImageSize`
 * (`src/infrastructure/ai-providers`) — não pode importar de lá (camada `shared` nunca depende de
 * `infrastructure`), então os três tamanhos nativos ficam duplicados aqui deliberadamente,
 * sincronizados a mão; `tests/image-crop-geometry.test.mjs` cobre os três formatos suportados
 * contra os valores reais medidos, e qualquer mudança num dos dois lados que quebre essa
 * correspondência precisa atualizar o outro também.
 */

const NATIVE_SIZES_BY_ASPECT_RATIO: Record<string, readonly [number, number]> = {
  "16:9": [1536, 1024],
  "9:16": [1024, 1536],
  "4:5": [1024, 1536],
};

const MISMATCH_TOLERANCE = 0.02;

/**
 * Margem de segurança (percentual do canvas NATIVO, antes do corte) necessária pra garantir que
 * nada desenhado pelo modelo de imagem caia na faixa que o corte automático remove — mesmo
 * cálculo usado por `cropToTargetAspectRatio` pra decidir quanto cortar, aplicado ao inverso
 * (quanto sobra de cada lado). `undefined` quando o formato não sofre corte (proporção nativa já
 * bate com a pedida, ex.: `1:1`) ou não é reconhecido — o chamador decide o padrão nesse caso.
 */
export function computeCropSafeMarginPct(aspectRatioLabel: string | undefined): number | undefined {
  const normalized = (aspectRatioLabel ?? "").trim();
  const native = NATIVE_SIZES_BY_ASPECT_RATIO[normalized];
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!native || !match) return undefined;

  const [nativeWidth, nativeHeight] = native;
  const targetRatio = Number(match[1]) / Number(match[2]);
  const nativeRatio = nativeWidth / nativeHeight;
  if (Math.abs(nativeRatio - targetRatio) / targetRatio <= MISMATCH_TOLERANCE) return undefined;

  if (nativeRatio < targetRatio) {
    const targetHeight = Math.round(nativeWidth / targetRatio);
    const removedPerSide = (nativeHeight - targetHeight) / 2;
    return Math.round((removedPerSide / nativeHeight) * 1000) / 10;
  }
  const targetWidth = Math.round(nativeHeight * targetRatio);
  const removedPerSide = (nativeWidth - targetWidth) / 2;
  return Math.round((removedPerSide / nativeWidth) * 1000) / 10;
}
