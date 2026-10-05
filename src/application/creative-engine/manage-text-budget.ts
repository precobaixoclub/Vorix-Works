import type { CreativePlan, CreativePlanAssetPlacement, CreativePlanTextZone, CreativePlanTextZoneKind } from "../../shared/utils/gpt-creative-plan.types.js";
import { textsMatchApproximately } from "./resolve-actual-safe-area.js";

/**
 * ETAPA 3.3 (Rodada 4, Creative Engine) — "VISUAL TEXT BUDGET" (brief, pontos 7-13). Achado da
 * ETAPA 3.2: um layout denso (headline+subheadline+CTA+preço+logo) pode simplesmente não caber de
 * forma elegante — forçar tudo a existir ao mesmo tempo produz zonas empilhadas em `card_fallback`
 * ou sobrepondo um asset real, sem nenhuma região candidata livre sobrando. Em vez de só detectar
 * isso (o gate já fazia), esta lógica classifica cada zona de texto como OBRIGATÓRIA ou OPCIONAL e,
 * quando o canvas está congestionado, descarta conteúdo OPCIONAL primeiro — nunca
 * `requiredRenderedFacts`, nunca headline, nunca um CTA que a peça de fato tem.
 *
 * Deliberadamente simples (brief, ponto 8: "não transformar isso em dezenas de regras") — lógica
 * PURA e determinística, mesmo princípio de `resolve-actual-safe-area.ts`: nenhuma chamada de IA
 * aqui, só decide a partir de dados que já existem (o plano, a geometria real pós-composição).
 */

/** Headline é sempre obrigatório (a peça inteira gira em torno dele). CTA é obrigatório só quando
 * a peça de fato tem um (`cta: ""` já é uma decisão válida de "sem CTA", ver `parseCreativePlan`)
 * — uma zona de CTA com texto vazio nunca deveria existir, mas por segurança trata como opcional
 * se isso acontecer. Qualquer outra zona (subheadline/preço/desconto/url/badge) só é obrigatória
 * quando seu texto corresponde a um `requiredRenderedFacts` — o único sinal que o PRÓPRIO plano já
 * declarou como "esta peça não existe sem isto" (brief, ponto 9: "nunca remover
 * requiredRenderedFacts — se for preciso escolher entre subheadline e um preço obrigatório,
 * descarte o subheadline"). */
export function isTextZoneRequired(
  zone: Pick<CreativePlanTextZone, "kind" | "text">,
  plan: Pick<CreativePlan, "requiredRenderedFacts">,
): boolean {
  if (zone.kind === "headline") return true;
  if (zone.kind === "cta") return zone.text.trim() !== "";
  return plan.requiredRenderedFacts.some((fact) => textsMatchApproximately(fact, zone.text));
}

/** Ordem de descarte entre zonas OPCIONAIS, menos crítico primeiro (brief, ponto 10 — prioridade
 * conceitual 6.subheadline > 7.badge > 8.url, ou seja, url é o MENOS crítico e sai primeiro).
 * `discount` não está na lista numerada do brief; entra entre badge e subheadline por ser, na
 * prática, quase sempre reforço visual de um `price` já coberto por `requiredRenderedFacts` quando
 * é o motivo real da peça existir. */
const OPTIONAL_DROP_ORDER: readonly CreativePlanTextZoneKind[] = ["url", "badge", "discount", "subheadline"];

const OVERDENSE_ELEMENT_COUNT_THRESHOLD = 5;
const OVERDENSE_AREA_FRACTION_THRESHOLD = 0.6;

function sumRectAreaFraction(rects: readonly { widthPct: number; heightPct: number }[]): number {
  return rects.reduce((sum, rect) => sum + (rect.widthPct / 100) * (rect.heightPct / 100), 0);
}

/**
 * Dois sinais deliberadamente simples (brief, ponto 8) — nunca um cálculo geométrico exato de
 * colisão (isso já existe, com custo de IA, em `evaluate-creative-quality-gate.ts`): (1) contagem
 * de elementos — o próprio cenário nomeado no brief (headline+subheadline+CTA+preço+logo = 5) já
 * bate o limiar; (2) soma bruta de área ocupada (texto + assets), como proxy de quão cheio o
 * canvas está — serve tanto ANTES de qualquer geração real existir (preflight, só a geometria
 * declarada no plano) quanto DEPOIS da composição real (pós-geração, geometria já ajustada).
 */
export function isLayoutOverdense(
  textZones: readonly CreativePlanTextZone[],
  assetPlacements: readonly CreativePlanAssetPlacement[],
): boolean {
  const elementCount = textZones.length + assetPlacements.length;
  if (elementCount >= OVERDENSE_ELEMENT_COUNT_THRESHOLD) return true;
  const areaFraction = sumRectAreaFraction(textZones.map((zone) => zone.rect)) + sumRectAreaFraction(assetPlacements.map((placement) => placement.rect));
  return areaFraction > OVERDENSE_AREA_FRACTION_THRESHOLD;
}

/** Descarta zonas OPCIONAIS, uma de cada vez na ordem de `OPTIONAL_DROP_ORDER`, só enquanto o
 * layout continuar denso — para assim que `isLayoutOverdense` virar `false`, nunca descarta a mais
 * do que o necessário. Zonas obrigatórias (`isTextZoneRequired`) nunca são candidatas, mesmo que o
 * layout continue denso depois de esgotar as opcionais disponíveis (esse caso residual é reportado
 * pelo chamador, nunca escondido aqui). */
export function simplifyOverdenseTextZones(
  textZones: readonly CreativePlanTextZone[],
  plan: Pick<CreativePlan, "requiredRenderedFacts">,
  assetPlacements: readonly CreativePlanAssetPlacement[],
): { zones: CreativePlanTextZone[]; droppedZones: CreativePlanTextZone[] } {
  let current = [...textZones];
  const droppedZones: CreativePlanTextZone[] = [];
  for (const kind of OPTIONAL_DROP_ORDER) {
    if (!isLayoutOverdense(current, assetPlacements)) break;
    const candidate = current.find((zone) => zone.kind === kind && !isTextZoneRequired(zone, plan));
    if (!candidate) continue;
    droppedZones.push(candidate);
    current = current.filter((zone) => zone !== candidate);
  }
  return { zones: current, droppedZones };
}

/**
 * Preflight (brief, ponto 11) — chamado ANTES de gerar a imagem, sobre a geometria DECLARADA do
 * plano (nunca dados reais de pixel, que ainda não existem nesse ponto) — nunca gasta uma geração
 * de imagem só para descobrir uma geometria que o próprio plano já mostra ser inviável. Também
 * mantém `allowedRenderedTexts`/`subheadline` coerentes com o que de fato vai ser desenhado: uma
 * zona descartada cujo texto continuasse em `allowedRenderedTexts` reprovaria depois por
 * `MISSING_REQUIRED_TEXT`/reverificação global — um bug pior que o problema original.
 */
export function applyTextBudgetSimplification(plan: CreativePlan): { plan: CreativePlan; droppedZones: CreativePlanTextZone[] } {
  const { zones, droppedZones } = simplifyOverdenseTextZones(plan.textZones, plan, plan.assetPlacements);
  if (droppedZones.length === 0) return { plan, droppedZones: [] };
  const droppedTexts = new Set(droppedZones.map((zone) => zone.text));
  return {
    plan: {
      ...plan,
      textZones: zones,
      allowedRenderedTexts: plan.allowedRenderedTexts.filter((text) => !droppedTexts.has(text)),
      // `subheadline` é um campo-eco de conveniência (usado por `buildImageGenerationPromptFromPlan`
      // para decidir se instrui o modelo a desenhar algo) — some junto da zona correspondente,
      // nunca fica "órfão" pedindo pro modelo desenhar um texto que o renderer não vai mais tratar.
      subheadline: droppedZones.some((zone) => zone.kind === "subheadline") ? undefined : plan.subheadline,
    },
    droppedZones,
  };
}

/** Sinal de "card_fallback virando solução pra tudo" (brief, ponto 16/19): 2+ zonas de texto que
 * continuam sobrepondo um asset/outra zona mesmo DEPOIS da realocação geométrica real (nenhuma
 * região candidata genuinamente livre) é um sintoma de excesso de conteúdo, não um defeito pontual
 * de posição — simplificar resolve onde reposicionar não teria como. */
export const OVERDENSE_OVERLAP_COUNT_THRESHOLD = 2;

/**
 * Degradação PÓS-geometria real (brief, ponto 12) — roda depois de `applySafeAreaAdjustments`
 * (realocação com dados reais de visão/pixel), nunca antes. Só descarta zonas que estão DE FATO no
 * conjunto de sobreposição não resolvida reportado pelo chamador (nunca uma zona que já
 * relocalizou com sucesso) e que são OPCIONAIS — uma zona obrigatória presa em sobreposição
 * continua sobrepondo (o gate técnico, com a geometria final, reprova isso normalmente via
 * `TEXT_ZONE_OVERLAPS_ASSET`/`TEXT_ZONE_OVERLAPS_TEXT_ZONE`/`OVERDENSE_LAYOUT`).
 */
export function degradeOptionalZonesOnUnresolvedOverlap(
  textZones: readonly CreativePlanTextZone[],
  plan: Pick<CreativePlan, "requiredRenderedFacts">,
  unresolvedOverlapKinds: readonly string[],
): { zones: CreativePlanTextZone[]; droppedZones: CreativePlanTextZone[]; overdenseLayoutDetected: boolean } {
  const overdenseLayoutDetected = unresolvedOverlapKinds.length >= OVERDENSE_OVERLAP_COUNT_THRESHOLD;
  if (!overdenseLayoutDetected) return { zones: [...textZones], droppedZones: [], overdenseLayoutDetected: false };

  let current = [...textZones];
  const droppedZones: CreativePlanTextZone[] = [];
  for (const kind of OPTIONAL_DROP_ORDER) {
    const candidate = current.find((zone) => zone.kind === kind && unresolvedOverlapKinds.includes(zone.kind) && !isTextZoneRequired(zone, plan));
    if (!candidate) continue;
    droppedZones.push(candidate);
    current = current.filter((zone) => zone !== candidate);
  }
  return { zones: current, droppedZones, overdenseLayoutDetected: true };
}
