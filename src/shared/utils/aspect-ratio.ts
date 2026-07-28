/**
 * Autoridade única de proporção/resolução visual, compartilhada por Sofia (decide),
 * Bianca/Pedro (recebem e aplicam) e Lucas (valida) — nenhuma dessas Skills deve calcular seu
 * próprio valor de proporção/resolução isoladamente (ver ADR 0002: `src/shared` não é uma Skill,
 * importar daqui não viola o isolamento entre Skills). Antes desta correção, Arthur enviava um
 * `desiredAspectRatio` estático ("4:5") direto para Pedro, nunca sobrescrito pela proporção que
 * Sofia já calculava a partir de canal/formato — por isso todo Story era gerado em 4:5 em vez de
 * 9:16 (BUG-06).
 */
import { normalize } from "./skill-parsing.js";

const KNOWN_RESOLUTIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

/**
 * Decide a proporção visual a partir do canal e do formato solicitados — nunca um valor estático.
 * Ordem de prioridade: canal TikTok ou formato de Story/Reels sempre vertical (9:16); pedido
 * explícito de quadrado vence o padrão de carrossel/feed (1:1); carrossel de feed (4:5); capa/
 * thumbnail do YouTube (16:9); feed vertical padrão, incluindo imagem única (4:5).
 */
export function resolveAspectRatio(channel: string, format: string): string {
  const normalizedChannel = normalize(channel);
  const normalizedFormat = normalize(format);

  if (normalizedChannel === "tiktok" || containsAny(normalizedFormat, ["story", "stories", "reels", "reel"])) {
    return "9:16";
  }
  if (containsAny(normalizedFormat, ["quadrado", "quadrada", "1:1", "square"])) {
    return "1:1";
  }
  if (containsAny(normalizedFormat, ["carrossel", "carousel", "slides"])) {
    return "4:5";
  }
  if (normalizedChannel === "youtube" && containsAny(normalizedFormat, ["capa", "thumbnail"])) {
    return "16:9";
  }
  return "4:5";
}

/** Resolução canônica (largura x altura) para uma proporção conhecida, em texto "LARGURAxALTURA". */
export function resolutionLabelForAspectRatio(aspectRatio: string): string {
  const resolution = KNOWN_RESOLUTIONS[aspectRatio.trim()];
  if (!resolution) return "usar resolução compatível com a proporção informada, preferencialmente com largura mínima de 1080px";
  return `${resolution.width}x${resolution.height}`;
}

/** Resolução canônica (largura x altura) para uma proporção conhecida, em números — usada por Pedro para montar os arquivos esperados no modo assistido. */
export function resolutionForAspectRatio(aspectRatio: string): { width: number; height: number } {
  return KNOWN_RESOLUTIONS[aspectRatio.trim()] ?? { width: 1080, height: 1080 };
}

/** Extrai [largura, altura] de textos como "9:16", "1080:1920" ou "1080x1920"; null se não reconhecer o formato. */
function parseRatioComponents(value: string): [number, number] | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return [width, height];
}

/**
 * Compara duas representações de proporção (ex.: "9:16" e "1080:1920", ou "1080x1920") pela razão
 * numérica, não pela string — para que representações matematicamente equivalentes nunca disparem
 * um warning de divergência. Quando qualquer uma das duas não pode ser interpretada como uma razão
 * numérica, cai para comparação de igualdade de texto (comportamento conservador anterior).
 */
export function areAspectRatiosEquivalent(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const first = parseRatioComponents(a);
  const second = parseRatioComponents(b);
  if (!first || !second) return false;
  const ratioA = first[0] / first[1];
  const ratioB = second[0] / second[1];
  return Math.abs(ratioA - ratioB) < 0.001;
}
