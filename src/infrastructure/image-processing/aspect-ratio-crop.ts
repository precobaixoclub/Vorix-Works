import sharp from "sharp";

/** Tolerância relativa entre a proporção nativa e a proporção alvo abaixo da qual não vale a pena
 * cortar (evita corte microscópico quando as duas já batem, ex.: 1:1 pedido = 1:1 nativo). */
const MISMATCH_TOLERANCE = 0.02;

/** Interpreta um rótulo "W:H" (ex.: "9:16", "4:5", "16:9", "1:1") como razão numérica width/height.
 * `undefined` para rótulo ausente ou malformado — nunca lança. */
function parseAspectRatioLabel(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const match = label.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return undefined;
  return width / height;
}

/**
 * Corta uma imagem, centralizada, para a proporção alvo exata.
 *
 * Achado ao vivo (Rodada 1): `gpt-image-1` só suporta 3 tamanhos fixos (quadrado/retrato/paisagem),
 * nenhum deles exatamente 9:16 ou 4:5 — o código pede o tamanho suportado mais próximo (ex.:
 * 1024x1536 = 2:3 para "9:16"), mas o PROMPT ainda promete ao modelo a proporção real pedida. O
 * modelo tenta reconciliar as duas instruções desenhando o conteúdo como uma "cartela" mais estreita
 * centralizada dentro do canvas real — produzindo pillarboxing/letterboxing visível (barras) na
 * imagem final, confirmado numa geração real em formato Story.
 *
 * Este corte é a correção determinística: sempre reduz (nunca estica/preenche/inventa pixel), então
 * nunca pode piorar a fidelidade — só remove uma faixa das bordas quando a proporção nativa e a
 * proporção alvo já não bastam para bater dentro da tolerância. `aspectRatioLabel` ausente/malformado
 * ou já compatível devolve o buffer original sem tocar nele.
 */
export async function cropToTargetAspectRatio(buffer: Buffer, aspectRatioLabel: string | undefined): Promise<Buffer> {
  const targetRatio = parseAspectRatioLabel(aspectRatioLabel);
  if (!targetRatio) return buffer;

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return buffer;

    const nativeRatio = width / height;
    const relativeDifference = Math.abs(nativeRatio - targetRatio) / targetRatio;
    if (relativeDifference <= MISMATCH_TOLERANCE) return buffer;

    const targetWidth = Math.max(1, Math.min(width, Math.round(height * targetRatio)));
    const targetHeight = Math.max(1, Math.min(height, Math.round(width / targetRatio)));
    const left = Math.round((width - targetWidth) / 2);
    const top = Math.round((height - targetHeight) / 2);

    return await sharp(buffer).extract({ left, top, width: targetWidth, height: targetHeight }).png().toBuffer();
  } catch {
    // Best-effort: bytes ilegíveis pelo sharp (ou qualquer outra falha de processamento) nunca
    // devem derrubar a geração inteira — devolve a imagem original, com a proporção que veio.
    return buffer;
  }
}
