/**
 * Multi-Candidate Planning (Rodada 2, Fatia 2, Prioridade 8) — antes de gastar com geração de
 * imagem, Bianca considera múltiplas alternativas de estrutura criativa REALMENTE diferentes
 * ("pensar três vezes barato, gerar uma vez caro"). Cada candidato é uma variação real do plano
 * base (`layoutFamily`/`visualDensity` diferentes, nunca cosmética) — nunca três imagens completas
 * geradas; só o vencedor (ver `pre-render-creative-score.ts`) chega ao renderer/Pedro.
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002.
 */

import { CREATIVE_CANDIDATE_IDS, LAYOUT_FAMILIES, type CreativeCandidateId, type LayoutFamily, type PerformanceCreativePlan } from "./ad-layout.types.js";
import { LAYOUT_FAMILY_RULES, resolveCompatibleDensity, type LayoutFamilySelectionInput } from "./layout-family-rules.js";

export type { CreativeCandidateId } from "./ad-layout.types.js";

export type CreativeCandidatePlan = {
  id: CreativeCandidateId;
  layoutFamily: LayoutFamily;
  /** Pontuação de adequação da família aos sinais detectados (`LayoutFamilyRule.selectionScore`)
   * — maior é melhor; usado como insumo do Pre-Render Score (Prioridade 9), nunca recalculado lá. */
  familyFitScore: number;
  /** Explica em uma frase o que torna este candidato uma decisão criativa DISTINTA dos outros
   * dois — nunca "mesma família, 10px de diferença". */
  rationale: string;
  /** Plano completo desta variação — mesmos fatos comerciais do plano base (nunca inventa fato
   * novo), só `layoutFamily`/`visualDensity` mudam. Quem gera o `AdLayoutSpec` a partir disto é
   * quem já sabe montar zonas (`buildAdLayoutSpec`, na Skill da Bianca) — este módulo não conhece
   * zonas, só estrutura de plano. */
  plan: PerformanceCreativePlan;
};

/** Ranking determinístico de TODAS as famílias por adequação aos sinais detectados — desempate
 * pela ordem de declaração em `LAYOUT_FAMILIES` (nunca aleatório, sempre reproduzível). Usado para
 * escolher os 3 candidatos como as 3 famílias que MELHOR se encaixam no que foi detectado, cada
 * uma representando uma decisão de composição genuinamente diferente (zonas permitidas, prioridade
 * padrão e compatibilidade de densidade mudam por família — nunca é o mesmo layout com 10px de
 * diferença). */
function rankLayoutFamilies(input: LayoutFamilySelectionInput): Array<{ family: LayoutFamily; score: number }> {
  return LAYOUT_FAMILIES
    .map((family) => ({ family, score: LAYOUT_FAMILY_RULES[family].selectionScore(input) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return LAYOUT_FAMILIES.indexOf(a.family) - LAYOUT_FAMILIES.indexOf(b.family);
    });
}

function describeCandidateRationale(family: LayoutFamily, density: string, rank: number): string {
  const rule = LAYOUT_FAMILY_RULES[family];
  const positionLabel = rank === 0 ? "melhor encaixe para os sinais detectados" : rank === 1 ? "segunda alternativa estrutural mais forte" : "terceira alternativa estrutural mais forte";
  return `Família "${family}" (${positionLabel}), densidade "${density}", zonas permitidas: ${rule.allowedZoneTypes.join(", ")}.`;
}

/**
 * Gera até 3 candidatos criativos REAIS a partir do plano base — cada um usando uma família de
 * layout distinta (as 3 melhores por `selectionScore`), com a densidade compatível mais próxima da
 * preferida no plano base. Como cada família tem seu próprio `allowedZoneTypes`/
 * `defaultZonePriority`/`densityCompatibility`, os 3 candidatos produzem estruturas REALMENTE
 * diferentes (zonas presentes, hierarquia de prioridade, se o produto vira protagonista de fundo
 * ou não) — nunca a mesma composição com uma diferença cosmética.
 */
export function generateCreativeCandidates(basePlan: PerformanceCreativePlan, selectionInput: LayoutFamilySelectionInput): CreativeCandidatePlan[] {
  const ranked = rankLayoutFamilies(selectionInput);
  const top = ranked.slice(0, CREATIVE_CANDIDATE_IDS.length);

  return top.map((entry, index) => {
    const visualDensity = resolveCompatibleDensity(entry.family, basePlan.visualDensity);
    return {
      id: CREATIVE_CANDIDATE_IDS[index],
      layoutFamily: entry.family,
      familyFitScore: entry.score,
      rationale: describeCandidateRationale(entry.family, visualDensity, index),
      plan: { ...basePlan, layoutFamily: entry.family, visualDensity },
    };
  });
}

/**
 * Diversidade real entre os candidatos — nunca aceita "mesma família com 10px de diferença" nem
 * "mesmo layout com elementos trocados". Compara par a par: família (peso maior — é a decisão
 * estrutural mais forte), densidade, e o conjunto de tipos de zona permitidos (distância de
 * Jaccard — quanto mais os conjuntos de zonas divergem, mais as peças finais vão parecer
 * diferentes na prática). Score 0-100; `insufficientPairs` lista os pares que não atingiram o
 * mínimo de diferenciação estrutural (família OU zonas precisam divergir de verdade).
 */
export type CandidateDiversityResult = {
  score: number;
  insufficientPairs: Array<{ a: CreativeCandidateId; b: CreativeCandidateId; reason: string }>;
};

function zoneTypeSet(family: LayoutFamily): Set<string> {
  return new Set(LAYOUT_FAMILY_RULES[family].allowedZoneTypes);
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersectionSize = 0;
  for (const value of a) if (b.has(value)) intersectionSize += 1;
  return 1 - intersectionSize / union.size;
}

export function computeCandidateDiversity(candidates: CreativeCandidatePlan[]): CandidateDiversityResult {
  const insufficientPairs: CandidateDiversityResult["insufficientPairs"] = [];
  const pairScores: number[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const sameFamily = a.layoutFamily === b.layoutFamily;
      const zoneDistance = jaccardDistance(zoneTypeSet(a.layoutFamily), zoneTypeSet(b.layoutFamily));
      const densityDistance = a.plan.visualDensity === b.plan.visualDensity ? 0 : 1;
      // Família igual pesa muito mais que densidade — dois candidatos da MESMA família nunca
      // representam decisões criativas distintas, mesmo que a densidade mude.
      const pairScore = sameFamily ? zoneDistance * 20 : 60 + zoneDistance * 30 + densityDistance * 10;
      pairScores.push(Math.min(100, pairScore));
      if (sameFamily) {
        insufficientPairs.push({ a: a.id, b: b.id, reason: `Candidatos ${a.id} e ${b.id} usam a mesma família de layout ("${a.layoutFamily}") — não representam decisões criativas distintas.` });
      } else if (zoneDistance < 0.15) {
        insufficientPairs.push({ a: a.id, b: b.id, reason: `Candidatos ${a.id} e ${b.id} têm famílias diferentes mas conjuntos de zonas quase idênticos (distância ${zoneDistance.toFixed(2)}).` });
      }
    }
  }

  const score = pairScores.length > 0 ? Math.round(pairScores.reduce((sum, value) => sum + value, 0) / pairScores.length) : 0;
  return { score, insufficientPairs };
}
