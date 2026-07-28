/**
 * Utilitário puro e sem estado, reaproveitado por Maria e Lucas para resolver, a partir do rótulo
 * de formato que já circula no sistema (`recommendedFormatLabel` do Eduardo — "post único",
 * "carrossel", "reels", "vídeo", "story"), qual perfil de avaliação de qualidade se aplica.
 * `src/shared` não é uma Skill — importar daqui não viola o isolamento entre Skills (ADR 0002).
 *
 * Existe para que Feed, Story, Carrossel, Reels e Vídeo curto sejam avaliados com critérios
 * próprios (ver `MARIA_QUALITY_PROFILE_RULES` em `maria-copywriting.skill.ts` e
 * `evaluateFormatProfile` em `lucas-quality-review.skill.ts`) em vez de um único conjunto
 * universal de critérios pensado para feed — o achado que motivou esta separação foi Stories
 * sendo penalizados por não terem legenda longa, CTA extenso, 15+ hashtags ou convite para
 * comentar/salvar, quando nenhum desses critérios faz sentido para o formato.
 */
import { normalize } from "./skill-parsing.js";

export const CONTENT_QUALITY_PROFILES = ["feed", "story", "carrossel", "reels", "video"] as const;

export type ContentQualityProfile = (typeof CONTENT_QUALITY_PROFILES)[number];

/**
 * Resolve o perfil a partir de um rótulo de formato em texto livre. Reconhece tanto o rótulo em
 * português já usado pelo Eduardo/João ("post único", "carrossel", "reels", "vídeo", "story")
 * quanto o enum bruto de `content-format-classification.ts` ("imagem_unica", "video"), já que
 * ambos podem chegar dependendo do caminho de dados. Qualquer valor não reconhecido — incluindo
 * ausente/vazio — cai em "feed", preservando o comportamento universal já existente como padrão
 * seguro (compatível com todo briefing/input que ainda não informa formato).
 */
export function resolveContentQualityProfile(formatLabel: string | undefined | null): ContentQualityProfile {
  const normalized = normalize(formatLabel ?? "");
  if (!normalized) return "feed";
  if (normalized.includes("story")) return "story";
  if (normalized.includes("carrossel") || normalized.includes("carousel")) return "carrossel";
  if (normalized.includes("reels") || normalized.includes("tiktok") || normalized.includes("shorts")) return "reels";
  if (normalized.includes("video")) return "video";
  return "feed";
}
