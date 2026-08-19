import type { AdLayoutZone, AdLayoutZonePosition } from "./ad-layout.types.js";

/**
 * Colisão/reflow de zonas (Rodada 2, Fatia 2, Bloco 0.2) — achado ao vivo: `DEFAULT_ZONE_POSITIONS`
 * (`bianca-social-media-design.skill.ts`) tem sobreposição geométrica real entre headline e a
 * coluna de badge/rating/salesProof (badge começa em xPct 68%, dentro da largura nominal de 88%
 * do headline) — invisível quando o texto do headline é curto, mas colide de verdade quando o
 * texto ocupa a largura inteira. Nunca resolvido reduzindo fonte até caber (isso violaria o
 * mínimo de legibilidade que o próprio quality gate de tipografia do Lucas exige) — em vez disso,
 * detecta sobreposição geométrica real entre as zonas finais e aplica reflow determinístico
 * (encolhe/reposiciona), preservando o tamanho de fonte.
 */

const GAP_PCT = 2;
const MIN_ZONE_WIDTH_PCT = 15;
const MIN_ZONE_HEIGHT_PCT = 6;

export function rectanglesOverlap(a: AdLayoutZonePosition, b: AdLayoutZonePosition): boolean {
  return a.xPct < b.xPct + b.widthPct && a.xPct + a.widthPct > b.xPct && a.yPct < b.yPct + b.heightPct && a.yPct + a.heightPct > b.yPct;
}

function zoneArea(position: AdLayoutZonePosition): number {
  return position.widthPct * position.heightPct;
}

/**
 * Encolhe/reposiciona `moving` pra parar de sobrepor `fixed` — nunca mexe em `fixed`. Decide o
 * eixo de corte comparando o deslocamento de POSIÇÃO entre as duas zonas (não a forma do
 * retângulo de sobreposição, que não distingue de forma confiável "lado a lado" de "empilhado" —
 * ex.: duas zonas empilhadas com a mesma largura produzem uma sobreposição mais larga que alta,
 * igual duas zonas lado a lado). Deslocamento horizontal grande (`xOffset >= yOffset`) = zonas
 * pensadas lado a lado (ex.: headline x badge, mesmo yPct) → corta LARGURA, preserva altura
 * (nº de linhas de texto intacto). Deslocamento vertical maior = zonas pensadas empilhadas → corta
 * altura, preserva largura.
 */
function shrinkToAvoidOverlap(moving: AdLayoutZonePosition, fixed: AdLayoutZonePosition): AdLayoutZonePosition {
  const xOffset = Math.abs(moving.xPct - fixed.xPct);
  const yOffset = Math.abs(moving.yPct - fixed.yPct);
  const treatAsHorizontal = xOffset >= yOffset;

  if (treatAsHorizontal) {
    if (fixed.xPct >= moving.xPct) {
      const newWidth = Math.max(MIN_ZONE_WIDTH_PCT, fixed.xPct - moving.xPct - GAP_PCT);
      return { ...moving, widthPct: newWidth };
    }
    const newX = fixed.xPct + fixed.widthPct + GAP_PCT;
    const newWidth = Math.max(MIN_ZONE_WIDTH_PCT, moving.xPct + moving.widthPct - newX);
    return { ...moving, xPct: newX, widthPct: newWidth };
  }

  if (fixed.yPct >= moving.yPct) {
    const newHeight = Math.max(MIN_ZONE_HEIGHT_PCT, fixed.yPct - moving.yPct - GAP_PCT);
    return { ...moving, heightPct: newHeight };
  }
  const newY = fixed.yPct + fixed.heightPct + GAP_PCT;
  const newHeight = Math.max(MIN_ZONE_HEIGHT_PCT, moving.yPct + moving.heightPct - newY);
  return { ...moving, yPct: newY, heightPct: newHeight };
}

/**
 * Detecta e resolve toda sobreposição geométrica real entre as zonas finais de um `AdLayoutSpec`.
 * Regra: entre duas zonas que colidem, a de MAIOR área cede espaço pra de MENOR área (ex.: o
 * headline, largo, encolhe a largura pra não invadir o badge, compacto — nunca o contrário, já
 * que zonas pequenas costumam já ser o tamanho mínimo confortável, como um selo de urgência).
 * Determinístico, sem IA, sem reduzir fonte — só geometria. Zonas que não colidem com nada saem
 * inalteradas.
 */
export function resolveZoneCollisions(zones: AdLayoutZone[]): AdLayoutZone[] {
  const result = zones.map((zone) => ({ ...zone, position: { ...zone.position } }));

  for (let i = 0; i < result.length; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      if (i === j) continue;
      const a = result[i];
      const b = result[j];
      if (!rectanglesOverlap(a.position, b.position)) continue;

      const areaA = zoneArea(a.position);
      const areaB = zoneArea(b.position);
      if (areaA >= areaB) {
        result[i] = { ...a, position: shrinkToAvoidOverlap(a.position, b.position) };
      }
    }
  }

  return result;
}
