/**
 * Variedade criativa real — compara a peça nova com o histórico visual recente da marca.
 *
 * Achado da auditoria (25/11/2026): ideias diferentes saíam com a mesma composição (catálogo lado
 * a lado na CMKV; papéis/monitor genérico na Vorix) e as telas de um carrossel eram quase cópias,
 * porque cada tela recebia a anterior como referência. Trocar só o texto não é variedade.
 *
 * Duas camadas: estrutura (arquétipo de composição, posição do texto, quantidade de produtos) e
 * percepção (dHash de 64 bits da arte final). Peças da MESMA série (carrossel/campanha padronizada)
 * não são comparadas entre si — consistência ali é intencional.
 */

export type VisualFingerprint = {
  archetype: string;
  textLayout: "top" | "left" | "bottom";
  productCount: number;
  /** Até 3 cores dominantes (#RRGGBB). */
  palette: string[];
  /** dHash 64 bits em hexadecimal (16 caracteres). */
  dHash: string;
  /** Peças da mesma série (ex.: `ideia:<id>`) podem ser parecidas de propósito. */
  seriesKey?: string;
  createdAt?: string;
};

export type VarietyFinding = { code: "REPETITION_PERCEPTUAL" | "REPETITION_LAYOUT"; message: string; againstIndex: number };

export type VarietyAssessment = {
  ok: boolean;
  findings: VarietyFinding[];
  /** Menor distância de Hamming encontrada (64 = totalmente diferente). */
  nearestDistance: number | null;
  compared: number;
};

/** Distância ≤ este limite = praticamente a mesma imagem (layout + massas de cor). */
export const PERCEPTUAL_DUPLICATE_DISTANCE = 10;
/** Dentro da mesma série a unidade visual é bem-vinda, mas tela repetida não: só cópia quase exata. */
export const SERIES_DUPLICATE_DISTANCE = 4;
/** Quantas peças recentes entram na comparação. */
export const VARIETY_WINDOW = 6;
/** Comparação perceptual só com as peças mais recentes (o rodízio de arquétipos cuida do resto). */
export const PERCEPTUAL_WINDOW = 4;

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    let x = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    while (x) { distance += x & 1; x >>= 1; }
  }
  return distance;
}

const structuralKey = (fingerprint: Pick<VisualFingerprint, "archetype" | "textLayout" | "productCount">) => `${fingerprint.archetype}|${fingerprint.textLayout}|${fingerprint.productCount}`;

export function assessVariety(candidate: VisualFingerprint, history: readonly VisualFingerprint[], window = VARIETY_WINDOW): VarietyAssessment {
  const recent = history.filter((item) => !candidate.seriesKey || item.seriesKey !== candidate.seriesKey).slice(0, window);
  const findings: VarietyFinding[] = [];
  if (candidate.seriesKey) {
    history.filter((item) => item.seriesKey === candidate.seriesKey).forEach((item, index) => {
      const distance = hammingHex(candidate.dHash, item.dHash);
      if (distance <= SERIES_DUPLICATE_DISTANCE) findings.push({ code: "REPETITION_PERCEPTUAL", message: `Tela praticamente igual a outra da mesma série (distância ${distance}/64).`, againstIndex: index });
    });
  }
  let nearest: number | null = null;
  recent.forEach((item, index) => {
    const distance = hammingHex(candidate.dHash, item.dHash);
    nearest = nearest === null ? distance : Math.min(nearest, distance);
    if (index < PERCEPTUAL_WINDOW && distance <= PERCEPTUAL_DUPLICATE_DISTANCE) {
      findings.push({ code: "REPETITION_PERCEPTUAL", message: `Quase idêntica a uma peça recente (distância ${distance}/64).`, againstIndex: index });
    }
  });
  // Mesma estrutura em 2 das 3 últimas peças = layout repetido, mesmo com fotos diferentes.
  const sameStructure = recent.slice(0, 3).filter((item) => structuralKey(item) === structuralKey(candidate)).length;
  if (sameStructure >= 2) {
    findings.push({ code: "REPETITION_LAYOUT", message: `Mesma composição (${candidate.archetype}, texto ${candidate.textLayout}) em ${sameStructure} das 3 peças anteriores.`, againstIndex: 0 });
  }
  return { ok: findings.length === 0, findings, nearestDistance: nearest, compared: recent.length };
}

/** Quantas vezes cada arquétipo apareceu nas peças recentes (mais recente pesa mais). */
export function archetypeRecencyPenalty(archetype: string, history: readonly VisualFingerprint[], seriesKey?: string, window = VARIETY_WINDOW): number {
  return history
    .filter((item) => !seriesKey || item.seriesKey !== seriesKey)
    .slice(0, window)
    .reduce((penalty, item, index) => penalty + (item.archetype === archetype ? (window - index) / window : 0), 0);
}
