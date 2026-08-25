import sharp from "sharp";

/**
 * Achado ao vivo em produção (cliente real): uma logo cadastrada como JPEG produzia uma caixa de
 * fundo visível na peça final — JPEG nunca tem canal alfa, "remover o fundo" depois é fisicamente
 * impossível pra esse arquivo, não uma falha do compositor (`logo-compositor.ts`). `hasAlpha` do
 * sharp reflete o canal REAL do arquivo decodificado, nunca a extensão declarada — pega tanto um
 * JPEG quanto um PNG "achatado" (exportado sem transparência apesar da extensão).
 *
 * SVG é vetorial e sempre pode carregar transparência real sem precisar de canal alfa — nunca
 * reprovado aqui (só o compositor final, ao rasterizar, teria fundo se o próprio SVG desenhar um
 * retângulo de fundo opaco, um caso raro fora do escopo desta checagem).
 */
export async function hasRealTransparency(buffer: Buffer, contentType: string): Promise<boolean> {
  if (contentType === "image/svg+xml") return true;
  try {
    const metadata = await sharp(buffer).metadata();
    return Boolean(metadata.hasAlpha);
  } catch {
    return false;
  }
}
