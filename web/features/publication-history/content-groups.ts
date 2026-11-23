import { derivePublicationStatus, type PublicationDisplayStatus, type PublicationNetwork, type UnifiedPublication } from "./types";

/**
 * Um conteúdo = a mesma peça (mesma legenda e mesma mídia) publicada em uma ou mais redes. O
 * histórico guarda um registro por rede; a tela de Conteúdos mostra o conteúdo uma vez só, com o
 * ícone de cada rede e o resultado de cada uma no detalhe.
 */
export type ContentGroup = {
  key: string;
  /** Um registro por rede, na ordem em que foram criados. */
  posts: UnifiedPublication[];
  /** Registro usado para capa, legenda e "Publicar novamente". */
  primary: UnifiedPublication;
  networks: PublicationNetwork[];
  status: PublicationDisplayStatus;
  /** Data de referência do conteúdo (agendamento, publicação ou criação do registro mais recente). */
  date?: string;
};

/** Registros da mesma peça em redes diferentes nascem juntos; acima disso é outra publicação. */
export const CONTENT_GROUP_WINDOW_MS = 2 * 60 * 60 * 1000;

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Caminho da mídia sem assinatura (`?exp&sig` muda a cada resposta). */
function mediaFingerprint(post: UnifiedPublication): string {
  const strip = (url: string) => url.split(/[?#]/)[0] ?? url;
  return [post.media.videoUrl, ...post.media.imageUrls].filter((url): url is string => Boolean(url)).map(strip).join("|");
}

export function publicationDate(post: UnifiedPublication): string | undefined {
  return post.scheduledAt ?? post.publishedAt ?? post.createdAt;
}

function timeOf(post: UnifiedPublication): number {
  const time = new Date(post.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Mesma peça: legenda igual e, quando as duas têm mídia, a mesma mídia. Sem legenda, só a mídia decide. */
function samePiece(a: UnifiedPublication, b: UnifiedPublication): boolean {
  const textA = normalizeText(a.text);
  const textB = normalizeText(b.text);
  const mediaA = mediaFingerprint(a);
  const mediaB = mediaFingerprint(b);
  if (!textA && !textB) return Boolean(mediaA) && mediaA === mediaB;
  if (textA !== textB) return false;
  return !mediaA || !mediaB || mediaA === mediaB;
}

/**
 * Situação do conteúdo como um todo: publicado se saiu em pelo menos uma rede (o detalhe mostra
 * qual falhou); senão, a situação mais "viva" entre as redes.
 */
export function groupStatus(posts: readonly UnifiedPublication[]): PublicationDisplayStatus {
  const statuses = posts.map((post) => derivePublicationStatus(post));
  for (const status of ["published", "publishing", "awaiting_approval", "scheduled", "failed", "draft", "cancelled"] as const) {
    if (statuses.includes(status)) return status;
  }
  return statuses[0] ?? "draft";
}

export function groupPublications(posts: readonly UnifiedPublication[]): ContentGroup[] {
  const ordered = [...posts].sort((a, b) => timeOf(a) - timeOf(b));
  const groups: UnifiedPublication[][] = [];
  for (const post of ordered) {
    const target = groups.find((group) =>
      !group.some((item) => item.network === post.network)
      && Math.abs(timeOf(group[0]!) - timeOf(post)) <= CONTENT_GROUP_WINDOW_MS
      && samePiece(group[0]!, post));
    if (target) target.push(post);
    else groups.push([post]);
  }
  return groups.map((items) => {
    const primary = items.find((item) => item.media.imageUrls.length || item.media.videoUrl || item.media.thumbnailUrl) ?? items[0]!;
    const dates = items.map(publicationDate).filter((date): date is string => Boolean(date)).sort();
    return {
      key: items.map((item) => `${item.network}:${item.id}`).join("+"),
      posts: items,
      primary,
      networks: items.map((item) => item.network),
      status: groupStatus(items),
      date: dates[dates.length - 1],
    };
  });
}
