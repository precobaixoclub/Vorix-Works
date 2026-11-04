/**
 * Miniatura de uma foto do storage do Vorix (`/uploads/...?w=`): a API gera e guarda em cache uma
 * versão WEBP com a largura pedida. Telas com muitas fotos pequenas (cadastro de produto, catálogo)
 * deixam de baixar e decodificar o original de vários MB. Outras URLs voltam como estão.
 */
export type ThumbWidth = 160 | 480 | 960;
export function thumbUrl<T extends string | undefined>(url: T, width: ThumbWidth): T {
  if (!url || !/^https?:\/\/[^?#]+\/uploads\/[^?#]+\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}` as T;
}
