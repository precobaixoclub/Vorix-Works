/**
 * Miniatura de uma imagem de referência. URLs do storage da Vorix já chegam assinadas
 * (`?exp=…&sig=…`) e aceitam `w` (160/480/960) para servir uma versão leve; qualquer outra URL
 * volta como está.
 */
export function referenceThumb(url: string, width: 160 | 480 | 960): string {
  if (!/[?&]sig=/.test(url) || /[?&]w=/.test(url)) return url;
  return `${url}&w=${width}`;
}
