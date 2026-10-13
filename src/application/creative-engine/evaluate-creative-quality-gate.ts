import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanRect } from "../../shared/utils/gpt-creative-plan.types.js";
import { resolveEditorialBrandLiterals } from "../../shared/utils/gpt-creative-plan.types.js";
import { COMMERCIAL_FACT_TYPE_LABELS_PT, extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";
import { matchScreenshotInventoryText, type ScreenshotTextInventory } from "./screenshot-text-inventory.js";

/**
 * Quality gate do motor GPT — migração "GPT como motor criativo único" (PR 5/9), promovido de
 * `evaluate-gpt-prototype-quality-gate.ts` (protótipo isolado) com a lista completa de falhas
 * críticas pedida. DELIBERADAMENTE mais simples que o Quality Gate do motor legado
 * (`lucas-quality-review.skill.ts`, 10 dimensões de score) — só `pass`/`fail` + lista de motivos,
 * nunca um score que tenta substituir o julgamento criativo do GPT.
 */

export const CREATIVE_QUALITY_ISSUE_CODES = [
  "PRODUCT_MISMATCH",
  "WRONG_LOGO",
  "SCREENSHOT_MISCHARACTERIZED",
  "REQUIRED_ASSET_MISSING",
  "INVENTED_COMMERCIAL_FACT",
  "WRONG_PRICE",
  "TEXT_ILLEGIBLE_OR_CUT",
  "ELEMENT_CUT_OFF",
  "WRONG_ASPECT_RATIO",
  "CRITICAL_OVERLAP",
  "COMPOSITION_BROKEN",
  "NON_PUBLISHABLE_SOURCE",
  "PRODUCTION_GUIDELINES_VIOLATED",
  "COLOR_PALETTE_VIOLATED",
  "TEXT_ZONE_OVERLAPS_ASSET",
  "TEXT_ZONE_OVERLAPS_TEXT_ZONE",
  // Auditoria "motor de geração de criativos" — substituem `UNEXPECTED_DECORATIVE_TEXT` (removido):
  // aquele critério booleano não pegava de forma confiável casos reais óbvios. Comparação
  // determinística contra `allowedRenderedTexts`, ver `checkCreativeVisualIntegrity`.
  "UNAUTHORIZED_TEXT",
  "PLACEHOLDER_RENDERED",
  "MISSING_REQUIRED_TEXT",
  // Rodada 4 (benchmark de qualidade criativa) — achado confirmado: um preço com `textZone`
  // própria e presente em `allowedRenderedTexts` ainda assim saiu AUSENTE da imagem final, e
  // `MISSING_REQUIRED_TEXT` (que trata todo texto autorizado com peso igual) não reprovou. Código
  // dedicado, sempre hard failure, nunca `renderer_reflow`-elegível (a causa pode ser geométrica OU
  // de conceito — só uma nova decisão resolve com segurança) — ver `checkCreativeVisualIntegrity`.
  "REQUIRED_FACT_MISSING",
  // ETAPA 3/3.1 (Rodada 4) — refinamento de `UNAUTHORIZED_TEXT`: texto fantasma (o modelo desenhou
  // sozinho ANTECIPANDO o conteúdo de uma zona do renderer) é detectado e CLASSIFICADO como
  // `"ghost_text"` na análise pré-composição (`analyze-pre-composition-image.ts`), e tratado ANTES
  // do gate rodar — `neutralize-ghost-text.ts` aplica blur+véu adaptativos e CONFIRMA via
  // reverificação de visão (só da região tratada) que o texto realmente sumiu, escalando a
  // intensidade até 2 vezes antes de desistir (ver `UNRECOVERABLE_GHOST_TEXT` abaixo). Nada disso
  // consome uma rodada de reparo — é tratamento de composição, não reparo. Mesmo com a
  // reverificação, um caso residual AINDA pode escapar (a reverificação olha só o recorte, o gate
  // final olha a peça inteira já composta) — o sintoma observável nesse caso residual é o MESMO
  // texto aparecendo duas vezes — `DUPLICATED_TEXT` cobre isso, defesa em profundidade.
  "DUPLICATED_TEXT",
  // ETAPA 3.1 (Rodada 4) — achado do smoke real: blur+véu locais às vezes não bastam pra esconder
  // um texto fantasma de alto contraste, mesmo depois de 2 passes escalados. Quando a
  // reverificação de `neutralize-ghost-text.ts` ainda confirma texto legível após o máximo de
  // passes, a zona é classificada como `UNRECOVERABLE_GHOST_TEXT` ANTES mesmo de compor
  // logo/screenshot/texto — nenhum tratamento local a mais resolveria, só uma nova geração
  // completa (`full_regen_required`, ver `classifyRepairStrategy`, `creative-repair.ts`).
  "UNRECOVERABLE_GHOST_TEXT",
  // ETAPA 3.3 (Rodada 4) — achado do smoke real da ETAPA 3.2: a reverificação global (peça
  // inteira, depois de TODAS as regiões detectadas já tratadas) às vezes ainda encontrava texto
  // residual, sem nenhuma chance de agir sobre ele (só um booleano). Desde a ETAPA 3.3, um achado
  // residual COM localização é tratado numa única rodada extra (`run-gpt-creative-engine.ts`) antes
  // de desistir — `UNRECOVERABLE_GLOBAL_TEXT` só acontece se, mesmo depois desse passe residual (ou
  // sem bbox nenhuma pra agir), a reverificação final ainda encontra texto não resolvido.
  "UNRECOVERABLE_GLOBAL_TEXT",
  // ETAPA 3.3 (Rodada 4) — "VISUAL TEXT BUDGET" (ver `manage-text-budget.ts`): antes de reprovar
  // por uma simples colisão geométrica, o motor já tenta descartar conteúdo OPCIONAL (brief, ponto
  // 16). Quando isso não é suficiente — ainda sobra sobreposição real E o número de elementos já é
  // alto — o problema de fundo não é "reposicionar um retângulo", é excesso de conteúdo para o
  // formato. Código deliberadamente distinto de `TEXT_ZONE_OVERLAPS_ASSET`/
  // `TEXT_ZONE_OVERLAPS_TEXT_ZONE` (que continuam disparando junto, nunca substituídos) — dá ao
  // diretor uma instrução mais específica ("simplifique", não só "mova").
  "OVERDENSE_LAYOUT",
  // ETAPA 3 (Rodada 4) — o benchmark mostrou um screenshot real colado sobre uma cena que o
  // modelo já tinha desenhado como uma interface fictícia completa e desalinhada. A defesa
  // pré-composição intercepta a maioria dos casos antes mesmo de compor (ver
  // `run-gpt-creative-engine.ts`, checagem de `screenshotSlotLooksFake`); este código cobre o caso
  // em que isso só fica claro depois da composição final (ex.: o screenshot real colado por cima
  // ainda assim não combina com o que o modelo desenhou ao redor).
  "SCREENSHOT_SLOT_MISMATCH",
  // ETAPA 3 (Rodada 4) — distinto de `ELEMENT_CUT_OFF` (elemento cortado na BORDA do canvas):
  // aqui o elemento crítico (produto, logo, screenshot) está inteiro dentro do canvas, mas
  // COBERTO por outro elemento (ex.: um badge/CTA desenhado por cima do rosto do produto).
  "CRITICAL_ASSET_OCCLUDED",
  // Novo: colisão geométrica de um assetPlacement (produto/screenshot) com a margem de segurança
  // do canvas — mesmo princípio de `checkSafeAreaCompliance`, agora cobrindo assets, não só texto.
  // (Auditoria: `LOGO_DISTORTED` NÃO foi adicionado — `logo-compositor.ts` já usa
  // `fit: "inside"` do sharp, que preserva proporção por construção; nunca estica. Nenhum código
  // novo resolveria um problema que não existe nesse caminho.)
  "CRITICAL_ASSET_CROP",
] as const;
export type CreativeQualityIssueCode = (typeof CREATIVE_QUALITY_ISSUE_CODES)[number];

export type CreativeQualityIssue = {
  code: CreativeQualityIssueCode;
  message: string;
  /** Detalhe estruturado e persistido (quais zonas/bboxes, quanto se sobrepõe, texto, origem e
   * adjudicação) — nunca mais só o código. */
  details?: Record<string, unknown>;
  /** Achado ao vivo em produção: `TEXT_ILLEGIBLE_OR_CUT`/`ELEMENT_CUT_OFF` podem vir de duas
   * origens bem diferentes — `checkSafeAreaCompliance` (determinístico, só sobre zonas de texto
   * já declaradas no plano, sempre sabe se a zona é `renderer` ou `image_model`) ou
   * `checkCreativeVisualIntegrity` (visão sobre a imagem final já pronta, nunca sabe QUEM
   * desenhou o trecho ilegível). `routeCreativeRepair` (`creative-repair.ts`) precisa dessa
   * distinção: só é seguro mandar pra `renderer_reflow` (que só re-renderiza zonas
   * `renderedBy: "renderer"` sobre a MESMA imagem já gerada, nunca toca o que o modelo de imagem
   * já pintou) quando a origem é `"safe_area"` — uma origem `"vision"` pode estar reportando um
   * problema de contraste/cor no que o modelo de imagem desenhou, que ajustar `fontScale` nunca
   * resolve; sem essa distinção, o reparo gastava 2 rodadas inteiras tentando uma correção que
   * não tinha como funcionar. */
  source?: "safe_area" | "vision";
};

export type CreativeAssetPixelEvidence = {
  role: CreativePlanAssetRole;
  visible: boolean;
  /** Fidelidade ao asset original (compositor editorial). Isenção de texto de logo exige `true`. */
  fidelityPass?: boolean;
  reason?: string;
};

/** Margem (em pontos percentuais) tolerada ao redor da logo verificada — a visão estima regiões. */
const VERIFIED_LOGO_REGION_TOLERANCE_PCT = 2.5;
const VERIFIED_LOGO_MIN_TEXT_AREA_INSIDE = 0.6;

/**
 * Regiões FINAIS de logos oficiais que podem isentar texto (achado do Smoke A
 * cer-runtime-muzle2ms-1wftsl: "Rumo ao Altar", o wordmark da logo oficial composta pelo renderer,
 * foi reprovado como UNAUTHORIZED_TEXT). Nunca uma whitelist de palavras — só geometria com
 * proveniência: a logo foi fornecida no contexto, foi composta pelo renderer, o placement é a
 * geometria final renderizada apontando para o MESMO asset do contexto, e a prova em pixel diz que
 * ela apareceu fiel ao original. Sem prova em pixel (motor padrão), nenhuma região é verificada.
 */
export function resolveVerifiedLogoRegions(input: {
  plan: Pick<CreativePlan, "assetPlacements">;
  context: Pick<CreativeContext, "assets">;
  compositedAssetRoles: readonly CreativePlanAssetRole[];
  assetPixelEvidence?: readonly CreativeAssetPixelEvidence[];
}): CreativePlanRect[] {
  if (!input.assetPixelEvidence || !input.compositedAssetRoles.includes("logo")) return [];
  const evidence = input.assetPixelEvidence.find((item) => item.role === "logo");
  if (!evidence?.visible || evidence.fidelityPass !== true) return [];
  const logoUrls = new Set(input.context.assets.filter((asset) => asset.role === "logo").map((asset) => asset.url));
  if (logoUrls.size === 0) return [];
  return input.plan.assetPlacements.filter((placement) => placement.role === "logo" && logoUrls.has(placement.url)).map((placement) => placement.rect);
}

/**
 * Mesma regra de proveniência para o screenshot REAL: a interface do cliente tem texto próprio
 * (menus, títulos, preços do site) que não é copy gerada. Só isenta dentro da bbox final do
 * screenshot composto pelo renderer, apontando para o MESMO asset do contexto, visível e fiel ao
 * original em pixel. Mesmo texto fora dessa bbox continua não autorizado.
 */
/**
 * Regiões FINAIS do produto real (foto do cliente) composto pelo renderer, visível e fiel em pixel ao
 * original. Texto IMPRESSO no próprio produto (rótulo, embalagem) lido pela visão dentro dessa região é
 * do produto — preservado, nunca promovido a claim/fato comercial (fatos vêm só da copy do plano).
 */
export function resolveVerifiedProductRegions(input: {
  plan: Pick<CreativePlan, "assetPlacements">;
  context: Pick<CreativeContext, "assets">;
  compositedAssetRoles: readonly CreativePlanAssetRole[];
  assetPixelEvidence?: readonly CreativeAssetPixelEvidence[];
}): CreativePlanRect[] {
  if (!input.assetPixelEvidence || !input.compositedAssetRoles.includes("product_photo")) return [];
  const evidence = input.assetPixelEvidence.find((item) => item.role === "product_photo");
  if (!evidence?.visible || evidence.fidelityPass !== true) return [];
  const urls = new Set(input.context.assets.filter((asset) => asset.role === "product_photo").map((asset) => asset.url));
  if (urls.size === 0) return [];
  return input.plan.assetPlacements.filter((placement) => placement.role === "product_photo" && urls.has(placement.url)).map((placement) => placement.rect);
}

export function resolveVerifiedScreenshotRegions(input: {
  plan: Pick<CreativePlan, "assetPlacements">;
  context: Pick<CreativeContext, "assets">;
  compositedAssetRoles: readonly CreativePlanAssetRole[];
  assetPixelEvidence?: readonly CreativeAssetPixelEvidence[];
}): CreativePlanRect[] {
  if (!input.assetPixelEvidence || !input.compositedAssetRoles.includes("screenshot")) return [];
  const evidence = input.assetPixelEvidence.find((item) => item.role === "screenshot");
  if (!evidence?.visible || evidence.fidelityPass !== true) return [];
  const urls = new Set(input.context.assets.filter((asset) => asset.role === "screenshot").map((asset) => asset.url));
  if (urls.size === 0) return [];
  return input.plan.assetPlacements.filter((placement) => placement.role === "screenshot" && urls.has(placement.url)).map((placement) => placement.rect);
}

/** Inventário de texto do screenshot que o gate PODE usar nesta peça (ver `screenshot-text-inventory.ts`). */
export type UsableScreenshotInventory = Pick<ScreenshotTextInventory, "assetSha256" | "assetUrl" | "texts">;

/**
 * O inventário só autoriza texto quando TODAS valem: leitura AVAILABLE; screenshot composto,
 * visível e fiel em pixel (regiões verificadas não vazias — fidelity PASS); o inventário é do MESMO
 * asset do contexto; e do MESMO tenant/workspace da execução (nunca de outro workspace). Senão o
 * gate fica só com a regra espacial da região verificada.
 */
export function resolveUsableScreenshotInventory(input: {
  inventory?: ScreenshotTextInventory;
  ownership?: { tenantId: string; workspaceId: string };
  context: Pick<CreativeContext, "assets">;
  verifiedScreenshotRegions: readonly CreativePlanRect[];
}): { usable?: UsableScreenshotInventory; status: "USED" | "NOT_USED" | "ABSENT"; reason: string } {
  const inventory = input.inventory;
  if (!inventory) return { status: "ABSENT", reason: "sem inventário de texto do screenshot" };
  if (inventory.status !== "AVAILABLE") return { status: "NOT_USED", reason: `inventário indisponível: ${inventory.reason ?? "NOT_AVAILABLE"}` };
  if (input.verifiedScreenshotRegions.length === 0) return { status: "NOT_USED", reason: "screenshot sem fidelidade comprovada (ausente, invisível, substituído ou corrompido) — inventário não autoriza" };
  if (!input.ownership || inventory.tenantId !== input.ownership.tenantId || inventory.workspaceId !== input.ownership.workspaceId) {
    return { status: "NOT_USED", reason: "inventário de outro tenant/workspace — nunca reutilizado" };
  }
  if (!input.context.assets.some((asset) => asset.role === "screenshot" && asset.url === inventory.assetUrl)) return { status: "NOT_USED", reason: "inventário não pertence ao screenshot desta peça" };
  return { usable: { assetSha256: inventory.assetSha256, assetUrl: inventory.assetUrl, texts: inventory.texts }, status: "USED", reason: `inventário do screenshot verificado (sha256 ${inventory.assetSha256.slice(0, 12)}…, ${inventory.texts.length} texto(s))` };
}

/**
 * Inventário de texto da LOGO oficial (ver `screenshot-text-inventory.ts`, kind "logo") que o gate
 * PODE usar: leitura AVAILABLE da logo; logo composta, visível e fiel em pixel (regiões verificadas não
 * vazias); o inventário é de uma logo EFETIVAMENTE desenhada nesta peça (placement final) e do
 * contexto; e do MESMO tenant/workspace. Vários arquivos de logo desenhados somam seus textos.
 */
export function resolveUsableLogoInventory(input: {
  inventories?: readonly ScreenshotTextInventory[];
  ownership?: { tenantId: string; workspaceId: string };
  context: Pick<CreativeContext, "assets">;
  plan: Pick<CreativePlan, "assetPlacements">;
  verifiedLogoRegions: readonly CreativePlanRect[];
}): { usable?: UsableScreenshotInventory; status: "USED" | "NOT_USED" | "ABSENT"; reason: string } {
  const inventories = input.inventories ?? [];
  if (inventories.length === 0) return { status: "ABSENT", reason: "sem inventário de texto da logo" };
  if (input.verifiedLogoRegions.length === 0) return { status: "NOT_USED", reason: "logo sem fidelidade comprovada (ausente, invisível ou substituída) — inventário não autoriza" };
  const drawn = new Set(input.plan.assetPlacements.filter((placement) => placement.role === "logo").map((placement) => placement.url));
  const contextLogos = new Set(input.context.assets.filter((asset) => asset.role === "logo").map((asset) => asset.url));
  const usable = inventories.filter((inventory) =>
    inventory.status === "AVAILABLE"
    && inventory.source === "VERIFIED_LOGO"
    && input.ownership !== undefined
    && inventory.tenantId === input.ownership.tenantId
    && inventory.workspaceId === input.ownership.workspaceId
    && drawn.has(inventory.assetUrl)
    && contextLogos.has(inventory.assetUrl));
  if (usable.length === 0) return { status: "NOT_USED", reason: "nenhum inventário de logo desenhada nesta peça, do mesmo tenant/workspace e disponível" };
  const texts = usable.flatMap((inventory) => inventory.texts);
  return {
    usable: { assetSha256: usable.map((inventory) => inventory.assetSha256).join(","), assetUrl: usable[0]!.assetUrl, texts },
    status: "USED",
    reason: `inventário da logo verificada (${usable.map((inventory) => `sha256 ${inventory.assetSha256.slice(0, 12)}…`).join(", ")}; ${texts.length} texto(s))`,
  };
}

function baseScanContains(ledger: TextProvenanceLedger | undefined, normalizedText: string): boolean {
  return Boolean(ledger && ledger.baseTextStatus === "AVAILABLE" && ledger.entries.some((entry) => entry.sourceType === "BASE_IMAGE" && entry.normalizedText !== undefined && (entry.normalizedText.includes(normalizedText) || (entry.normalizedText.length >= 3 && normalizedText.includes(entry.normalizedText)))));
}

function intersectionArea(a: CreativePlanRect, b: CreativePlanRect): number {
  const width = Math.min(a.xPct + a.widthPct, b.xPct + b.widthPct) - Math.max(a.xPct, b.xPct);
  const height = Math.min(a.yPct + a.heightPct, b.yPct + b.heightPct) - Math.max(a.yPct, b.yPct);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Texto pertence à logo verificada quando seu centro está dentro da logo (com tolerância) e a
 * maior parte da sua área também. */
export function isTextRegionInsideVerifiedLogo(region: CreativePlanRect, logoRegions: readonly CreativePlanRect[]): boolean {
  const area = region.widthPct * region.heightPct;
  if (!(area > 0)) return false;
  const centerX = region.xPct + region.widthPct / 2;
  const centerY = region.yPct + region.heightPct / 2;
  return logoRegions.some((logo) => {
    const expanded = {
      xPct: logo.xPct - VERIFIED_LOGO_REGION_TOLERANCE_PCT,
      yPct: logo.yPct - VERIFIED_LOGO_REGION_TOLERANCE_PCT,
      widthPct: logo.widthPct + VERIFIED_LOGO_REGION_TOLERANCE_PCT * 2,
      heightPct: logo.heightPct + VERIFIED_LOGO_REGION_TOLERANCE_PCT * 2,
    };
    const centerInside = centerX >= expanded.xPct && centerX <= expanded.xPct + expanded.widthPct && centerY >= expanded.yPct && centerY <= expanded.yPct + expanded.heightPct;
    return centerInside && intersectionArea(region, expanded) / area >= VERIFIED_LOGO_MIN_TEXT_AREA_INSIDE;
  });
}

/**
 * Equivalência textual do gate: Unicode NFC, caixa, espaços, aspas e pontuação simples de fim de
 * palavra. NUNCA remove acentos — "Conheca" continua diferente de "Conheça".
 */
export function normalizeRenderedText(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/[\u201C\u201D"\u2018\u2019'\u0060\u00B4]/g, "")
    .replace(/[.,;:!?\u2026]+(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Zona renderizada que autoriza o texto detectado: região dentro da bbox final da zona e texto
 * equivalente (inteiro ou trecho, ex.: "Rumo ao Altar" dentro do CTA "Conheça o Rumo ao Altar"). */
export function matchRenderedTextRegion(
  detected: { text: string; region?: CreativePlanRect },
  regions: readonly CreativeRenderedTextRegion[],
): CreativeRenderedTextRegion | undefined {
  if (!detected.region) return undefined;
  const normalized = normalizeRenderedText(detected.text);
  if (!normalized) return undefined;
  return regions.find((zone) => {
    const expected = normalizeRenderedText(zone.text);
    return (expected === normalized || expected.includes(normalized)) && isTextRegionInsideVerifiedLogo(detected.region!, [zone.rect]);
  });
}

/**
 * A bbox da visão é uma ESTIMATIVA; a do renderer é a verdade. Para texto desenhado pelo renderer,
 * a visão erra a posição em unidades da própria linha de texto (achado do cenário B
 * execution-mv03bie3-i7op5z: CTA lido certo, bbox ~1 altura de CTA acima). A tolerância é uma faixa
 * de UMA altura da própria zona em cada lado — proporcional ao elemento, nunca pixels absolutos —
 * e a detecção precisa ter o centro dentro dessa faixa e a maior parte da área nela.
 */
export const RENDERED_TEXT_JITTER_BAND_IN_HEIGHTS = 1;

/**
 * Resolução de localização da visão, em pontos percentuais do canvas. Medida nos runs reais B/C:
 * todas as bboxes devolvidas vêm numa grade de 5 pt (ex.: 70/85/20/5, 60/85/30/5, 5/85/20/5). Para
 * zonas mais baixas que essa grade (CTA de 2,7%), uma faixa de "uma altura" fica menor que o erro de
 * quantização do próprio sensor. Só é usada como piso da faixa quando a base foi escaneada e está
 * limpa — sem isso a faixa continua proporcional à zona.
 */
export const VISION_BBOX_RESOLUTION_PCT = 5;

export function measureRenderedTextProximity(detected: CreativePlanRect, expected: CreativePlanRect, minBand = 0): { overlap: number; insideBand: number; centerInBand: boolean; centerDistance: number; band: number; near: boolean } {
  const band = Math.max(expected.heightPct * RENDERED_TEXT_JITTER_BAND_IN_HEIGHTS, minBand);
  const expanded = { xPct: expected.xPct - band, yPct: expected.yPct - band, widthPct: expected.widthPct + 2 * band, heightPct: expected.heightPct + 2 * band };
  const area = detected.widthPct * detected.heightPct;
  const overlap = area > 0 ? intersectionArea(detected, expected) / area : 0;
  const insideBand = area > 0 ? intersectionArea(detected, expanded) / area : 0;
  const cx = detected.xPct + detected.widthPct / 2;
  const cy = detected.yPct + detected.heightPct / 2;
  const centerInBand = cx >= expanded.xPct && cx <= expanded.xPct + expanded.widthPct && cy >= expanded.yPct && cy <= expanded.yPct + expanded.heightPct;
  const centerDistance = Math.hypot(cx - (expected.xPct + expected.widthPct / 2), cy - (expected.yPct + expected.heightPct / 2));
  return {
    overlap: Number(overlap.toFixed(3)),
    insideBand: Number(insideBand.toFixed(3)),
    centerInBand,
    centerDistance: Number(centerDistance.toFixed(2)),
    band: Number(band.toFixed(3)),
    near: area > 0 && centerInBand && insideBand >= VERIFIED_LOGO_MIN_TEXT_AREA_INSIDE,
  };
}

/** Zona cujo texto INTEIRO é equivalente ao detectado, perto o bastante pela faixa de jitter. */
function matchRenderedTextWithinJitter(detected: { text: string; region?: CreativePlanRect }, regions: readonly CreativeRenderedTextRegion[]): CreativeRenderedTextRegion | undefined {
  if (!detected.region) return undefined;
  const normalized = normalizeRenderedText(detected.text);
  return regions.find((zone) => normalizeRenderedText(zone.text) === normalized && measureRenderedTextProximity(detected.region!, zone.rect).near);
}

export function buildTextProvenanceLedger(input: {
  plan: Pick<CreativePlan, "textZones" | "assetPlacements">;
  context: CreativeContext;
  renderedTextRegions?: readonly CreativeRenderedTextRegion[];
  verifiedLogoRegions: readonly CreativePlanRect[];
  verifiedScreenshotRegions: readonly CreativePlanRect[];
  baseText?: CreativeBaseTextEvidence;
  /** Só o inventário já validado (`resolveUsableScreenshotInventory`). */
  screenshotInventory?: UsableScreenshotInventory;
  /** Só o inventário já validado (`resolveUsableLogoInventory`). */
  logoInventory?: UsableScreenshotInventory;
}): TextProvenanceLedger {
  const entries: TextProvenanceEntry[] = [];
  const authorizedDomain = resolveAuthorizedSiteDomain(input.context);
  (input.renderedTextRegions ?? []).forEach((zone, index) => {
    const normalizedText = normalizeRenderedText(zone.text);
    if (zone.kind === "url" && authorizedDomain && normalizedText === normalizeRenderedText(authorizedDomain.domain)) {
      entries.push({
        sourceType: "VERIFIED_DOMAIN",
        sourceId: authorizedDomain.sourceId,
        sourceField: authorizedDomain.sourceField,
        normalizedText,
        role: "site",
        expectedBBox: zone.rect,
        deterministic: true,
        rendererAuthored: true,
        authorized: true,
        requirementSatisfied: "SITE_VISIBLE",
        assetProvenance: "final_rendered_geometry",
      });
      return;
    }
    entries.push({ sourceType: "RENDERER_TEXT", sourceId: `renderer:${zone.kind}:${index}`, normalizedText, role: zone.kind, expectedBBox: zone.rect, deterministic: true, assetProvenance: "final_rendered_geometry" });
  });
  const brandLiterals = [...new Set([...resolveEditorialBrandLiterals(input.context), ...(input.logoInventory?.texts ?? []).map((entry) => entry.normalizedText)].map((literal) => normalizeRenderedText(literal)).filter(Boolean))];
  input.verifiedLogoRegions.forEach((rect, index) => {
    entries.push({ sourceType: "LOGO_ASSET", sourceId: `logo:${index}`, ...(brandLiterals.length > 0 ? { alternatives: brandLiterals } : {}), role: "logo", expectedBBox: rect, deterministic: true, assetProvenance: "context_asset+pixel_verified" });
  });
  input.verifiedScreenshotRegions.forEach((rect, index) => {
    entries.push({ sourceType: "SCREENSHOT_ASSET", sourceId: `screenshot:${index}`, role: "screenshot", expectedBBox: rect, deterministic: true, assetProvenance: "context_asset+pixel_verified" });
  });
  (input.screenshotInventory?.texts ?? []).forEach((item, index) => {
    entries.push({ sourceType: "SCREENSHOT_TEXT_INVENTORY", sourceId: `screenshot-text:${index}`, normalizedText: item.normalizedText, occurrenceCount: item.occurrenceCount, role: "screenshot_text", deterministic: false, assetProvenance: `verified_screenshot_inventory:${input.screenshotInventory!.assetSha256}` });
  });
  input.plan.assetPlacements.filter((placement) => placement.role === "product_photo").forEach((placement, index) => {
    entries.push({ sourceType: "PRODUCT_ASSET", sourceId: `product:${index}`, role: "product_photo", expectedBBox: placement.rect, deterministic: true, assetProvenance: "context_asset" });
  });
  if (input.baseText?.status === "AVAILABLE") {
    input.baseText.texts.forEach((item, index) => {
      entries.push({ sourceType: "BASE_IMAGE", sourceId: `base:${index}`, normalizedText: item.normalizedText, role: "base_image", ...(item.bbox ? { expectedBBox: item.bbox } : {}), deterministic: false, assetProvenance: "openai_base_scan" });
    });
  }
  return { baseTextStatus: input.baseText?.status === "AVAILABLE" ? "AVAILABLE" : "NOT_AVAILABLE", entries };
}

/**
 * Contagem de ocorrências de um texto CONHECIDO reconciliada com o ledger (achado do cenário B
 * execution-mv0ayw83-a0iw8l: a visão "viu" 2× "Rumo ao Altar" em posições que não existem — as 2
 * ocorrências reais eram a logo e o CTA). Só com diagnóstico da base disponível (senão falha
 * fechada); texto presente na base nunca é absorvido; mais ocorrências do que origens explicáveis
 * continua duplicidade. Não é whitelist: texto sem origem no ledger nunca reconcilia.
 */
export function reconcileOccurrencesWithLedger(normalizedText: string, reportedCount: number, ledger: TextProvenanceLedger | undefined): { reconciled: boolean; reason: string; explainedBy: string[] } {
  if (!ledger || ledger.baseTextStatus !== "AVAILABLE") return { reconciled: false, reason: "sem diagnóstico de texto da base — ledger não reconcilia", explainedBy: [] };
  const baseHits = ledger.entries.filter((entry) => entry.sourceType === "BASE_IMAGE" && entry.normalizedText && (entry.normalizedText.includes(normalizedText) || (entry.normalizedText.length >= 3 && normalizedText.includes(entry.normalizedText))));
  if (baseHits.length > 0) return { reconciled: false, reason: "a imagem base já contém o texto (BASE_IMAGE) — ocorrência não determinística", explainedBy: baseHits.map((entry) => entry.sourceId) };
  const explainers = ledger.entries.filter((entry) =>
    ((entry.sourceType === "RENDERER_TEXT" || entry.sourceType === "VERIFIED_DOMAIN") && entry.normalizedText !== undefined && (entry.normalizedText === normalizedText || entry.normalizedText.includes(normalizedText)))
    || (entry.sourceType === "LOGO_ASSET" && (entry.alternatives ?? []).includes(normalizedText)));
  // Inventário do screenshot verificado: explica até `occurrenceCount` ocorrências (nunca ilimitado).
  const inventoryEntries = ledger.entries.filter((entry) => entry.sourceType === "SCREENSHOT_TEXT_INVENTORY" && entry.normalizedText);
  const inventoryMatch = inventoryEntries.length > 0
    ? matchScreenshotInventoryText(normalizedText, { texts: inventoryEntries.map((entry) => ({ text: entry.normalizedText!, normalizedText: entry.normalizedText!, occurrenceCount: entry.occurrenceCount ?? 1 })) })
    : undefined;
  const inventoryExplainers = inventoryMatch ? inventoryEntries.filter((entry) => inventoryMatch.matchedEntries.includes(entry.normalizedText!)) : [];
  const allExplainers = [...explainers, ...inventoryExplainers];
  const explainable = explainers.length + (inventoryMatch?.budget ?? 0);
  if (allExplainers.length === 0) return { reconciled: false, reason: "texto sem origem no ledger", explainedBy: [] };
  if (reportedCount > explainable) return { reconciled: false, reason: `${reportedCount} ocorrências reportadas > ${explainable} origens explicáveis`, explainedBy: allExplainers.map((entry) => entry.sourceId) };
  return { reconciled: true, reason: `LEDGER_RECONCILED: ${reportedCount} ocorrência(s) explicadas por ${allExplainers.map((entry) => `${entry.sourceType}/${entry.role}${entry.sourceType === "SCREENSHOT_TEXT_INVENTORY" ? `×${entry.occurrenceCount ?? 1}` : ""}`).join(" + ")}; base sem o texto`, explainedBy: allExplainers.map((entry) => entry.sourceId) };
}

/**
 * VISION_ZONE_CONTRADICTION — só para adjudicar DUPLICIDADE de um texto já conhecido pelo ledger
 * (achado do cenário B execution-mv1ipciu-jociy4: a visão leu o CTA "dentro" da zona onde o renderer
 * desenhou OUTRO texto). Uma ocorrência rejeitada é retirada da contagem somente se TODAS valem:
 * (A) a bbox cai numa zona do renderer pela regra estrita de região; (B) o texto detectado é
 * diferente do texto daquela zona; (C) a zona vem da geometria final do renderer; (D) scan da base
 * AVAILABLE; (E) a base não contém o texto; (F) o ledger tem origem legítima para o texto; (G) uma
 * ocorrência legítima do mesmo texto já foi comprovada na própria lista; (H) nenhum asset soberano
 * (logo/screenshot/produto) cobre aquela bbox. Nunca fabrica evidência positiva: sem a ocorrência
 * legítima (G) nada muda. Texto desconhecido nunca entra aqui (F).
 */
function applyVisionZoneContradiction(
  decision: { text: string; legitimate: boolean; rejectedReason?: string; occurrences: CreativeTextOccurrenceDiagnostic[] },
  regions: { renderedTextRegions: readonly CreativeRenderedTextRegion[]; verifiedLogoRegions: readonly CreativePlanRect[]; verifiedScreenshotRegions: readonly CreativePlanRect[] },
  ledger: TextProvenanceLedger | undefined,
): { text: string; legitimate: boolean; rejectedReason?: string; occurrences: CreativeTextOccurrenceDiagnostic[]; remainingCount: number; contradictions: number } {
  const unchanged = { ...decision, remainingCount: decision.occurrences.length, contradictions: 0 };
  if (decision.legitimate || !ledger || ledger.baseTextStatus !== "AVAILABLE") return unchanged; // (D)
  const detected = normalizeRenderedText(decision.text);
  if (!detected) return unchanged;
  const baseContains = ledger.entries.some((entry) => entry.sourceType === "BASE_IMAGE" && entry.normalizedText !== undefined && (entry.normalizedText.includes(detected) || (entry.normalizedText.length >= 3 && detected.includes(entry.normalizedText))));
  if (baseContains) return unchanged; // (E)
  const origin = ledger.entries.find((entry) =>
    ((entry.sourceType === "RENDERER_TEXT" || entry.sourceType === "VERIFIED_DOMAIN") && entry.normalizedText !== undefined && (entry.normalizedText === detected || entry.normalizedText.includes(detected)))
    || (entry.sourceType === "LOGO_ASSET" && (entry.alternatives ?? []).includes(detected)));
  if (!origin) return unchanged; // (F)
  // (G) Ocorrência legítima: casada estritamente com a zona, ou — texto inteiro de UMA única zona —
  // perto dela pela faixa com piso na resolução da visão (base escaneada e limpa, já verificado acima).
  const ownZones = regions.renderedTextRegions.filter((zone) => normalizeRenderedText(zone.text) === detected);
  const nearOwnZone = (occurrence: CreativeTextOccurrenceDiagnostic): boolean =>
    ownZones.length === 1 && occurrence.bbox !== undefined && measureRenderedTextProximity(occurrence.bbox, ownZones[0]!.rect, VISION_BBOX_RESOLUTION_PCT).near;
  const legitimateId = decision.occurrences.find((occurrence) => occurrence.decision === "allowed")?.occurrenceId
    ?? decision.occurrences.find((occurrence) => occurrence.decision === "rejected" && nearOwnZone(occurrence))?.occurrenceId;
  if (!legitimateId) return unchanged;
  const sovereign = [
    ...regions.verifiedLogoRegions,
    ...regions.verifiedScreenshotRegions,
    ...ledger.entries.filter((entry) => entry.sourceType === "PRODUCT_ASSET" && entry.expectedBBox).map((entry) => entry.expectedBBox!),
  ];
  let contradictions = 0;
  const occurrences = decision.occurrences.map((occurrence): CreativeTextOccurrenceDiagnostic => {
    if (occurrence.decision !== "rejected" || !occurrence.bbox) return occurrence;
    if (occurrence.occurrenceId === legitimateId) {
      // Legítima pela proximidade com piso de resolução: só vale como tal se houver contradição real.
      return { ...occurrence, decision: "allowed", reason: `MATCHED_RENDERED_${ownZones[0]!.kind.toUpperCase()} pela faixa com piso na resolução da visão (visão: ${occurrence.reason})` };
    }
    if (sovereign.length > 0 && isTextRegionInsideVerifiedLogo(occurrence.bbox, sovereign)) return occurrence; // (H)
    const zone = regions.renderedTextRegions.find((candidate) => isTextRegionInsideVerifiedLogo(occurrence.bbox!, [candidate.rect])); // (A)(C)
    if (!zone) return occurrence;
    const zoneText = normalizeRenderedText(zone.text);
    if (zoneText === detected || zoneText.includes(detected)) return occurrence; // (B)
    contradictions += 1;
    return {
      ...occurrence,
      decision: "VISION_ZONE_CONTRADICTION",
      ignoredForDuplicateCount: true,
      conflictingRendererRole: zone.kind,
      conflictingRendererText: zoneText,
      conflictingRendererBBox: zone.rect,
      expectedLedgerRole: origin.role,
      expectedLedgerSourceId: origin.sourceId,
      baseTextScanStatus: "AVAILABLE",
      baseContainsDetectedText: false,
      reason: `detected_text_conflicts_with_verified_${zone.kind}_zone_base_clean_and_legitimate_${origin.role}_exists (visão: ${occurrence.reason})`,
    };
  });
  if (contradictions === 0) return unchanged;
  const remaining = occurrences.filter((occurrence) => !occurrence.ignoredForDuplicateCount);
  const legitimate = remaining.length <= 1 ? remaining.every((occurrence) => occurrence.decision === "allowed") : false;
  const firstRejected = remaining.find((occurrence) => occurrence.decision === "rejected");
  return { text: decision.text, legitimate, rejectedReason: firstRejected ? `${firstRejected.occurrenceId}: ${firstRejected.reason}` : undefined, occurrences, remainingCount: remaining.length, contradictions };
}

/**
 * Zona do renderer que CONTRADIZ a localização dada pela visão para um texto determinístico: a bbox
 * cai (regra estrita de região) numa zona cujo texto final é OUTRO, a base foi escaneada e não tem
 * o texto, e nenhum asset soberano (logo/screenshot/produto) cobre a bbox. Nesse caso a única origem
 * física possível do texto é a sua própria zona — a posição da visão é que está errada.
 */
function findContradictingRendererZone(
  bbox: CreativePlanRect,
  normalizedDetected: string,
  regions: { renderedTextRegions: readonly CreativeRenderedTextRegion[]; verifiedLogoRegions: readonly CreativePlanRect[]; verifiedScreenshotRegions: readonly CreativePlanRect[] },
  ledger: TextProvenanceLedger | undefined,
): CreativeRenderedTextRegion | undefined {
  if (!ledger || ledger.baseTextStatus !== "AVAILABLE" || !normalizedDetected) return undefined;
  const baseContains = ledger.entries.some((entry) => entry.sourceType === "BASE_IMAGE" && entry.normalizedText !== undefined && (entry.normalizedText.includes(normalizedDetected) || (entry.normalizedText.length >= 3 && normalizedDetected.includes(entry.normalizedText))));
  if (baseContains) return undefined;
  const sovereign = [
    ...regions.verifiedLogoRegions,
    ...regions.verifiedScreenshotRegions,
    ...ledger.entries.filter((entry) => entry.sourceType === "PRODUCT_ASSET" && entry.expectedBBox).map((entry) => entry.expectedBBox!),
  ];
  if (sovereign.length > 0 && isTextRegionInsideVerifiedLogo(bbox, sovereign)) return undefined;
  return regions.renderedTextRegions.find((candidate) => {
    const zoneText = normalizeRenderedText(candidate.text);
    return zoneText !== normalizedDetected && !zoneText.includes(normalizedDetected) && isTextRegionInsideVerifiedLogo(bbox, [candidate.rect]);
  });
}

/**
 * Duplicidade por OCORRÊNCIA. Cada ocorrência é classificada pela região + proveniência:
 * zona do renderer (texto equivalente dentro da bbox final), logo verificada, screenshot real
 * verificado, ou desconhecida. O texto repetido só é legítimo quando TODA ocorrência tem origem
 * comprovada e nenhuma zona do renderer aparece duas vezes (ex.: "Criar meu site" no site real +
 * no CTA = ALLOWED_TWO_LEGITIMATE_OCCURRENCES). Sem regiões (motor padrão) = regra antiga.
 */
function resolveDuplicateOccurrences(
  raw: unknown,
  itemIndex: number,
  regions: { renderedTextRegions: readonly CreativeRenderedTextRegion[]; verifiedLogoRegions: readonly CreativePlanRect[]; verifiedScreenshotRegions: readonly CreativePlanRect[] },
  screenshot?: { inventory?: UsableScreenshotInventory; ledger?: TextProvenanceLedger },
): { text: string; legitimate: boolean; rejectedReason?: string; occurrences: CreativeTextOccurrenceDiagnostic[] } | undefined {
  const text = typeof raw === "string" ? raw : typeof raw === "object" && raw !== null && typeof (raw as { text?: unknown }).text === "string" ? (raw as { text: string }).text : "";
  if (!text.trim()) return undefined;
  const normalizedText = normalizeRenderedText(text);
  const rawOccurrences = typeof raw === "object" && raw !== null && Array.isArray((raw as { occurrences?: unknown }).occurrences) ? ((raw as { occurrences: unknown[] }).occurrences) : [];
  const hasRegionModel = regions.renderedTextRegions.length > 0 || regions.verifiedLogoRegions.length > 0 || regions.verifiedScreenshotRegions.length > 0;
  if (!hasRegionModel || rawOccurrences.length < 2) {
    const reason = !hasRegionModel ? "sem geometria final verificada (motor padrão): duplicidade pela string" : "visão não informou as regiões de cada ocorrência — sem prova espacial";
    return { text, legitimate: false, rejectedReason: hasRegionModel ? reason : undefined, occurrences: [{ occurrenceId: `dup-${itemIndex}`, normalizedText, matchedRegion: "unknown", provenance: "UNVERIFIED", decision: "rejected", reason }] };
  }
  const usedZones = new Set<CreativeRenderedTextRegion>();
  const inventoryMatch = screenshot?.inventory ? matchScreenshotInventoryText(normalizedText, screenshot.inventory) : undefined;
  let screenshotInRegion = 0;
  const occurrences = rawOccurrences.map((entry, occurrenceIndex): CreativeTextOccurrenceDiagnostic => {
    const record = typeof entry === "object" && entry !== null ? (entry as { region?: unknown }) : {};
    const detected = parseDetectedText({ text, region: record.region ?? entry });
    const occurrenceId = `dup-${itemIndex}-${occurrenceIndex}`;
    const bbox = detected?.region;
    if (!bbox) return { occurrenceId, normalizedText, matchedRegion: "unknown", provenance: "UNVERIFIED", decision: "rejected", reason: "ocorrência sem região — sem prova espacial" };
    const zone = matchRenderedTextRegion({ text, region: bbox }, regions.renderedTextRegions) ?? matchRenderedTextWithinJitter({ text, region: bbox }, regions.renderedTextRegions);
    if (zone) {
      if (usedZones.has(zone)) return { occurrenceId, normalizedText, bbox, matchedRegion: zone.kind, provenance: "RENDERER_TEXT_ZONE", decision: "rejected", reason: `segunda ocorrência dentro da mesma zona ${zone.kind}` };
      usedZones.add(zone);
      return { occurrenceId, normalizedText, bbox, matchedRegion: zone.kind, provenance: "RENDERER_TEXT_ZONE", decision: "allowed", reason: `equivalente dentro da bbox final da zona ${zone.kind}` };
    }
    if (regions.verifiedLogoRegions.length > 0 && isTextRegionInsideVerifiedLogo(bbox, regions.verifiedLogoRegions)) {
      return { occurrenceId, normalizedText, bbox, matchedRegion: "logo", provenance: "VERIFIED_LOGO", decision: "allowed", reason: "dentro da bbox final da logo oficial verificada" };
    }
    if (regions.verifiedScreenshotRegions.length > 0 && isTextRegionInsideVerifiedLogo(bbox, regions.verifiedScreenshotRegions)) {
      if (inventoryMatch === undefined && screenshot?.inventory) {
        return { occurrenceId, normalizedText, bbox, matchedRegion: "SCREENSHOT_CONTENT", provenance: "UNVERIFIED", decision: "rejected", reason: "dentro da bbox do screenshot, mas o texto não existe no inventário do screenshot verificado" };
      }
      screenshotInRegion += 1;
      return { occurrenceId, normalizedText, bbox, matchedRegion: "SCREENSHOT_CONTENT", provenance: "VERIFIED_SCREENSHOT", decision: "allowed", reason: "conteúdo do screenshot real verificado (proveniência + pixel)" };
    }
    return { occurrenceId, normalizedText, bbox, matchedRegion: "unknown", provenance: "UNVERIFIED", decision: "rejected", reason: "fora de qualquer zona do renderer, logo ou screenshot verificados" };
  });
  // Inventário do screenshot (depois da região e da proveniência determinística): a visão leu um
  // texto que EXISTE no screenshot verificado, mas pôs a bbox fora dele. Autoriza só até o orçamento
  // de ocorrências do inventário (descontadas as já vistas dentro da região), nunca quando a base
  // escaneada contém o texto (a ocorrência solta poderia ser da base).
  if (inventoryMatch && screenshot?.inventory && !baseScanContains(screenshot.ledger, normalizedText)) {
    let remaining = inventoryMatch.budget - screenshotInRegion;
    for (const [index, item] of occurrences.entries()) {
      if (item.decision !== "rejected" || item.matchedRegion !== "unknown" || !item.bbox) continue;
      if (remaining <= 0) {
        occurrences[index] = { ...item, reason: `${item.reason}; orçamento do inventário do screenshot esgotado (${inventoryMatch.budget} ocorrência(s) no screenshot)` };
        continue;
      }
      remaining -= 1;
      occurrences[index] = {
        ...item,
        matchedRegion: "SCREENSHOT_TEXT_INVENTORY",
        provenance: "VERIFIED_SCREENSHOT_TEXT_INVENTORY",
        decision: "allowed",
        reason: `MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY: texto existe no screenshot verificado (${inventoryMatch.budget} ocorrência(s), sha256 ${screenshot.inventory.assetSha256.slice(0, 12)}…); bbox da visão fora da região do screenshot`,
      };
    }
  }
  const rejected = occurrences.find((item) => item.decision === "rejected");
  if (!rejected) {
    for (const item of occurrences) item.reason = `ALLOWED_TWO_LEGITIMATE_OCCURRENCES: ${item.reason}`;
    return { text, legitimate: true, occurrences };
  }
  return { text, legitimate: false, rejectedReason: `${rejected.occurrenceId}: ${rejected.reason}`, occurrences };
}

type VisionBboxCoordinateSystem = "UNIT_0_1" | "PERCENT_0_100" | "PIXEL" | "PROVIDER_INTERNAL_1000" | "UNKNOWN_PERCENT_ASSUMED";

type ParsedDetectedText = {
  text: string;
  /** Normalized percent coordinates used by every spatial adjudication below. */
  region?: CreativePlanRect;
  rawBbox?: CreativePlanRect;
  rawCoordinateSystem?: VisionBboxCoordinateSystem;
  normalizedBboxPercent?: CreativePlanRect;
};

function readVisionRect(region: Record<string, unknown>): CreativePlanRect | undefined {
  const x = typeof region.xPct === "number" ? region.xPct : region.x;
  const y = typeof region.yPct === "number" ? region.yPct : region.y;
  const width = typeof region.widthPct === "number" ? region.widthPct : region.width;
  const height = typeof region.heightPct === "number" ? region.heightPct : region.height;
  if ([x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return { xPct: x as number, yPct: y as number, widthPct: width as number, heightPct: height as number };
  }
  return undefined;
}

function normalizeVisionBbox(raw: CreativePlanRect, imageSize?: { width?: number; height?: number }): { coordinateSystem: VisionBboxCoordinateSystem; normalized: CreativePlanRect } {
  const values = [raw.xPct, raw.yPct, raw.widthPct, raw.heightPct];
  const nonNegative = values.every((value) => value >= 0);
  if (nonNegative && values.every((value) => value <= 1) && raw.xPct + raw.widthPct <= 1.25 && raw.yPct + raw.heightPct <= 1.25) {
    return {
      coordinateSystem: "UNIT_0_1",
      normalized: { xPct: raw.xPct * 100, yPct: raw.yPct * 100, widthPct: raw.widthPct * 100, heightPct: raw.heightPct * 100 },
    };
  }
  if (nonNegative && values.every((value) => value <= 100) && raw.xPct + raw.widthPct <= 125 && raw.yPct + raw.heightPct <= 125) {
    return { coordinateSystem: "PERCENT_0_100", normalized: raw };
  }
  if (
    nonNegative
    && imageSize?.width
    && imageSize.height
    && raw.xPct + raw.widthPct <= imageSize.width * 1.1
    && raw.yPct + raw.heightPct <= imageSize.height * 1.1
  ) {
    return {
      coordinateSystem: "PIXEL",
      normalized: {
        xPct: (raw.xPct / imageSize.width) * 100,
        yPct: (raw.yPct / imageSize.height) * 100,
        widthPct: (raw.widthPct / imageSize.width) * 100,
        heightPct: (raw.heightPct / imageSize.height) * 100,
      },
    };
  }
  if (nonNegative && values.every((value) => value <= 1000) && raw.xPct + raw.widthPct <= 1250 && raw.yPct + raw.heightPct <= 1250) {
    return {
      coordinateSystem: "PROVIDER_INTERNAL_1000",
      normalized: { xPct: raw.xPct / 10, yPct: raw.yPct / 10, widthPct: raw.widthPct / 10, heightPct: raw.heightPct / 10 },
    };
  }
  return { coordinateSystem: "UNKNOWN_PERCENT_ASSUMED", normalized: raw };
}

function parseDetectedText(raw: unknown, imageSize?: { width?: number; height?: number }): ParsedDetectedText | undefined {
  if (typeof raw === "string") return raw.trim() ? { text: raw } : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as { text?: unknown; region?: unknown };
  if (typeof record.text !== "string" || !record.text.trim()) return undefined;
  const region = record.region as Record<string, unknown> | undefined;
  const rawBbox = region ? readVisionRect(region) : undefined;
  if (!rawBbox) return { text: record.text };
  const normalized = normalizeVisionBbox(rawBbox, imageSize);
  return {
    text: record.text,
    region: normalized.normalized,
    rawBbox,
    rawCoordinateSystem: normalized.coordinateSystem,
    normalizedBboxPercent: normalized.normalized,
  };
}

function bboxDiagnostic(detected: ParsedDetectedText): Pick<CreativeTextDiagnostic, "bbox" | "rawBbox" | "rawCoordinateSystem" | "normalizedBboxPercent"> {
  return {
    ...(detected.region ? { bbox: detected.region } : {}),
    ...(detected.rawBbox ? { rawBbox: detected.rawBbox } : {}),
    ...(detected.rawCoordinateSystem ? { rawCoordinateSystem: detected.rawCoordinateSystem } : {}),
    ...(detected.normalizedBboxPercent ? { normalizedBboxPercent: detected.normalizedBboxPercent } : {}),
  };
}

/** Diagnóstico sanitizado de cada texto que a visão reportou (sem resposta bruta): diz se o texto
 * veio da logo, do CTA, da headline ou de região desconhecida, e por que foi aceito/rejeitado. */
export type CreativeTextDiagnostic = {
  detectedText: string;
  bbox?: CreativePlanRect;
  rawBbox?: CreativePlanRect;
  rawCoordinateSystem?: VisionBboxCoordinateSystem;
  normalizedBboxPercent?: CreativePlanRect;
  matchedElement?: string;
  normalizedExpected?: string;
  normalizedDetected: string;
  decision: "authorized" | "rejected" | "missing" | "missing_reconciled";
  reason: string;
  /** Casamento de alta confiança com uma zona do renderer (jitter da visão), quando avaliado. */
  occurrenceId?: string;
  expectedRole?: string;
  expectedBBox?: CreativePlanRect;
  /** Fração da bbox detectada dentro da bbox FINAL esperada (estrita). */
  overlap?: number;
  /** Distância entre centros, em pontos percentuais do canvas. */
  centerDistance?: number;
  /** Faixa de tolerância aplicada em volta da bbox esperada (pontos percentuais por lado). */
  toleranceApplied?: number;
  matchDecision?: string;
  /** VISION_ZONE_CONTRADICTION: a visão pôs o texto numa zona onde o renderer desenhou OUTRO texto. */
  conflictingRendererRole?: string;
  conflictingRendererText?: string;
  conflictingRendererBBox?: CreativePlanRect;
  baseTextScanStatus?: "AVAILABLE" | "NOT_AVAILABLE";
  baseContainsDetectedText?: boolean;
};

/** Diagnóstico sanitizado de cada OCORRÊNCIA de um texto repetido: duplicidade é decidida por
 * ocorrência (região + proveniência), nunca só pela string. */
export type CreativeTextOccurrenceDiagnostic = {
  occurrenceId: string;
  normalizedText: string;
  bbox?: CreativePlanRect;
  matchedRegion: string;
  provenance: "RENDERER_TEXT_ZONE" | "VERIFIED_LOGO" | "VERIFIED_SCREENSHOT" | "VERIFIED_SCREENSHOT_TEXT_INVENTORY" | "UNVERIFIED";
  decision: "allowed" | "rejected" | "VISION_ZONE_CONTRADICTION";
  reason: string;
  /** VISION_ZONE_CONTRADICTION: a ocorrência continua registrada (auditoria), só não conta como duplicata. */
  ignoredForDuplicateCount?: boolean;
  conflictingRendererRole?: string;
  conflictingRendererText?: string;
  conflictingRendererBBox?: CreativePlanRect;
  expectedLedgerRole?: string;
  expectedLedgerSourceId?: string;
  baseTextScanStatus?: "AVAILABLE" | "NOT_AVAILABLE";
  baseContainsDetectedText?: boolean;
};

/** Texto desenhado na geometria FINAL do renderer — base da autorização regional. */
export type CreativeRenderedTextRegion = { kind: string; text: string; rect: CreativePlanRect };

/** Diagnóstico de texto da IMAGEM BASE (ver `scanEditorialBaseText`) no formato que o gate consome. */
export type CreativeBaseTextEvidence = {
  status: "AVAILABLE" | "NOT_AVAILABLE";
  texts: readonly { text: string; normalizedText: string; bbox?: CreativePlanRect }[];
};

export type TextProvenanceSourceType = "RENDERER_TEXT" | "VERIFIED_DOMAIN" | "LOGO_ASSET" | "SCREENSHOT_ASSET" | "SCREENSHOT_TEXT_INVENTORY" | "BASE_IMAGE" | "PRODUCT_ASSET";

/** Uma origem conhecida de texto na peça, registrada ANTES da visão final. */
export type TextProvenanceEntry = {
  sourceType: TextProvenanceSourceType;
  sourceId: string;
  /** Texto exato (renderer/base). Assets com texto próprio desconhecido (screenshot/produto) não têm. */
  normalizedText?: string;
  /** Logo: literais da marca que a logo oficial pode conter (nome declarado da marca). */
  alternatives?: string[];
  /** Inventário do screenshot: orçamento de ocorrências desse texto dentro do screenshot. */
  occurrenceCount?: number;
  role: string;
  expectedBBox?: CreativePlanRect;
  deterministic: boolean;
  assetProvenance?: string;
  rendererAuthored?: boolean;
  authorized?: boolean;
  sourceField?: string;
  requirementSatisfied?: "SITE_VISIBLE";
};

/** Ledger de proveniência textual da peça: o renderer é autoridade sobre o que ele desenhou; assets
 * soberanos têm proveniência própria; a base tem diagnóstico próprio. A visão final é evidência. */
export type TextProvenanceLedger = {
  baseTextStatus: "AVAILABLE" | "NOT_AVAILABLE";
  entries: TextProvenanceEntry[];
};

export type CreativeQualityGateResult = {
  verdict: "pass" | "fail";
  issues: CreativeQualityIssue[];
  textProvenanceLedger?: TextProvenanceLedger;
  textDiagnostics?: CreativeTextDiagnostic[];
  occurrenceDiagnostics?: CreativeTextOccurrenceDiagnostic[];
  /** Veredito de paleta da visão superado pela paleta da marca comprovadamente aplicada pelo renderer. */
  paletteDiagnostics?: PaletteDiagnostic[];
  rendererPaletteCompliance?: RendererPaletteCompliance;
  productionRequirementDiagnostics?: ProductionRequirementDiagnostic[];
  /** Se o inventário de texto do screenshot foi usado nesta avaliação, e por quê. */
  screenshotInventoryDecision?: { status: "USED" | "NOT_USED"; reason: string };
  /** Se o inventário de texto da logo foi usado nesta avaliação, e por quê. */
  logoInventoryDecision?: { status: "USED" | "NOT_USED"; reason: string };
};

export type RendererPaletteCompliance = {
  result: "PASS" | "FAIL" | "NOT_APPLICABLE";
  source: "RENDERER";
  rule: string;
  expected?: string;
  actual?: string;
  offendingColor?: string;
  offendingRegion?: string;
  pixelCoverage?: number;
  ownership?: "RENDERER" | "GENERATED_BASE" | "LOGO_ASSET" | "PRODUCT_ASSET" | "OTHER_VERIFIED_ASSET" | "UNKNOWN";
  reason: string;
};

export type PaletteDiagnostic = {
  decision: "VISION_COLOR_CONTRADICTION" | "VISION_PALETTE_OVERRIDDEN_BY_RENDERER" | "DETERMINISTIC_COLOR_FAILURE";
  visionReasoning?: string;
  rendererPaletteCompliance?: RendererPaletteCompliance;
};

export type ProductionRequirementDiagnostic = {
  guidelineSource: "productionInstructions" | "behaviorPreferences" | "inferred";
  guidelineText: string;
  requirementType: "BRAND_VISIBLE" | "BRAND_PROMINENCE" | "SITE_VISIBLE" | "CTA_VISIBLE";
  severity: "required" | "recommended";
  result: "PASS" | "FAIL";
  geometryEvidence?: Record<string, unknown>;
  visionReasoning?: string;
  adjudication: "DETERMINISTIC_PASS" | "DETERMINISTIC_FAIL" | "VISION_GUIDELINE_CONTRADICTION" | "VISION_CONFIRMED_FAILURE";
  finalReason: string;
};

const ASPECT_RATIO_TOLERANCE = 0.06;

function parseAspectRatio(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return undefined;
  return width / height;
}

/**
 * Falhas determinísticas — nunca dependem de IA, calculadas sobre dados REAIS (dimensões do
 * buffer final, quais assets foram de fato compostos, proveniência do artefato). Nada aqui
 * "adivinha" — cada issue vem de um dado concreto que já existe no resultado da execução.
 */
export function evaluateDeterministicCreativeChecks(input: {
  finalImageWidth: number;
  finalImageHeight: number;
  expectedAspectRatio: string;
  compositedAssetRoles: CreativePlanAssetRole[];
  contextAssetRoles: CreativePlanAssetRole[];
  /** `true` quando o artefato final tem proveniência não publicável (ver
   * `src/shared/utils/artifact-provenance.ts`) — nunca deve acontecer no caminho normal do motor
   * GPT, mas é a última rede de proteção determinística caso algo escape. */
  nonPublishableSource?: boolean;
  /** Prova em pixel por asset (compositor editorial). Quando presente, o gate deixa de confiar na
   * bbox declarada: todo role em `compositedAssetRoles` precisa de prova `visible: true`. */
  assetPixelEvidence?: readonly CreativeAssetPixelEvidence[];
}): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];

  if (input.assetPixelEvidence) {
    for (const role of input.compositedAssetRoles) {
      const evidence = input.assetPixelEvidence.find((item) => item.role === role);
      if (evidence?.visible) continue;
      issues.push({
        code: "REQUIRED_ASSET_MISSING",
        message: evidence
          ? `Asset "${role}" está declarado na geometria final, mas os pixels não comprovam que ele apareceu na peça (${evidence.reason ?? "verificação de pixel reprovada"}).`
          : `Asset "${role}" está declarado na geometria final, mas não existe prova em pixel de que ele apareceu na peça.`,
      });
    }
  }

  const expectedRatio = parseAspectRatio(input.expectedAspectRatio);
  if (expectedRatio && input.finalImageWidth > 0 && input.finalImageHeight > 0) {
    const actualRatio = input.finalImageWidth / input.finalImageHeight;
    const deviation = Math.abs(actualRatio - expectedRatio) / expectedRatio;
    if (deviation > ASPECT_RATIO_TOLERANCE) {
      issues.push({
        code: "WRONG_ASPECT_RATIO",
        message: `Peça final ${input.finalImageWidth}x${input.finalImageHeight} não corresponde ao formato pedido "${input.expectedAspectRatio}" (desvio de ${(deviation * 100).toFixed(1)}%).`,
      });
    }
  }

  // Só logo/screenshot exigem composição determinística — produto real pode ter sido tratado por
  // edição via referência na própria geração (sem composição posterior), então não entra aqui.
  const rolesRequiringComposite: CreativePlanAssetRole[] = ["logo", "screenshot"];
  for (const role of rolesRequiringComposite) {
    if (input.contextAssetRoles.includes(role) && !input.compositedAssetRoles.includes(role)) {
      issues.push({
        code: "REQUIRED_ASSET_MISSING",
        message: `Asset obrigatório do tipo "${role}" estava disponível no contexto, mas não foi composto na peça final.`,
      });
    }
  }

  if (input.nonPublishableSource) {
    issues.push({
      code: "NON_PUBLISHABLE_SOURCE",
      message: "A imagem final tem origem marcada como não publicável (placeholder/fallback automático) — nunca pode virar peça entregável.",
    });
  }

  return issues;
}

/**
 * Determinístico, sem chamada de IA e sem custo: varre todo texto que a peça final vai exibir
 * (headline, subheadline, CTA, título, descrição, zonas de texto do plano) atrás de valores
 * comerciais (preço, desconto, frete, urgência) via `extractCommercialFactsFromText` — o mesmo
 * extrator regex já usado para o texto livre do usuário — e reprova qualquer valor que não esteja
 * EXATAMENTE entre os fatos já confirmados do `creative_context`. É a proteção direta contra o
 * GPT "quase acertar" um preço (ex.: arredondar R$39,99 para R$40) ou inventar uma condição
 * comercial que nunca foi confirmada.
 */
export function checkCommercialFactIntegrity(plan: CreativePlan, context: CreativeContext): CreativeQualityIssue[] {
  const texts = [plan.headline, plan.subheadline, plan.cta, plan.title, plan.description, ...plan.textZones.map((zone) => zone.text)].filter(
    (text): text is string => Boolean(text?.trim()),
  );
  if (texts.length === 0) return [];

  const mentionedFacts = extractCommercialFactsFromText(texts.join("\n"));
  const issues: CreativeQualityIssue[] = [];

  for (const fact of mentionedFacts) {
    const matchesConfirmed = context.confirmedFacts.some((line) => line.includes(fact.value));
    if (matchesConfirmed) continue;

    const label = COMMERCIAL_FACT_TYPE_LABELS_PT[fact.type];
    const sameTypeConfirmed = context.confirmedFacts.some((line) => line.startsWith(label));
    issues.push({
      code: sameTypeConfirmed ? "WRONG_PRICE" : "INVENTED_COMMERCIAL_FACT",
      message: sameTypeConfirmed
        ? `A peça menciona "${fact.value}" (${label}), mas o fato confirmado no contexto tem outro valor — nunca publicar um dado comercial diferente do confirmado.`
        : `A peça menciona "${fact.value}" (${label}), mas nenhum fato comercial confirmado desse tipo existe no contexto — nunca inventar preço, desconto ou condição comercial.`,
    });
  }

  return issues;
}

/** Margem de segurança (percentual do canvas) — achado ao vivo em produção: CTA/texto cortado na
 * borda inferior de peças reais. Diferente do check de vídeo/visão (`checkCreativeVisualIntegrity`,
 * que só reprova depois de renderizar e "olhar" a imagem), este check é determinístico e roda
 * sobre a GEOMETRIA JÁ DECLARADA pelo `creative_plan` — pega o defeito antes mesmo de compor a
 * peça. Só cobre `textZones` (não `assetPlacements`) de propósito: `renderer_reflow`
 * (`creative-repair.ts`) só sabe reduzir `fontScale` e re-renderizar zonas de TEXTO — não
 * reposiciona a geometria de logo/screenshot. Reportar uma violação de safe area em
 * `assetPlacements` aqui criaria um defeito sem caminho de reparo correspondente (nunca resolvido,
 * sempre esgotando as tentativas) — escopo deliberadamente restrito ao que o sistema já sabe
 * corrigir sem gerar uma imagem nova. */
/** Exportado para o compositor editorial aplicar a MESMA margem antes de publicar — o layout é
 * corrigido para respeitá-la, nunca o gate afrouxado para aceitar o layout. */
export const SAFE_AREA_MARGIN_PCT = 2;

function violatesSafeArea(rect: CreativePlanRect, marginPct = SAFE_AREA_MARGIN_PCT): boolean {
  return rect.xPct < marginPct || rect.yPct < marginPct || rect.xPct + rect.widthPct > 100 - marginPct || rect.yPct + rect.heightPct > 100 - marginPct;
}

/**
 * Hard failure de acabamento — texto (headline/subheadline/CTA/preço/desconto/URL/badge) cuja
 * geometria já declarada no `creative_plan` toca ou ultrapassa a margem de segurança do canvas.
 * `TEXT_ILLEGIBLE_OR_CUT` (zonas com `renderedBy: "renderer"`, o caso reportado ao vivo — CTA
 * cortado na borda) e `ELEMENT_CUT_OFF` (zonas com `renderedBy: "image_model"`, mesmo problema
 * geométrico mas desenhado pelo modelo de imagem em vez do renderer) — a distinção de código
 * importa para o roteamento de reparo (`creative-repair.ts`). `source: "safe_area"` (sempre
 * determinístico, sempre sobre geometria já declarada no plano) é o que torna essas duas issues
 * seguras pra `renderer_reflow` — nunca confundir com o MESMO código vindo da visão
 * (`checkCreativeVisualIntegrity`, `source: "vision"`), que pode estar reportando um problema de
 * contraste/cor que reflow nenhum resolve (ver comentário em `CreativeQualityIssue.source`).
 */
export function checkSafeAreaCompliance(plan: CreativePlan): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];
  for (const zone of plan.textZones) {
    if (!violatesSafeArea(zone.rect)) continue;
    issues.push({
      code: zone.renderedBy === "renderer" ? "TEXT_ILLEGIBLE_OR_CUT" : "ELEMENT_CUT_OFF",
      message: `Zona de texto "${zone.kind}" (x=${zone.rect.xPct}%, y=${zone.rect.yPct}%, largura=${zone.rect.widthPct}%, altura=${zone.rect.heightPct}%) toca ou ultrapassa a margem de segurança do canvas (${SAFE_AREA_MARGIN_PCT}%) — risco real de corte na borda.`,
      source: "safe_area",
    });
  }
  return issues;
}

/**
 * Auditoria "motor de geração de criativos" — achado ao revisar `checkSafeAreaCompliance`: aquele
 * check cobre só `textZones` de propósito (o comentário original argumentava que uma violação em
 * `assetPlacements` "criaria um defeito sem caminho de reparo correspondente"). Essa premissa
 * ficou desatualizada: `TEXT_ZONE_OVERLAPS_ASSET` (abaixo) já prova que um código deliberadamente
 * fora de `RENDERER_REFLOW_CODES` sempre tem um caminho de reparo real (`gpt_replan` — o diretor
 * escolhe outra geometria). Um produto/screenshot posicionado tocando a borda do canvas tem
 * exatamente o mesmo risco de corte destrutivo que um texto, e a mesma correção resolve.
 */
export function checkAssetSafeAreaCompliance(plan: CreativePlan): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];
  for (const placement of plan.assetPlacements) {
    if (!violatesSafeArea(placement.rect)) continue;
    issues.push({
      code: "CRITICAL_ASSET_CROP",
      message: `Asset "${placement.role}" (x=${placement.rect.xPct}%, y=${placement.rect.yPct}%, largura=${placement.rect.widthPct}%, altura=${placement.rect.heightPct}%) toca ou ultrapassa a margem de segurança do canvas (${SAFE_AREA_MARGIN_PCT}%) — risco real de corte destrutivo na borda.`,
      source: "safe_area",
    });
  }
  return issues;
}

export function rectsOverlap(a: CreativePlanRect, b: CreativePlanRect): boolean {
  return a.xPct < b.xPct + b.widthPct && a.xPct + a.widthPct > b.xPct && a.yPct < b.yPct + b.heightPct && a.yPct + a.heightPct > b.yPct;
}

function rectArea(rect: CreativePlanRect): number {
  return Math.max(0, rect.widthPct) * Math.max(0, rect.heightPct);
}

function rectOverlapArea(a: CreativePlanRect, b: CreativePlanRect): number {
  const x1 = Math.max(a.xPct, b.xPct);
  const y1 = Math.max(a.yPct, b.yPct);
  const x2 = Math.min(a.xPct + a.widthPct, b.xPct + b.widthPct);
  const y2 = Math.min(a.yPct + a.heightPct, b.yPct + b.heightPct);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/**
 * Achado ao vivo em produção: o retângulo do headline (textZone) e o retângulo da logo
 * (assetPlacement) se sobrepunham geometricamente no MESMO plano — a caixa semi-opaca do headline
 * cobria parte da logo. A visão flagrou o SINTOMA por 3 rodadas seguidas ("texto sobreposto por
 * fundo escuro"), sempre com a mesma redação vaga, porque nunca sabia DIZER qual zona colide com
 * qual asset — cada `gpt_replan` repetia a mesma colisão, sem instrução acionável pra corrigir.
 * Checagem puramente geométrica (mesmo princípio de `checkSafeAreaCompliance`, sem custo de IA),
 * que nomeia a colisão exata — o diretor recebe uma instrução concreta ("retângulo X sobrepõe
 * retângulo Y") na próxima rodada, em vez de adivinhar a partir de uma descrição vaga.
 * `TEXT_ZONE_OVERLAPS_ASSET` é deliberadamente excluído de `RENDERER_REFLOW_CODES`
 * (`creative-repair.ts`) — reflow só ajusta `fontScale` dentro do MESMO retângulo, nunca reposiciona
 * a zona; só uma nova decisão de geometria (`gpt_replan`) resolve uma colisão de posição real.
 */
export function checkAssetPlacementOverlap(plan: CreativePlan): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];
  for (const zone of plan.textZones) {
    for (const placement of plan.assetPlacements) {
      if (!rectsOverlap(zone.rect, placement.rect)) continue;
      issues.push({
        code: "TEXT_ZONE_OVERLAPS_ASSET",
        message: `Zona de texto "${zone.kind}" (x=${zone.rect.xPct}%-${zone.rect.xPct + zone.rect.widthPct}%, y=${zone.rect.yPct}%-${zone.rect.yPct + zone.rect.heightPct}%) se sobrepõe ao asset "${placement.role}" (x=${placement.rect.xPct}%-${placement.rect.xPct + placement.rect.widthPct}%, y=${placement.rect.yPct}%-${placement.rect.yPct + placement.rect.heightPct}%) — ajuste um dos dois retângulos para eles nunca se tocarem.`,
        source: "safe_area",
      });
    }
  }
  return issues;
}

/**
 * Revisão preventiva (mesmo princípio de `checkAssetPlacementOverlap`, achado ao rever a checagem
 * de colisão geométrica): aquela função só cobre textZone-vs-assetPlacement — nada verificava DUAS
 * zonas de texto se sobrepondo entre si (ex.: headline cobrindo o subheadline). Mesma consequência
 * visual (uma caixa desenhada sobre a outra, texto ilegível) já vista repetidas vezes em produção
 * nesta mesma sessão, só que entre uma textZone e um assetPlacement — o caso simétrico entre duas
 * textZones nunca tinha cobertura. `TEXT_ZONE_OVERLAPS_TEXT_ZONE` deliberadamente fora de
 * `RENDERER_REFLOW_CODES` pelo mesmo motivo: reflow não reposiciona, só uma nova decisão de
 * geometria (`gpt_replan`) resolve.
 */
export function checkTextZoneCollisions(plan: CreativePlan): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];
  for (let i = 0; i < plan.textZones.length; i++) {
    for (let j = i + 1; j < plan.textZones.length; j++) {
      const a = plan.textZones[i];
      const b = plan.textZones[j];
      // Colisão SEMÂNTICA: o texto desenhado (`inkRect`, geometria final do renderer) de cada zona;
      // sem ele, a reserva (`rect`). Uma reserva de coluna maior que o texto, encostando em outra,
      // não é texto sobre texto.
      const rectA = a.inkRect ?? a.rect;
      const rectB = b.inkRect ?? b.rect;
      if (!rectsOverlap(rectA, rectB)) continue;
      const interW = Math.min(rectA.xPct + rectA.widthPct, rectB.xPct + rectB.widthPct) - Math.max(rectA.xPct, rectB.xPct);
      const interH = Math.min(rectA.yPct + rectA.heightPct, rectB.yPct + rectB.heightPct) - Math.max(rectA.yPct, rectB.yPct);
      const intersectionAreaPct2 = Number((Math.max(0, interW) * Math.max(0, interH)).toFixed(4));
      issues.push({
        code: "TEXT_ZONE_OVERLAPS_TEXT_ZONE",
        message: `Zona de texto "${a.kind}" (x=${rectA.xPct}%-${rectA.xPct + rectA.widthPct}%, y=${rectA.yPct}%-${rectA.yPct + rectA.heightPct}%) se sobrepõe à zona de texto "${b.kind}" (x=${rectB.xPct}%-${rectB.xPct + rectB.widthPct}%, y=${rectB.yPct}%-${rectB.yPct + rectB.heightPct}%) — ajuste um dos dois retângulos para eles nunca se tocarem.`,
        source: "safe_area",
        details: {
          issueType: "TEXT_ZONE_OVERLAPS_TEXT_ZONE",
          zoneA: { id: a.kind, type: a.kind, text: a.text, bbox: a.rect, ...(a.inkRect ? { inkBBox: a.inkRect } : {}) },
          zoneB: { id: b.kind, type: b.kind, text: b.text, bbox: b.rect, ...(b.inkRect ? { inkBBox: b.inkRect } : {}) },
          geometry: a.inkRect || b.inkRect ? "ink_bounds" : "layout_reservation",
          intersectionAreaPct2,
          overlapRatioA: rectA.widthPct * rectA.heightPct > 0 ? Number((intersectionAreaPct2 / (rectA.widthPct * rectA.heightPct)).toFixed(4)) : 0,
          overlapRatioB: rectB.widthPct * rectB.heightPct > 0 ? Number((intersectionAreaPct2 / (rectB.widthPct * rectB.heightPct)).toFixed(4)) : 0,
        },
      });
    }
  }
  return issues;
}

/** ETAPA 3.3 (Rodada 4) — "VISUAL TEXT BUDGET" (brief, ponto 16/19): o motor já tenta descartar
 * conteúdo OPCIONAL antes de chegar até aqui (`manage-text-budget.ts`, chamado de
 * `run-gpt-creative-engine.ts`). Quando o `planForGate` (geometria FINAL, já pós-descarte) ainda
 * assim tem uma sobreposição geométrica real E o número de elementos já é alto, o problema de fundo
 * é excesso de conteúdo pro formato — nunca microgerencia "quanto é demais" com uma régua nova,
 * reaproveita os mesmos checks geométricos determinísticos já existentes como sinal de entrada. */
const OVERDENSE_LAYOUT_ELEMENT_THRESHOLD = 5;
const OVERDENSE_LAYOUT_MIN_OVERLAP_AREA_PCT = 18;
const OVERDENSE_LAYOUT_MIN_OCCUPIED_RATIO = 0.48;

function layoutDensitySignals(plan: CreativePlan): { elementCount: number; occupiedAreaRatio: number; overlapArea: number } {
  const rects = [...plan.textZones.map((zone) => zone.rect), ...plan.assetPlacements.map((placement) => placement.rect)];
  let occupiedArea = 0;
  let overlapArea = 0;
  for (let i = 0; i < rects.length; i += 1) {
    occupiedArea += rectArea(rects[i]);
    for (let j = i + 1; j < rects.length; j += 1) {
      overlapArea += rectOverlapArea(rects[i], rects[j]);
    }
  }
  return { elementCount: rects.length, occupiedAreaRatio: occupiedArea / 10_000, overlapArea };
}

export function checkOverdenseLayout(plan: CreativePlan): CreativeQualityIssue[] {
  const hasGeometricOverlap = checkAssetPlacementOverlap(plan).length > 0 || checkTextZoneCollisions(plan).length > 0;
  if (!hasGeometricOverlap) return [];
  const { elementCount, occupiedAreaRatio, overlapArea } = layoutDensitySignals(plan);
  if (elementCount < OVERDENSE_LAYOUT_ELEMENT_THRESHOLD) return [];
  if (overlapArea < OVERDENSE_LAYOUT_MIN_OVERLAP_AREA_PCT && occupiedAreaRatio < OVERDENSE_LAYOUT_MIN_OCCUPIED_RATIO) return [];
  return [
    {
      code: "OVERDENSE_LAYOUT",
      message: `A peça tem ${elementCount} elementos (texto + assets) competindo por espaço e pelo menos uma sobreposição geométrica real, mesmo depois de descartar conteúdo opcional — provável excesso de conteúdo para este formato, não só um ajuste de posição. Reduza o número de elementos (ex.: remova subheadline/badge/URL, ou simplifique o headline) em vez de só tentar reposicionar.`,
      source: "safe_area",
    },
  ];
}

/** Achado ao vivo em produção (cliente real): uma peça saiu com fundo branco e cores
 * ciano/magenta quando a marca tem paleta configurada (preto/grafite + verde + amarelo) —
 * passou pelo gate inteiro "limpa" porque nenhum critério de visão perguntava sobre cor. As
 * cores oficiais só entram no prompt (e no schema pede o campo) quando `brandColors` vem
 * preenchido — sem paleta configurada, a instrução explícita é sempre responder `false`, nunca
 * inventar uma expectativa de cor que a marca não definiu. */
function buildVisualIntegrityPrompt(
  brandColors: readonly string[] | undefined,
  allowedRenderedTexts: readonly string[],
  requiredRenderedFacts: readonly string[],
  options: { withTextRegions?: boolean; colorPolicyInstructions?: readonly string[] } = {},
): string {
  const colorsLine = brandColors && brandColors.length > 0
    ? `Paleta de cores oficial configurada para esta marca: ${brandColors.join(", ")}.`
    : "Nenhuma paleta de cores oficial foi configurada para esta marca.";
  const colorPolicy = options.colorPolicyInstructions?.map((line) => line.trim()).filter(Boolean) ?? [];
  return [
    "Avalie esta peça publicitária JÁ FINALIZADA (a imagem anexada) para defeitos GRAVES apenas — não julgue estética, apenas problemas objetivos que tornariam a peça inaceitável.",
    colorsLine,
    ...(colorPolicy.length > 0
      ? [
          "Politica permanente de cor/estilo deste workspace tambem faz parte da avaliacao de paleta. Se ela permitir explicitamente fundos/superficies preto, grafite, verde muito escuro, azul quase preto, branco, amarelo/dourado ou outros papeis, trate essas opcoes como validas; nao marque violacao so porque a lista curta de cores acima nao cita todos os neutros permitidos.",
          ...colorPolicy.map((line) => `- ${line}`),
        ]
      : []),
    // Auditoria "motor de geração de criativos" — achado ao vivo: um veredito booleano solto
    // ("tem texto inesperado? sim/não") não pegava de forma confiável casos reais óbvios ("TEXTO
    // DE DESTAQUE", "SAIBA MAIS" apareceram na peça e o veredito ainda saiu false). Dar à visão a
    // lista EXATA de textos autorizados e pedir uma TRANSCRIÇÃO OBJETIVA do que está visível —
    // comparada depois em CÓDIGO, nunca só no julgamento subjetivo da IA — é muito mais confiável.
    `LISTA FECHADA DE TEXTOS AUTORIZADOS NESTA PEÇA (a marca/logo colada por composição não conta, veja regra abaixo): ${allowedRenderedTexts.map((text) => `"${text}"`).join(", ")}.`,
    ...(requiredRenderedFacts.length > 0
      ? [
          `FATOS COMERCIAIS CRÍTICOS que o plano desta peça marcou como OBRIGATÓRIOS de aparecer legíveis (preço, parcelamento, desconto etc.) — verifique CADA um com atenção redobrada, é a parte mais importante desta revisão: ${requiredRenderedFacts.map((fact) => `"${fact}"`).join(", ")}.`,
        ]
      : []),
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    options.withTextRegions
      ? '{"productMismatch": true|false, "wrongLogo": true|false, "screenshotMischaracterized": true|false, "textIllegibleOrCut": true|false, "elementCutOff": true|false, "criticalOverlap": true|false, "criticalAssetOccluded": true|false, "compositionBroken": true|false, "colorPaletteViolated": true|false, "unauthorizedTexts": [{"text": "...", "region": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}}], "duplicatedTexts": [{"text": "...", "occurrences": [{"region": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}}]}], "missingRequiredTexts": ["..."], "missingRequiredFacts": ["..."], "reasoning": "1-2 frases objetivas"}'
      : '{"productMismatch": true|false, "wrongLogo": true|false, "screenshotMischaracterized": true|false, "textIllegibleOrCut": true|false, "elementCutOff": true|false, "criticalOverlap": true|false, "criticalAssetOccluded": true|false, "compositionBroken": true|false, "colorPaletteViolated": true|false, "unauthorizedTexts": ["..."], "duplicatedTexts": ["..."], "missingRequiredTexts": ["..."], "missingRequiredFacts": ["..."], "reasoning": "1-2 frases objetivas"}',
    "REGRAS:",
    "- \"productMismatch\": true SOMENTE se havia uma foto de produto real de referência e o produto na peça final é claramente outro produto (nunca marque true sem uma referência real para comparar).",
    "- \"wrongLogo\": true SOMENTE se havia uma logo real de referência e a logo na peça final é visivelmente diferente (cores, proporções, símbolo) — nunca marque true sem uma referência real.",
    "- \"screenshotMischaracterized\": true SOMENTE se havia um screenshot real de referência e a interface mostrada na peça final não corresponde a ele (ex.: uma tela genérica/inventada no lugar do site real).",
    "- \"textIllegibleOrCut\": true se algum texto principal (headline, CTA, preço) está cortado nas bordas, sobreposto de forma ilegível, ou com contraste tão baixo que não dá pra ler.",
    "- \"elementCutOff\": true se qualquer elemento visual importante (produto, logo, dispositivo/mockup) está cortado de forma que perde informação essencial.",
    "- \"criticalOverlap\": true se um elemento comercial (preço, CTA, badge) sobrepõe de forma destrutiva um rosto, o produto principal ou outro elemento essencial.",
    "- \"criticalAssetOccluded\": true se o produto real, a logo real ou o screenshot real estão INTEIROS dentro do canvas (não cortados na borda — isso é `elementCutOff`), mas parcialmente COBERTOS por outro elemento a ponto de perder identidade/legibilidade (ex.: um badge grande desenhado por cima do centro do produto).",
    "- \"compositionBroken\": true se a composição está visivelmente quebrada — elementos deformados, pillarboxing (barras vazias nas laterais), ou artefatos visuais graves.",
    "- \"colorPaletteViolated\": avalie SÓ fundos/superfícies, botões e textos desenhados pela peça — IGNORE as cores do conteúdo de assets reais (screenshot de site/app, foto de produto, logo, fotografia), que são fiéis ao original e nunca podem ser recoloridos. true SOMENTE se uma paleta oficial foi informada acima E a peça final claramente NÃO usa essas cores (ex.: fundo e cores predominantes totalmente diferentes do pedido, nenhuma cor da paleta aparece de forma reconhecível). Sem paleta oficial informada, responda sempre false — nunca microgerencie tom/saturação exatos, só a ausência clara da paleta inteira.",
    options.withTextRegions
      ? "- \"unauthorizedTexts\": liste CADA palavra/frase/rótulo/botão legível na peça que NÃO está na lista de textos autorizados acima — transcreva exatamente como está escrito na imagem, INCLUSIVE texto que pareça nome de marca, wordmark ou logo (o sistema confere em código quais estão dentro da logo oficial ou do screenshot real verificados; não decida isso você). Isso inclui texto da interface dentro de um screenshot/tela de site. Inclua também texto que só difere de um autorizado em MAIÚSCULAS/minúsculas ou pontuação (ex.: botão em caixa alta) — o sistema confere a equivalência e a região em código. Para CADA item informe \"region\": o retângulo aproximado onde o texto aparece, em porcentagem do canvas (xPct/yPct = canto superior esquerdo, widthPct/heightPct = tamanho). NUNCA inclua um FRAGMENTO/LINHA/TRECHO de um texto autorizado — se o texto quebrou em várias linhas na composição, cada linha sozinha NÃO conta como não autorizada. Lista vazia se todo texto visível bate com a lista autorizada."
      : "- \"unauthorizedTexts\": liste CADA palavra/frase/rótulo/botão legível na peça que NÃO está na lista de textos autorizados acima — transcreva exatamente como está escrito na imagem. NUNCA inclua aqui o nome/wordmark que aparece DENTRO da logo colada (isso é a marca real, não texto gerado). NUNCA inclua um FRAGMENTO/LINHA/TRECHO de um texto autorizado — se o texto quebrou em várias linhas na composição (comum quando um texto longo tem que caber numa caixa), cada linha sozinha NÃO conta como não autorizada, só o texto INTEIRO conta como \"bateu\" com a lista. Lista vazia se todo texto visível bate (inteiro ou em fragmentos de um mesmo texto autorizado) com a lista autorizada.",
    "- \"duplicatedTexts\": liste CADA texto autorizado que aparece MAIS DE UMA VEZ na peça final (ex.: o mesmo preço escrito duas vezes em lugares diferentes) — isso nunca é intencional. CONTA TAMBÉM uma ocorrência PARCIALMENTE visível — letras ou palavras de um texto autorizado vazando por trás ou ao redor de um cartão/caixa desenhado por cima, mesmo que a maior parte esteja coberta: se dá pra reconhecer QUE TEXTO é mesmo vendo só um pedaço, conta como uma 2ª ocorrência. Olhe com atenção especial perto das bordas de cartões/caixas de texto e em fundos decorativos/estampados, onde esse vazamento é mais fácil de passar despercebido. Lista vazia só quando cada texto autorizado aparece claramente uma única vez, sem nenhum traço reconhecível dele em outro lugar.",
    ...(options.withTextRegions
      ? ["- Para CADA item de \"duplicatedTexts\" informe \"occurrences\": a região de CADA ocorrência visível desse texto (inclusive dentro de um screenshot/tela de site, da logo ou de um botão), em porcentagem do canvas. O sistema decide em código quais ocorrências são legítimas — não omita nenhuma."]
      : []),
    "- \"missingRequiredTexts\": liste CADA item da lista de textos autorizados que NÃO está legível/visível em nenhum lugar da peça final. Lista vazia se todos apareceram.",
    "- \"missingRequiredFacts\": dos FATOS COMERCIAIS CRÍTICOS listados acima (se houver), liste CADA um que não está claramente legível na peça final — este campo é sobre FATOS COMERCIAIS (preço, parcelamento, desconto), não sobre qualquer texto. Lista vazia se todos os fatos obrigatórios apareceram, ou se nenhum fato crítico foi listado.",
    "- Na dúvida sobre os outros critérios booleanos, prefira false — este gate é para pegar defeitos ÓBVIOS, não para microgerenciar qualidade estética. Mas \"unauthorizedTexts\"/\"missingRequiredTexts\"/\"missingRequiredFacts\" devem ser objetivos e completos: transcreva tudo que você conseguir ler.",
  ].join("\n");
}

const PLACEHOLDER_TEXT_PATTERNS: readonly RegExp[] = [
  /\btexto de destaque\b/i,
  /\bheadline\b/i,
  /\bsubheadline\b/i,
  /\bcall[- ]?to[- ]?action\b/i,
  /\bcta\b/i,
  /\bsome (headline|text)\b/i,
  /\blorem ipsum\b/i,
  /\bplaceholder\b/i,
  /\bsample text\b/i,
  /\byour (text|headline|cta) here\b/i,
  /\b(seu|sua) (texto|headline|cta) aqui\b/i,
];

/** Achado ao vivo em produção: um texto não autorizado que segue um padrão de PLACEHOLDER/rótulo
 * técnico (ex.: literalmente "TEXTO DE DESTAQUE", "SOME HEADLINE TEXT") indica uma causa
 * diferente de um slogan decorativo qualquer — o modelo confundiu um NOME DE CAMPO do próprio
 * `creative_plan` com conteúdo a desenhar. Classificar separado (`PLACEHOLDER_RENDERED` vs
 * `UNAUTHORIZED_TEXT`) dá ao diretor uma instrução de reparo mais específica. */
function isPlaceholderLikeText(text: string): boolean {
  return PLACEHOLDER_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

const COLOR_POLICY_PATTERN = /\b(?:cor|cores|paleta|fundo|background|superf[ií]cie|preto|grafite|verde|amarelo|dourado|branco|azul|neon|escuro|claro|contraste)\b/i;

function extractColorPolicyInstructions(context: CreativeContext): string[] {
  return [context.productionInstructions, ...(context.behaviorPreferences ?? [])]
    .flatMap((line) => (line ?? "").split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && COLOR_POLICY_PATTERN.test(line));
}

const DARK_SURFACE_POLICY_RE = /base\s+predominante\s+fundo\s+(?:preto|grafite|verde muito escuro|azul quase preto)|use\s+como\s+base\s+predominante\s+fundo\s+(?:preto|grafite|verde muito escuro|azul quase preto)/i;
const LIGHT_SURFACE_POLICY_RE = /fundo\s+(?:claro|branco|clean|limpo)|base\s+predominante\s+(?:clara|branca)|no_dark_backgrounds/i;
const SITE_DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\.br\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;
const SITE_VISIBLE_POLICY_RE = /\b(?:site|endere[cç]o|dom[ií]nio|url|acessar|acesse)\b/i;
const SITE_VISIBLE_MIN_TEXT_AREA_PCT = 0.12;

function productionInstructionsText(context: CreativeContext): string {
  return [context.productionInstructions, ...(context.behaviorPreferences ?? [])].filter(Boolean).join("\n");
}

export type AuthorizedSiteDomain = {
  domain: string;
  source: "productionInstructions" | "behaviorPreferences";
  sourceField: string;
  sourceId: string;
  requirement: "SITE_VISIBLE";
};

export function resolveAuthorizedSiteDomain(context: CreativeContext): AuthorizedSiteDomain | undefined {
  const sources = [
    ...(context.productionInstructions ? [{ source: "productionInstructions" as const, sourceField: "productionInstructions", text: context.productionInstructions }] : []),
    ...(context.behaviorPreferences ?? []).map((text, index) => ({ source: "behaviorPreferences" as const, sourceField: `behaviorPreferences[${index}]`, text })),
  ];
  for (const item of sources) {
    if (!SITE_VISIBLE_POLICY_RE.test(item.text)) continue;
    const rawDomain = item.text.match(SITE_DOMAIN_RE)?.[0];
    if (!rawDomain) continue;
    const domain = rawDomain.toLowerCase().replace(/[.,;:!?)]$/g, "");
    return {
      domain,
      source: item.source,
      sourceField: item.sourceField,
      sourceId: `${item.source}:${item.sourceField}:SITE_VISIBLE:${domain}`,
      requirement: "SITE_VISIBLE",
    };
  }
  return undefined;
}

export function resolveRendererPaletteCompliance(
  context: CreativeContext,
  input: { pageTone?: "light" | "dark"; pageColor?: string; rendererPaletteApplied?: boolean },
): RendererPaletteCompliance {
  const policy = productionInstructionsText(context);
  const forbidsDarkBackgrounds = context.brandIdentity?.identity.forbiddenPatterns?.includes("NO_DARK_BACKGROUNDS") === true;
  const requiresLightSurface = LIGHT_SURFACE_POLICY_RE.test(policy) || forbidsDarkBackgrounds;
  if (requiresLightSurface) {
    if (input.pageTone === "light") {
      return {
        result: "PASS",
        source: "RENDERER",
        rule: forbidsDarkBackgrounds ? "brand_profile_forbids_dark_backgrounds" : "production_instructions_allow_light_surface",
        expected: "light",
        actual: input.pageColor ?? "light",
        offendingRegion: "renderer_page_surface",
        pixelCoverage: 1,
        ownership: "RENDERER",
        reason: "Superficie principal controlada pelo renderer segue a politica persistida de fundo claro.",
      };
    }
    if (input.pageTone === "dark") {
      return {
        result: "FAIL",
        source: "RENDERER",
        rule: forbidsDarkBackgrounds ? "brand_profile_forbids_dark_backgrounds" : "production_instructions_allow_light_surface",
        expected: "light",
        actual: input.pageColor ?? "dark",
        offendingColor: input.pageColor ?? "dark_surface",
        offendingRegion: "renderer_page_surface",
        pixelCoverage: 1,
        ownership: "RENDERER",
        reason: "Superficie principal controlada pelo renderer ficou escura apesar da politica persistida exigir/permitir apenas fundo claro.",
      };
    }
  }
  if (!DARK_SURFACE_POLICY_RE.test(policy)) {
    if (input.rendererPaletteApplied) {
      return { result: "PASS", source: "RENDERER", rule: "renderer_brand_palette_applied", actual: input.pageColor ?? input.pageTone, ownership: "RENDERER", reason: "Renderer registrou aplicacao deterministica dos tokens de paleta da marca." };
    }
    return { result: "NOT_APPLICABLE", source: "RENDERER", rule: "no_explicit_renderer_surface_policy", reason: "Sem regra persistida verificavel para a superficie do renderer." };
  }
  if (input.pageTone === "dark") {
    return {
      result: "PASS",
      source: "RENDERER",
      rule: "production_instructions_require_dark_primary_surface",
      expected: "preto/grafite/verde muito escuro/azul quase preto",
      actual: input.pageColor ?? "dark",
      offendingRegion: "renderer_page_surface",
      pixelCoverage: 1,
      ownership: "RENDERER",
      reason: "Superficie principal controlada pelo renderer segue a politica escura persistida.",
    };
  }
  return {
    result: "FAIL",
    source: "RENDERER",
    rule: "production_instructions_require_dark_primary_surface",
    expected: "preto/grafite/verde muito escuro/azul quase preto",
    actual: input.pageColor ?? input.pageTone ?? "unknown",
    offendingColor: input.pageColor ?? "light_surface",
    offendingRegion: "renderer_page_surface",
    pixelCoverage: 1,
    ownership: "RENDERER",
    reason: "Superficie principal controlada pelo renderer ficou clara apesar da politica persistida exigir base escura.",
  };
}

function rectVisibleAreaPct(rect: CreativePlanRect | undefined): number {
  return rect ? Number(((rect.widthPct * rect.heightPct) / 100).toFixed(3)) : 0;
}

function domainFromProductionInstructions(context: CreativeContext): string | undefined {
  return resolveAuthorizedSiteDomain(context)?.domain;
}

export function evaluateProductionRequirementsDeterministically(context: CreativeContext, plan: CreativePlan): ProductionRequirementDiagnostic[] {
  const diagnostics: ProductionRequirementDiagnostic[] = [];
  const instructionItems = [
    ...(context.productionInstructions ? [{ source: "productionInstructions" as const, text: context.productionInstructions }] : []),
    ...(context.behaviorPreferences ?? []).map((text) => ({ source: "behaviorPreferences" as const, text })),
  ];
  const instructions = instructionItems.map((item) => item.text).join("\n");
  const logo = plan.assetPlacements.find((placement) => placement.role === "logo");
  const ctaZone = plan.textZones.find((zone) => zone.kind === "cta" && zone.text.trim());
  const domainEvidence = resolveAuthorizedSiteDomain(context);
  const domain = domainEvidence?.domain ?? domainFromProductionInstructions(context);
  const domainPattern = domain ? new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : undefined;
  const urlZone = domainPattern ? plan.textZones.find((zone) => domainPattern.test(zone.text) && rectVisibleAreaPct(zone.rect) >= SITE_VISIBLE_MIN_TEXT_AREA_PCT) : undefined;
  const texts = urlZone?.text ?? "";

  if (/logo vis[ií]vel|utilize sempre a logo oficial|mantenha logo/i.test(instructions)) {
    const matched = instructionItems.find((item) => /logo vis[ií]vel|utilize sempre a logo oficial|mantenha logo/i.test(item.text));
    const area = rectVisibleAreaPct(logo?.rect);
    const pass = Boolean(logo && area >= 0.25);
    diagnostics.push({
      guidelineSource: matched?.source ?? "inferred",
      guidelineText: matched?.text ?? "Utilize sempre a logo oficial; mantenha logo dentro de area segura.",
      requirementType: "BRAND_VISIBLE",
      severity: "required",
      result: pass ? "PASS" : "FAIL",
      geometryEvidence: { areaPct: area, bbox: logo?.rect },
      adjudication: pass ? "DETERMINISTIC_PASS" : "DETERMINISTIC_FAIL",
      finalReason: pass ? "Logo oficial presente na geometria final." : "Logo oficial ausente ou pequena demais para cumprir presenca minima.",
    });
  }

  if (/CTA precisa ser identificado rapidamente|CTA vis[ií]vel|bot[aã]o ou chamada/i.test(instructions)) {
    const matched = instructionItems.find((item) => /CTA precisa ser identificado rapidamente|CTA vis[ií]vel|bot[aã]o ou chamada/i.test(item.text));
    const pass = Boolean(ctaZone && rectVisibleAreaPct(ctaZone.rect) >= 0.5);
    diagnostics.push({
      guidelineSource: matched?.source ?? "inferred",
      guidelineText: matched?.text ?? "O CTA precisa ser identificado rapidamente.",
      requirementType: "CTA_VISIBLE",
      severity: "required",
      result: pass ? "PASS" : "FAIL",
      geometryEvidence: { areaPct: rectVisibleAreaPct(ctaZone?.rect), bbox: ctaZone?.rect, text: ctaZone?.text },
      adjudication: pass ? "DETERMINISTIC_PASS" : "DETERMINISTIC_FAIL",
      finalReason: pass ? "CTA tem zona renderizada mensuravel." : "CTA ausente ou sem proeminencia minima.",
    });
  }

  if (domain && SITE_VISIBLE_POLICY_RE.test(instructions)) {
    const matched = instructionItems.find((item) => SITE_VISIBLE_POLICY_RE.test(item.text) && item.text.toLowerCase().includes(domain));
    const hasDomain = new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(texts);
    diagnostics.push({
      guidelineSource: matched?.source ?? "inferred",
      guidelineText: matched?.text ?? `O usuario deve entender que deve acessar ${domain}; quando o endereco for exigido, ele deve ter destaque claro.`,
      requirementType: "SITE_VISIBLE",
      severity: "required",
      result: hasDomain ? "PASS" : "FAIL",
      geometryEvidence: { domain, domainSource: domainEvidence?.source, sourceField: domainEvidence?.sourceField, rendererZone: urlZone?.kind, urlZone: urlZone?.rect, textIncludesDomain: hasDomain, minAreaPct: SITE_VISIBLE_MIN_TEXT_AREA_PCT, areaPct: rectVisibleAreaPct(urlZone?.rect) },
      adjudication: hasDomain ? "DETERMINISTIC_PASS" : "DETERMINISTIC_FAIL",
      finalReason: hasDomain ? "Dominio autorizado presente no texto renderizado/planejado." : "Dominio autorizado ausente dos textos finais da peca.",
    });
  }

  return diagnostics;
}

/** Chamada de visão best-effort, UMA chamada cobrindo todos os critérios juntos (deliberadamente
 * mais barato que o motor legado, que faz 1 chamada por critério) — falha ou resposta ilegível
 * nunca reprova por conta própria, só um veredito EXPLÍCITO de defeito grave gera issue. */
export async function checkCreativeVisualIntegrity(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    finalImageWidth?: number;
    finalImageHeight?: number;
    referenceProductImageUrl?: string;
    referenceLogoUrl?: string;
    referenceScreenshotUrl?: string;
    specialistId: string;
    brandColors?: readonly string[];
    /** Permanent color/style policy from the persisted run snapshot (productionInstructions). */
    colorPolicyInstructions?: readonly string[];
    /** Paleta das superficies controladas pelo renderer, decidida fora da visao final. */
    rendererPaletteCompliance?: RendererPaletteCompliance;
    /** Brand Profile: o renderer determinístico COMPROVOU ter aplicado a paleta estruturada da marca
     * em todas as superfícies que desenha (fundo, destaque/CTA). Fato determinístico vence a visão:
     * o veredito de paleta da visão vira diagnóstico, não reprovação (ela julga a imagem inteira,
     * inclusive screenshot/produto reais, cujas cores nunca podem ser alteradas). */
    brandPaletteRenderedDeterministically?: boolean;
    /** Diagnóstico de paleta quando a visão discorda de uma paleta comprovadamente aplicada. */
    paletteDiagnostics?: PaletteDiagnostic[];
    allowedRenderedTexts: readonly string[];
    /** Rodada 4 (benchmark de qualidade criativa) — ver `CreativePlan.requiredRenderedFacts`.
     * Lista vazia (plano sem fatos obrigatórios, ou plano antigo) nunca gera checagem extra. */
    requiredRenderedFacts: readonly string[];
    /** Regiões FINAIS de logos oficiais verificadas (`resolveVerifiedLogoRegions`). Quando presentes,
     * a visão devolve a região de cada texto não autorizado e o código isenta só o que cai dentro. */
    verifiedLogoRegions?: readonly CreativePlanRect[];
    onVerifiedLogoTextExempted?: (exempted: { text: string; region: CreativePlanRect }) => void;
    /** Textos na geometria FINAL do renderer (modo editorial com prova em pixel). Ativa a
     * autorização regional: equivalência normalizada SÓ dentro da bbox da própria zona. */
    renderedTextRegions?: readonly CreativeRenderedTextRegion[];
    /** Regiões FINAIS do screenshot real verificado (`resolveVerifiedScreenshotRegions`). */
    verifiedScreenshotRegions?: readonly CreativePlanRect[];
    /** Regiões FINAIS do produto real verificado (`resolveVerifiedProductRegions`). */
    verifiedProductRegions?: readonly CreativePlanRect[];
    /** Coletor do diagnóstico sanitizado de cada texto reportado pela visão. */
    textDiagnostics?: CreativeTextDiagnostic[];
    /** Coletor do diagnóstico de cada ocorrência de texto repetido. */
    occurrenceDiagnostics?: CreativeTextOccurrenceDiagnostic[];
    /** Textos lidos na IMAGEM BASE (antes do renderer), quando houver diagnóstico. Uma frase presente
     * na base nunca entra na regra de alta confiança — a base pode ter gerado aquela ocorrência. */
    baseImageTexts?: readonly string[];
    /** Ledger de proveniência textual (renderer + assets + base) — reconcilia contagem de duplicatas. */
    textProvenanceLedger?: TextProvenanceLedger;
    /** Inventário de texto do screenshot verificado, já validado (`resolveUsableScreenshotInventory`). */
    screenshotInventory?: UsableScreenshotInventory;
    /** Inventário de texto da logo verificada, já validado (`resolveUsableLogoInventory`). */
    logoInventory?: UsableScreenshotInventory;
    /** Auditoria de custo — achado crítico: esta chamada de visão nunca entrava em NENHUM total
     * de custo do motor antes desta correção (`run-gpt-creative-engine.ts` só rastreava
     * plano/imagem). Opcional e best-effort, mesmo espírito do resto da função — nunca lançar por
     * causa disto. */
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<CreativeQualityIssue[]> {
  try {
    const referenceUrls = [input.referenceProductImageUrl, input.referenceLogoUrl, input.referenceScreenshotUrl].filter(
      (url): url is string => Boolean(url),
    );
    const imageUrls = [...referenceUrls, input.finalImageUrl];
    const withTextRegions = (input.verifiedLogoRegions?.length ?? 0) > 0 || (input.renderedTextRegions?.length ?? 0) > 0 || (input.verifiedScreenshotRegions?.length ?? 0) > 0;
    // `?? []` — mesma tolerância de `allowedRenderedTexts` ausente em planos antigos/fixtures de
    // teste: nunca lançar por um campo novo e opcional faltando, só significa "nenhum fato crítico
    // declarado nesta peça".
    const response = await icaro.request({
      taskType: "review",
      prompt: buildVisualIntegrityPrompt(input.brandColors, input.allowedRenderedTexts, input.requiredRenderedFacts ?? [], { withTextRegions, colorPolicyInstructions: input.colorPolicyInstructions }),
      specialistId: input.specialistId,
      imageUrls,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: withTextRegions ? 800 : 400,
      timeoutMs: 25_000,
    });
    input.onCost?.(response);

    if (response.status !== "completed") return [];
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Creative Quality Gate")) as {
      productMismatch?: unknown;
      wrongLogo?: unknown;
      screenshotMischaracterized?: unknown;
      textIllegibleOrCut?: unknown;
      elementCutOff?: unknown;
      criticalOverlap?: unknown;
      criticalAssetOccluded?: unknown;
      compositionBroken?: unknown;
      colorPaletteViolated?: unknown;
      unauthorizedTexts?: unknown;
      duplicatedTexts?: unknown;
      missingRequiredTexts?: unknown;
      missingRequiredFacts?: unknown;
      reasoning?: unknown;
    };
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    const issues: CreativeQualityIssue[] = [];
    // Achado ao vivo em produção (mesma classe de bug já corrigida pra `colorPaletteViolated`):
    // a REGRA do prompt já diz "só marque true se havia uma referência real" (`productMismatch`/
    // `wrongLogo`/`screenshotMischaracterized`), mas nada no CÓDIGO garantia isso — sem nenhum
    // screenshot real cadastrado, o modelo mesmo assim marcou `screenshotMischaracterized: true`
    // (alucinação, ou só não seguiu a instrução), gastando uma rodada de reparo numa correção sem
    // problema real pra corrigir. Confiar só no prompt pra isso nunca é garantia — cada critério
    // só reprova quando a referência correspondente de fato existe.
    if (parsed.productMismatch === true && input.referenceProductImageUrl) {
      issues.push({ code: "PRODUCT_MISMATCH", message: reasoning ?? "O produto na peça final não corresponde à foto de referência.", source: "vision" });
    }
    if (parsed.wrongLogo === true && input.referenceLogoUrl) {
      issues.push({ code: "WRONG_LOGO", message: reasoning ?? "A logo na peça final não corresponde à logo real de referência.", source: "vision" });
    }
    if (parsed.screenshotMischaracterized === true && input.referenceScreenshotUrl) {
      issues.push({ code: "SCREENSHOT_MISCHARACTERIZED", message: reasoning ?? "A interface mostrada não corresponde ao screenshot real de referência.", source: "vision" });
    }
    // TEXT_ILLEGIBLE_OR_CUT/ELEMENT_CUT_OFF vindos daqui NUNCA são renderer_reflow-elegíveis —
    // ver `CreativeQualityIssue.source` e `routeCreativeRepair`. A visão não sabe se o trecho
    // ilegível foi desenhado pelo renderer ou pelo modelo de imagem; reflow só ajusta o primeiro.
    if (parsed.textIllegibleOrCut === true) issues.push({ code: "TEXT_ILLEGIBLE_OR_CUT", message: reasoning ?? "Texto principal ilegível ou cortado.", source: "vision" });
    if (parsed.elementCutOff === true) issues.push({ code: "ELEMENT_CUT_OFF", message: reasoning ?? "Elemento visual importante cortado, perdendo informação essencial.", source: "vision" });
    if (parsed.criticalOverlap === true) issues.push({ code: "CRITICAL_OVERLAP", message: reasoning ?? "Elemento comercial sobrepõe destrutivamente rosto/produto/outro elemento essencial.", source: "vision" });
    // ETAPA 3 (Rodada 4) — distinto de ELEMENT_CUT_OFF (borda do canvas): aqui o elemento está
    // inteiro, só coberto por outro elemento desenhado por cima.
    if (parsed.criticalAssetOccluded === true) issues.push({ code: "CRITICAL_ASSET_OCCLUDED", message: reasoning ?? "Produto/logo/screenshot real está coberto por outro elemento, perdendo identidade/legibilidade.", source: "vision" });
    if (parsed.compositionBroken === true) issues.push({ code: "COMPOSITION_BROKEN", message: reasoning ?? "Composição visivelmente quebrada.", source: "vision" });
    // Garantia no CÓDIGO, nunca só na instrução do prompt — sem paleta configurada, um "true"
    // vindo da IA (alucinação, ou simplesmente não seguiu a instrução) nunca reprova por conta
    // própria, mesmo que a peça já teste isso deliberadamente.
    const hasBrandColors = Boolean(input.brandColors && input.brandColors.length > 0);
    if (hasBrandColors && parsed.colorPaletteViolated === true && input.rendererPaletteCompliance?.result === "PASS") {
      input.paletteDiagnostics?.push({ decision: "VISION_COLOR_CONTRADICTION", visionReasoning: reasoning, rendererPaletteCompliance: input.rendererPaletteCompliance });
    } else if (hasBrandColors && parsed.colorPaletteViolated === true && input.brandPaletteRenderedDeterministically) {
      input.paletteDiagnostics?.push({ decision: "VISION_PALETTE_OVERRIDDEN_BY_RENDERER", visionReasoning: reasoning });
    } else if (hasBrandColors && parsed.colorPaletteViolated === true) {
      issues.push({ code: "COLOR_PALETTE_VIOLATED", message: reasoning ?? "A peça final não usa a paleta de cores oficial configurada para a marca.", source: "vision" });
    }
    // Auditoria "motor de geração de criativos" — achado ao vivo: o modelo de imagem inventou
    // texto que não foi pedido em lugar nenhum ("TEXTO DE DESTAQUE", "SAIBA MAIS"), e um veredito
    // booleano solto ("tem texto inesperado?") não pegava isso de forma confiável — a mesma peça
    // com esse defeito óbvio às vezes recebia `false`. Comparar a TRANSCRIÇÃO da visão contra
    // `allowedRenderedTexts` (a fonte de verdade do plano) EM CÓDIGO, nunca só confiar no
    // julgamento livre da IA, é o que torna isto um hard failure objetivo de verdade.
    const authorizedZoneTexts = new Set<string>();
    if (Array.isArray(parsed.unauthorizedTexts)) {
      const verifiedLogoRegions = input.verifiedLogoRegions ?? [];
      const renderedTextRegions = input.renderedTextRegions ?? [];
      const imageSize = { width: input.finalImageWidth, height: input.finalImageHeight };
      const allDetections = parsed.unauthorizedTexts.map((raw) => parseDetectedText(raw, imageSize));
      // Textos repetidos que a visão reportou e que NÃO se resolvem como ocorrências legítimas.
      const unresolvedDuplicates = new Set<string>();
      if (Array.isArray(parsed.duplicatedTexts)) {
        parsed.duplicatedTexts.forEach((raw, index) => {
          const prepassRegions = { renderedTextRegions, verifiedLogoRegions, verifiedScreenshotRegions: input.verifiedScreenshotRegions ?? [] };
          const resolved = resolveDuplicateOccurrences(raw, index, prepassRegions, { inventory: input.screenshotInventory, ledger: input.textProvenanceLedger });
          const decision = resolved ? applyVisionZoneContradiction(resolved, prepassRegions, input.textProvenanceLedger) : undefined;
          if (decision && !decision.legitimate) unresolvedDuplicates.add(normalizeRenderedText(decision.text));
        });
      }
      const baseTexts = (input.baseImageTexts ?? []).map((text) => normalizeRenderedText(text));
      // Inventário do screenshot: leituras DENTRO da região verificada consomem primeiro o orçamento
      // de ocorrências de cada texto; leituras fora dela só usam o que sobrar.
      const screenshotRegionsForBudget = input.verifiedScreenshotRegions ?? [];
      const inventoryInRegion = new Map<string, number>();
      const inventoryOutOfRegionUsed = new Map<string, number>();
      const logoInventoryUsed = new Map<string, number>();
      if (input.screenshotInventory && screenshotRegionsForBudget.length > 0) {
        for (const candidate of allDetections) {
          if (!candidate?.region || matchRenderedTextRegion(candidate, renderedTextRegions)) continue;
          if (verifiedLogoRegions.length > 0 && isTextRegionInsideVerifiedLogo(candidate.region, verifiedLogoRegions)) continue;
          if (!isTextRegionInsideVerifiedLogo(candidate.region, screenshotRegionsForBudget)) continue;
          const key = normalizeRenderedText(candidate.text);
          inventoryInRegion.set(key, (inventoryInRegion.get(key) ?? 0) + 1);
        }
      }
      let detectionIndex = -1;
      let pendingHighConfidence: (Partial<CreativeTextDiagnostic> & { failures: string[] }) | undefined;
      for (const raw of parsed.unauthorizedTexts) {
        detectionIndex += 1;
        const detected = parseDetectedText(raw, imageSize);
        if (!detected) continue;
        const item = detected.text;
        const normalizedDetected = normalizeRenderedText(item);
        // Autorização REGIONAL decidida em código (nunca pelo julgamento da visão): texto
        // equivalente (caixa/espaço/pontuação, nunca acento) DENTRO da bbox final da zona que o
        // renderer desenhou — ex.: CTA em caixa alta, ou a marca dentro do próprio CTA.
        const zone = matchRenderedTextRegion(detected, renderedTextRegions);
        if (zone) {
          authorizedZoneTexts.add(normalizeRenderedText(zone.text));
          input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: zone.kind, normalizedExpected: normalizeRenderedText(zone.text), normalizedDetected, decision: "authorized", reason: `equivalente dentro da bbox final da zona ${zone.kind}` });
          continue;
        }
        // Alta confiança para texto DETERMINÍSTICO do renderer (jitter da visão): texto inteiro
        // equivalente + exatamente uma zona desse texto no manifesto final + nenhuma outra
        // ocorrência equivalente reportada + base sem a frase + perto pela faixa de jitter.
        const candidates = detected.region ? renderedTextRegions.filter((candidate) => normalizeRenderedText(candidate.text) === normalizedDetected) : [];
        if (detected.region && candidates.length >= 1) {
          const expectedZone = candidates[0]!;
          // Piso da faixa = resolução da visão, só com base escaneada (AVAILABLE) e sem a frase.
          const ledgerBaseClean = input.textProvenanceLedger?.baseTextStatus === "AVAILABLE"
            && !input.textProvenanceLedger.entries.some((entry) => entry.sourceType === "BASE_IMAGE" && entry.normalizedText !== undefined && entry.normalizedText.includes(normalizedDetected));
          const proximity = measureRenderedTextProximity(detected.region, expectedZone.rect, ledgerBaseClean ? VISION_BBOX_RESOLUTION_PCT : 0);
          const otherEquivalent = allDetections.some((other, otherIndex) => otherIndex !== detectionIndex && other !== undefined && normalizeRenderedText(other.text) === normalizedDetected);
          const baseHasPhrase = baseTexts.some((text) => text.includes(normalizedDetected));
          // Ordem: perto pela faixa proporcional original (86a9f25) → casamento direto; senão, bbox
          // DENTRO de outra zona do renderer com texto diferente (base limpa, sem asset soberano) →
          // contradição de zona (autoriza o texto, nunca prova presença de texto obrigatório); senão,
          // perto pelo piso de resolução da visão. As demais travas valem em todos os casos.
          const strictlyNear = measureRenderedTextProximity(detected.region, expectedZone.rect).near;
          const contradiction = strictlyNear ? undefined : findContradictingRendererZone(detected.region, normalizedDetected, { renderedTextRegions, verifiedLogoRegions, verifiedScreenshotRegions: input.verifiedScreenshotRegions ?? [] }, input.textProvenanceLedger);
          const failures = [
            candidates.length !== 1 ? "manifesto final tem mais de uma zona com esse texto" : undefined,
            otherEquivalent ? "visão reportou outra ocorrência equivalente" : undefined,
            unresolvedDuplicates.has(normalizedDetected) ? "texto também reportado como duplicata não resolvida" : undefined,
            baseHasPhrase ? "a imagem base já contém a frase" : undefined,
            !proximity.near && !contradiction ? `bbox longe da zona final (centro a ${proximity.centerDistance} pt; faixa ${proximity.band} pt; ${Math.round(proximity.insideBand * 100)}% dentro da faixa)` : undefined,
          ].filter((reason): reason is string => Boolean(reason));
          const diagnosticBase = {
            detectedText: item,
            ...bboxDiagnostic(detected),
            normalizedExpected: normalizeRenderedText(expectedZone.text),
            normalizedDetected,
            occurrenceId: `text-${detectionIndex}`,
            expectedRole: expectedZone.kind,
            expectedBBox: expectedZone.rect,
            overlap: proximity.overlap,
            centerDistance: proximity.centerDistance,
            toleranceApplied: proximity.band,
          };
          if (failures.length === 0) {
            // Contradição de zona só retira a acusação de texto solto; nunca prova presença de texto
            // obrigatório que a própria visão disse estar ausente.
            if (!contradiction) authorizedZoneTexts.add(normalizedDetected);
            input.textDiagnostics?.push({
              ...diagnosticBase,
              matchedElement: expectedZone.kind,
              decision: "authorized",
              matchDecision: contradiction ? "VISION_ZONE_CONTRADICTION" : `MATCHED_RENDERED_${expectedZone.kind.toUpperCase()}`,
              reason: contradiction
                ? `detected_text_conflicts_with_verified_${contradiction.kind}_zone_base_clean_single_${expectedZone.kind}_origin`
                : `exact_text_single_occurrence_${input.baseImageTexts ? "base_clean" : "no_second_occurrence_in_final"}_spatially_near`,
              ...(contradiction
                ? { conflictingRendererRole: contradiction.kind, conflictingRendererText: normalizeRenderedText(contradiction.text), conflictingRendererBBox: contradiction.rect, baseTextScanStatus: "AVAILABLE" as const, baseContainsDetectedText: false }
                : {}),
            });
            continue;
          }
          // Não casou na alta confiança: segue para logo/screenshot/rejeição com o motivo registrado.
          pendingHighConfidence = { ...diagnosticBase, failures };
        } else {
          pendingHighConfidence = undefined;
        }
        // Isenção ESPACIAL da logo oficial verificada (proveniência + pixel). Mesmo texto fora dela,
        // ou sem região informada, continua reprovando.
        if (detected.region && verifiedLogoRegions.length > 0 && isTextRegionInsideVerifiedLogo(detected.region, verifiedLogoRegions)) {
          input.onVerifiedLogoTextExempted?.({ text: item, region: detected.region });
          input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: "logo", normalizedDetected, decision: "authorized", reason: "dentro da bbox final da logo oficial verificada (proveniência + pixel)" });
          continue;
        }
        // Texto do PRÓPRIO arquivo da logo (tagline/slogan — inventário VERIFIED_LOGO, Smoke 1
        // execution-mv4ljbf3-5zfacb): autoriza só a leitura que cai sobre a logo verificada ou junto
        // dela pela faixa com piso na resolução da visão; orçamento = ocorrências no(s) arquivo(s) de
        // logo desenhado(s); nunca quando a base escaneada contém o texto. Fora da logo: rejeitado.
        let logoInventoryRejection: string | undefined;
        if (detected.region && input.logoInventory && verifiedLogoRegions.length > 0) {
          const logoMatch = matchScreenshotInventoryText(normalizedDetected, input.logoInventory);
          if (logoMatch) {
            const nearLogo = verifiedLogoRegions.find((rect) => isTextRegionInsideVerifiedLogo(detected.region!, [rect]) || measureRenderedTextProximity(detected.region!, rect, VISION_BBOX_RESOLUTION_PCT).near);
            const used = logoInventoryUsed.get(normalizedDetected) ?? 0;
            const baseHas = baseScanContains(input.textProvenanceLedger, normalizedDetected);
            const baseScanAvailable = input.textProvenanceLedger?.baseTextStatus === "AVAILABLE";
            const rendererHasText = renderedTextRegions.some((region) => normalizeRenderedText(region.text) === normalizedDetected || normalizeRenderedText(region.text).includes(normalizedDetected));
            const otherEquivalent = allDetections.some((other, otherIndex) => otherIndex !== detectionIndex && other !== undefined && normalizeRenderedText(other.text) === normalizedDetected);
            if (nearLogo && !baseHas && used < logoMatch.budget) {
              logoInventoryUsed.set(normalizedDetected, used + 1);
              const proximity = measureRenderedTextProximity(detected.region, nearLogo, VISION_BBOX_RESOLUTION_PCT);
              input.onVerifiedLogoTextExempted?.({ text: item, region: detected.region });
              input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: "logo", normalizedDetected, decision: "authorized", matchDecision: "MATCHED_VERIFIED_LOGO_TEXT", expectedRole: "logo", expectedBBox: nearLogo, overlap: proximity.overlap, centerDistance: proximity.centerDistance, toleranceApplied: proximity.band, reason: `texto do próprio arquivo da logo verificada (VERIFIED_LOGO_TEXT, ${logoMatch.budget} ocorrência(s); sha256 ${input.logoInventory.assetSha256.slice(0, 12)}…), sobre/junto da logo desenhada` });
              continue;
            }
            if (!nearLogo && baseScanAvailable && !baseHas && !rendererHasText && !otherEquivalent && !unresolvedDuplicates.has(normalizedDetected) && used < logoMatch.budget) {
              logoInventoryUsed.set(normalizedDetected, used + 1);
              const logoRegion = verifiedLogoRegions[0]!;
              const proximity = measureRenderedTextProximity(detected.region, logoRegion, VISION_BBOX_RESOLUTION_PCT);
              input.onVerifiedLogoTextExempted?.({ text: item, region: detected.region });
              input.textDiagnostics?.push({
                detectedText: item,
                ...bboxDiagnostic(detected),
                matchedElement: "logo",
                normalizedDetected,
                decision: "authorized",
                matchDecision: "VISION_BBOX_CONTRADICTION",
                expectedRole: "logo",
                expectedBBox: logoRegion,
                overlap: proximity.overlap,
                centerDistance: proximity.centerDistance,
                toleranceApplied: proximity.band,
                baseTextScanStatus: "AVAILABLE",
                baseContainsDetectedText: false,
                reason: `VISION_BBOX_CONTRADICTION: texto existe no inventário da logo verificada (${logoMatch.budget} ocorrência(s); sha256 ${input.logoInventory.assetSha256.slice(0, 12)}…), a logo foi renderizada com bbox determinística e a base/renderer não contêm a frase; bbox da visão incompatível registrada como diagnóstico`,
              });
              continue;
            }
            logoInventoryRejection = !nearLogo
              ? "texto da logo oficial, mas FORA da região da logo desenhada e sem condições suficientes para VISION_BBOX_CONTRADICTION"
              : baseHas
                ? "texto da logo oficial, mas a imagem base escaneada também contém o texto"
                : `texto da logo oficial, mas orçamento esgotado (${logoMatch.budget} ocorrência(s) no arquivo da logo)`;
          }
        }
        // Logo verificada x resolução da visão (cenário A 9:16 execution-mv2ifqf0-vtl4ov: logo com 2,4%
        // de altura, bbox da visão na grade de 5 pt fora da regra estrita). Só o literal EXATO da marca
        // registrado no ledger, uma única leitura, base escaneada e sem o texto, perto da logo pela
        // faixa com piso na resolução da visão.
        const logoLedger = input.textProvenanceLedger;
        const brandLiteral = logoLedger?.entries.some((entry) => entry.sourceType === "LOGO_ASSET" && (entry.alternatives ?? []).includes(normalizedDetected)) ?? false;
        if (detected.region && brandLiteral && verifiedLogoRegions.length > 0 && logoLedger?.baseTextStatus === "AVAILABLE") {
          const baseHasBrand = logoLedger.entries.some((entry) => entry.sourceType === "BASE_IMAGE" && entry.normalizedText !== undefined && entry.normalizedText.includes(normalizedDetected));
          const otherReading = allDetections.some((other, otherIndex) => otherIndex !== detectionIndex && other !== undefined && normalizeRenderedText(other.text) === normalizedDetected);
          const nearLogo = verifiedLogoRegions.find((rect) => measureRenderedTextProximity(detected.region!, rect, VISION_BBOX_RESOLUTION_PCT).near);
          if (nearLogo && !baseHasBrand && !otherReading && !unresolvedDuplicates.has(normalizedDetected)) {
            const proximity = measureRenderedTextProximity(detected.region, nearLogo, VISION_BBOX_RESOLUTION_PCT);
            input.onVerifiedLogoTextExempted?.({ text: item, region: detected.region });
            input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: "logo", normalizedDetected, decision: "authorized", matchDecision: "MATCHED_VERIFIED_LOGO", expectedRole: "logo", expectedBBox: nearLogo, overlap: proximity.overlap, centerDistance: proximity.centerDistance, toleranceApplied: proximity.band, reason: "brand_literal_single_reading_base_clean_near_verified_logo_within_vision_resolution" });
            continue;
          }
        }
        // Texto impresso no PRÓPRIO produto real verificado (proveniência + pixel): só dentro da região
        // final do produto; fora dela continua rejeitado.
        const verifiedProductRegions = input.verifiedProductRegions ?? [];
        if (detected.region && verifiedProductRegions.length > 0 && isTextRegionInsideVerifiedLogo(detected.region, verifiedProductRegions)) {
          input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: "product_photo", normalizedDetected, decision: "authorized", matchDecision: "MATCHED_VERIFIED_PRODUCT_REGION", reason: "texto impresso no produto real verificado (dentro da região final do produto; proveniência + pixel) — nunca fato comercial" });
          continue;
        }
        const verifiedScreenshotRegions = input.verifiedScreenshotRegions ?? [];
        const inventoryMatch = input.screenshotInventory ? matchScreenshotInventoryText(normalizedDetected, input.screenshotInventory) : undefined;
        const insideScreenshot = Boolean(detected.region && verifiedScreenshotRegions.length > 0 && isTextRegionInsideVerifiedLogo(detected.region, verifiedScreenshotRegions));
        if (insideScreenshot && (!input.screenshotInventory || inventoryMatch)) {
          input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: "screenshot", normalizedDetected, decision: "authorized", ...(inventoryMatch ? { matchDecision: "MATCHED_VERIFIED_SCREENSHOT_REGION" } : {}), reason: inventoryMatch ? `dentro da bbox final do screenshot real verificado e presente no inventário do screenshot (${inventoryMatch.budget} ocorrência(s))` : "dentro da bbox final do screenshot real verificado (proveniência + pixel)" });
          continue;
        }
        // Inventário do screenshot verificado (depois da região e da proveniência determinística):
        // texto que EXISTE no screenshot, bbox da visão fora dele. Orçamento de ocorrências; nunca
        // quando a base escaneada contém o texto; nunca prova presença de texto obrigatório.
        let inventoryRejection: string | undefined;
        if (!insideScreenshot && inventoryMatch && input.screenshotInventory) {
          const inRegion = inventoryInRegion.get(normalizedDetected) ?? 0;
          const used = inventoryOutOfRegionUsed.get(normalizedDetected) ?? 0;
          const baseHas = baseScanContains(input.textProvenanceLedger, normalizedDetected);
          if (!baseHas && inRegion + used < inventoryMatch.budget) {
            inventoryOutOfRegionUsed.set(normalizedDetected, used + 1);
            input.textDiagnostics?.push({ detectedText: item, ...bboxDiagnostic(detected), matchedElement: "screenshot", normalizedDetected, decision: "authorized", matchDecision: "MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY", reason: `texto existe no inventário do screenshot verificado (${inventoryMatch.budget} ocorrência(s); ${inRegion + used + 1}ª usada; sha256 ${input.screenshotInventory.assetSha256.slice(0, 12)}…); posição da visão ${detected.region ? "fora da região do screenshot" : "não informada"}` });
            continue;
          }
          inventoryRejection = baseHas ? "a imagem base escaneada contém o texto — o inventário do screenshot não o absorve" : `orçamento do inventário do screenshot esgotado (${inventoryMatch.budget} ocorrência(s) no screenshot)`;
        }
        const equivalentZone = renderedTextRegions.find((candidate) => {
          const expected = normalizeRenderedText(candidate.text);
          return expected === normalizedDetected || (normalizedDetected.length > 0 && expected.includes(normalizedDetected));
        });
        input.textDiagnostics?.push({
          detectedText: item,
          ...bboxDiagnostic(detected),
          normalizedExpected: equivalentZone ? normalizeRenderedText(equivalentZone.text) : undefined,
          normalizedDetected,
          decision: "rejected",
          reason: logoInventoryRejection
            ? logoInventoryRejection
            : insideScreenshot
            ? "dentro da bbox do screenshot, mas o texto não existe no inventário do screenshot verificado"
            : inventoryRejection
              ? `texto do screenshot verificado, mas ${inventoryRejection}`
            : !detected.region
            ? "sem região informada pela visão — sem prova espacial"
            : pendingHighConfidence
              ? `equivalente à zona ${pendingHighConfidence.expectedRole}, mas sem casamento de alta confiança: ${pendingHighConfidence.failures.join("; ")}`
              : equivalentZone
                ? `equivalente à zona ${equivalentZone.kind}, mas FORA da sua bbox final`
                : "fora de qualquer zona autorizada e da logo verificada",
          ...(pendingHighConfidence ? { occurrenceId: pendingHighConfidence.occurrenceId, expectedRole: pendingHighConfidence.expectedRole, expectedBBox: pendingHighConfidence.expectedBBox, overlap: pendingHighConfidence.overlap, centerDistance: pendingHighConfidence.centerDistance, toleranceApplied: pendingHighConfidence.toleranceApplied, matchDecision: "REJECTED" } : {}),
        });
        const placeholder = isPlaceholderLikeText(item);
        const lastDiagnostic = input.textDiagnostics?.at(-1);
        issues.push({
          details: {
            issueType: placeholder ? "PLACEHOLDER_RENDERED" : "UNAUTHORIZED_TEXT",
            detectedText: item,
            ...(detected.region ? { bbox: detected.region } : {}),
            ...(detected.rawBbox ? { rawBbox: detected.rawBbox } : {}),
            ...(detected.rawCoordinateSystem ? { rawCoordinateSystem: detected.rawCoordinateSystem } : {}),
            ...(detected.normalizedBboxPercent ? { normalizedBboxPercent: detected.normalizedBboxPercent } : {}),
            textSource: "UNVERIFIED",
            adjudication: "rejected",
            ...(lastDiagnostic?.reason ? { reason: lastDiagnostic.reason } : {}),
            ...(input.logoInventory ? { logoInventoryAssetSha256: input.logoInventory.assetSha256 } : {}),
          },
          code: placeholder ? "PLACEHOLDER_RENDERED" : "UNAUTHORIZED_TEXT",
          message: placeholder
            ? `A peça contém um placeholder/rótulo técnico renderizado como texto real: "${item}" — isso é nome de campo do plano, nunca conteúdo visual. Remova e substitua pelo texto autorizado correspondente.`
            : `A peça contém texto não autorizado: "${item}" — não está na lista de textos permitidos do plano. Remova completamente.`,
          source: "vision",
        });
      }
    }
    // ETAPA 3 (Rodada 4) — defesa em profundidade: a maioria dos casos de texto fantasma é
    // neutralizada ANTES da composição final (ver `applySafeAreaAdjustments`,
    // `run-gpt-creative-engine.ts`); quando isso falha, o texto fantasma aparece aqui como o MESMO
    // texto repetido (uma vez do modelo, uma vez do renderer por cima) — `DUPLICATED_TEXT` cobre
    // esse caso residual, nunca intencional.
    if (Array.isArray(parsed.duplicatedTexts)) {
      parsed.duplicatedTexts.forEach((raw, itemIndex) => {
        const duplicateRegions = {
          renderedTextRegions: input.renderedTextRegions ?? [],
          verifiedLogoRegions: input.verifiedLogoRegions ?? [],
          verifiedScreenshotRegions: input.verifiedScreenshotRegions ?? [],
        };
        const resolved = resolveDuplicateOccurrences(raw, itemIndex, duplicateRegions, { inventory: input.screenshotInventory, ledger: input.textProvenanceLedger });
        if (!resolved) return;
        const decision = applyVisionZoneContradiction(resolved, duplicateRegions, input.textProvenanceLedger);
        let ledgerReason: string | undefined;
        if (!decision.legitimate) {
          const rawCount = typeof raw === "object" && raw !== null && Array.isArray((raw as { occurrences?: unknown }).occurrences) ? Math.max(2, (raw as { occurrences: unknown[] }).occurrences.length) : 2;
          // Ocorrências contraditórias saem da contagem; o resto segue a regra do ledger.
          const reported = decision.contradictions > 0 ? decision.remainingCount : rawCount;
          const ledgerDecision = reconcileOccurrencesWithLedger(normalizeRenderedText(decision.text), reported, input.textProvenanceLedger);
          if (ledgerDecision.reconciled) {
            input.occurrenceDiagnostics?.push(...decision.occurrences.map((occurrence) => (occurrence.ignoredForDuplicateCount ? occurrence : { ...occurrence, decision: "allowed" as const, reason: `${ledgerDecision.reason} (posição da visão: ${occurrence.reason})` })));
            return;
          }
          ledgerReason = ledgerDecision.reason;
          input.occurrenceDiagnostics?.push(...decision.occurrences.map((occurrence) => (occurrence.decision === "rejected" ? { ...occurrence, reason: `${occurrence.reason}; ledger: ${ledgerDecision.reason}` } : occurrence)));
        } else {
          input.occurrenceDiagnostics?.push(...decision.occurrences);
          return;
        }
        issues.push({
          code: "DUPLICATED_TEXT",
          message: `O texto "${decision.text}" aparece mais de uma vez na peça final — provável texto fantasma do modelo de imagem não neutralizado antes da composição do renderer. Remova a duplicata.${decision.rejectedReason ? ` (${decision.rejectedReason})` : ""}${ledgerReason ? ` [ledger: ${ledgerReason}]` : ""}`,
          source: "vision",
        });
      });
    }
    if (Array.isArray(parsed.missingRequiredTexts)) {
      for (const item of parsed.missingRequiredTexts) {
        if (typeof item !== "string" || !item.trim()) continue;
        // Contradição da própria visão: o texto "ausente" foi transcrito, equivalente, dentro da
        // bbox final da sua zona (ex.: CTA desenhado em caixa alta) — não é ausência.
        if (authorizedZoneTexts.has(normalizeRenderedText(item))) {
          input.textDiagnostics?.push({ detectedText: item, normalizedExpected: normalizeRenderedText(item), normalizedDetected: normalizeRenderedText(item), decision: "missing_reconciled", reason: "equivalente encontrado dentro da bbox final da sua zona" });
          continue;
        }
        input.textDiagnostics?.push({ detectedText: item, normalizedExpected: normalizeRenderedText(item), normalizedDetected: "", decision: "missing", reason: "visão não encontrou o texto autorizado" });
        issues.push({
          code: "MISSING_REQUIRED_TEXT",
          message: `O texto autorizado "${item}" não está visível/legível na peça final — inclua-o exatamente como definido no plano.`,
          source: "vision",
        });
      }
    }
    // Rodada 4 (benchmark de qualidade criativa) — hard failure dedicado: um fato comercial que o
    // PRÓPRIO plano marcou como obrigatório (`requiredRenderedFacts`) e que não apareceu na peça
    // final nunca pode publicar, mesmo que o resto da peça esteja tecnicamente correto. Código
    // distinto de `MISSING_REQUIRED_TEXT` (que trata todo texto autorizado com peso igual) —
    // achado confirmado no benchmark: um preço com textZone própria saiu ausente sem reprovação.
    if (Array.isArray(parsed.missingRequiredFacts)) {
      for (const item of parsed.missingRequiredFacts) {
        if (typeof item !== "string" || !item.trim()) continue;
        issues.push({
          code: "REQUIRED_FACT_MISSING",
          message: `O fato comercial obrigatório "${item}" (marcado por este plano como necessário) não está legível na peça final — nunca publicar sem ele.`,
          source: "vision",
        });
      }
    }
    return issues;
  } catch {
    return [];
  }
}

const PRODUCTION_GUIDELINES_PROMPT_HEADER = [
  "Você é um revisor de conformidade de marca. Um workspace configurou instruções PERMANENTES e OBRIGATÓRIAS que toda peça gerada precisa respeitar — abaixo estão essas instruções e o conteúdo de texto real da peça que acabou de ser planejada.",
  "Sua ÚNICA tarefa é dizer se o conteúdo da peça contraria alguma dessas instruções de forma CLARA e CONCRETA (nunca microgerencie estilo, tom ou gosto subjetivo — só violações objetivas: uma regra explícita que a peça claramente descumpre).",
  "Responda APENAS com JSON válido, sem markdown, no formato exato:",
  '{"violatesGuidelines": true|false, "reasoning": "1-2 frases objetivas citando a instrução violada e onde"}',
  "Na dúvida, responda false — este check é para pegar descumprimentos óbvios de uma regra explícita, nunca para reescrever a peça a seu critério.",
].join("\n");

/**
 * Reforço da migração "Prompt Persistente de Produção": até aqui, `productionInstructions`/
 * `behaviorPreferences` (ver `build-creative-context.ts`) chegavam ao GPT diretor só como texto
 * de prioridade 2 — o próprio modelo decidia sozinho se "respeitava" ou não, sem nenhuma
 * verificação automática depois. Achado ao vivo: uma peça pode passar o gate inteiro mesmo
 * ignorando claramente uma diretriz configurada, porque nenhum dos checks anteriores olha para
 * `productionInstructions`. Best-effort e determinadamente conservador (só reprova em violação
 * ÓBVIA e concreta, nunca gosto/estilo) — mesmo espírito de `checkCreativeVisualIntegrity`: uma
 * falha ou resposta ilegível do juiz NUNCA reprova por conta própria, só um veredito EXPLÍCITO.
 * Sem nenhuma diretriz configurada (`productionInstructions`/`behaviorPreferences` ambos vazios),
 * não há nada pra violar — retorna `[]` sem gastar a chamada.
 */
export async function checkProductionGuidelinesCompliance(
  icaro: IcaroBrainPort,
  input: {
    context: CreativeContext;
    plan: CreativePlan;
    specialistId: string;
    deterministicDiagnostics?: readonly ProductionRequirementDiagnostic[];
    onCost?: (response: IcaroAIResponse | undefined) => void;
  },
): Promise<CreativeQualityIssue[]> {
  const guidelines = [input.context.productionInstructions?.trim(), ...(input.context.behaviorPreferences ?? [])].filter(
    (line): line is string => Boolean(line && line.trim()),
  );
  if (guidelines.length === 0) return [];

  const pieceTexts = [input.plan.headline, input.plan.subheadline, input.plan.cta, input.plan.title, input.plan.description, ...input.plan.textZones.map((zone) => zone.text)].filter(
    (text): text is string => Boolean(text?.trim()),
  );
  if (pieceTexts.length === 0) return [];

  try {
    const prompt = [
      PRODUCTION_GUIDELINES_PROMPT_HEADER,
      "",
      "INSTRUÇÕES PERMANENTES DESTE WORKSPACE:",
      ...guidelines.map((line) => `- ${line}`),
      "",
      "CONTEÚDO DE TEXTO REAL DA PEÇA PLANEJADA:",
      ...pieceTexts.map((text) => `- ${text}`),
    ].join("\n");

    const response = await icaro.request({
      taskType: "review",
      prompt,
      specialistId: input.specialistId,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: 300,
      timeoutMs: 20_000,
    });
    input.onCost?.(response);

    if (response.status !== "completed") return [];
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Production Guidelines Compliance")) as {
      violatesGuidelines?: unknown;
      reasoning?: unknown;
    };
    if (parsed.violatesGuidelines !== true) return [];
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    const deterministicDiagnostics = input.deterministicDiagnostics ?? [];
    const deterministicFailures = deterministicDiagnostics.filter((item) => item.result === "FAIL");
    if (deterministicDiagnostics.length > 0 && deterministicFailures.length === 0) {
      deterministicDiagnostics.forEach((item) => {
        item.visionReasoning = reasoning;
        item.adjudication = "VISION_GUIDELINE_CONTRADICTION";
        item.finalReason = "Requisito verificavel foi satisfeito deterministicamente; a visao discordou de forma generica.";
      });
      return [];
    }
    return [
      {
        code: "PRODUCTION_GUIDELINES_VIOLATED",
        details: {
          issueType: "PRODUCTION_REQUIREMENTS",
          sourceEvaluator: "production_guidelines_vision",
          rawVisionReason: reasoning,
          deterministicEvidence: deterministicDiagnostics,
          adjudication: deterministicFailures.length > 0 ? "DETERMINISTIC_FAIL" : "VISION_CONFIRMED_FAILURE",
          finalReason: deterministicFailures.length > 0 ? deterministicFailures.map((item) => item.finalReason).join("; ") : reasoning,
        },
        message: reasoning ?? "A peça contraria uma instrução permanente configurada para este workspace.",
      },
    ];
  } catch {
    return [];
  }
}

export function combineCreativeQualityIssues(...groups: CreativeQualityIssue[][]): CreativeQualityGateResult {
  const issues = groups.flat();
  return { verdict: issues.length > 0 ? "fail" : "pass", issues };
}

/** Orquestra as três camadas (determinística + fatos comerciais + visão) — ponto único de
 * entrada usado por `run-gpt-creative-engine.ts`. Nunca produz um score — só `pass`/`fail` e a
 * lista de motivos, para nunca redirecionar a direção de arte do GPT. */
export async function evaluateCreativeQualityGate(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    finalImageWidth: number;
    finalImageHeight: number;
    expectedAspectRatio: string;
    compositedAssetRoles: CreativePlanAssetRole[];
    context: CreativeContext;
    plan: CreativePlan;
    specialistId: string;
    nonPublishableSource?: boolean;
    /** Auditoria de custo — repassado para as duas chamadas de visão internas, ver
     * `checkCreativeVisualIntegrity`/`checkProductionGuidelinesCompliance`. */
    onCost?: (response: IcaroAIResponse | undefined) => void;
    assetPixelEvidence?: readonly CreativeAssetPixelEvidence[];
    /** Recebe cada texto isentado por estar DENTRO de uma logo oficial verificada (auditoria). */
    onVerifiedLogoTextExempted?: (exempted: { text: string; region: CreativePlanRect }) => void;
    /** Textos lidos na imagem base, quando houver diagnóstico (ver `checkCreativeVisualIntegrity`). */
    baseImageTexts?: readonly string[];
    /** Diagnóstico de texto da base editorial (`scanEditorialBaseText`). */
    baseTextDiagnostic?: CreativeBaseTextEvidence;
    /** Brand Profile: paleta estruturada aplicada deterministicamente pelo renderer (ver `checkCreativeVisualIntegrity`). */
    brandPaletteRenderedDeterministically?: boolean;
    /** Conformidade deterministica dos tokens/superficie que pertencem ao renderer. */
    rendererPaletteCompliance?: RendererPaletteCompliance;
    /** SCREENSHOT_TEXT_INVENTORY do screenshot desta peça (ver `screenshot-text-inventory.ts`). */
    screenshotTextInventory?: ScreenshotTextInventory;
    /** Inventário(s) de texto da(s) logo(s) oficial(is) desenhada(s) nesta peça. */
    logoTextInventories?: readonly ScreenshotTextInventory[];
    /** Dono da execução — o inventário só vale se for do MESMO tenant/workspace. */
    ownership?: { tenantId: string; workspaceId: string };
  },
): Promise<CreativeQualityGateResult> {
  const deterministicIssues = evaluateDeterministicCreativeChecks({
    finalImageWidth: input.finalImageWidth,
    finalImageHeight: input.finalImageHeight,
    expectedAspectRatio: input.expectedAspectRatio,
    compositedAssetRoles: input.compositedAssetRoles,
    contextAssetRoles: input.context.assets.map((asset) => asset.role),
    nonPublishableSource: input.nonPublishableSource,
    assetPixelEvidence: input.assetPixelEvidence,
  });

  const commercialFactIssues = checkCommercialFactIntegrity(input.plan, input.context);
  const safeAreaIssues = checkSafeAreaCompliance(input.plan);
  const assetSafeAreaIssues = checkAssetSafeAreaCompliance(input.plan);
  const assetPlacementOverlapIssues = checkAssetPlacementOverlap(input.plan);
  const textZoneCollisionIssues = checkTextZoneCollisions(input.plan);
  const overdenseLayoutIssues = checkOverdenseLayout(input.plan);

  const referenceProductImageUrl = input.context.assets.find((asset) => asset.role === "product_photo")?.url;
  const referenceLogoUrl = input.context.assets.find((asset) => asset.role === "logo")?.url;
  const referenceScreenshotUrl = input.context.assets.find((asset) => asset.role === "screenshot")?.url;
  const textDiagnostics: CreativeTextDiagnostic[] = [];
  const occurrenceDiagnostics: CreativeTextOccurrenceDiagnostic[] = [];
  const paletteDiagnostics: NonNullable<CreativeQualityGateResult["paletteDiagnostics"]> = [];
  const rendererPaletteCompliance = input.rendererPaletteCompliance ?? resolveRendererPaletteCompliance(input.context, {});
  const rendererPaletteIssues: CreativeQualityIssue[] = rendererPaletteCompliance.result === "FAIL"
    ? [{
        code: "COLOR_PALETTE_VIOLATED",
        message: rendererPaletteCompliance.reason,
        details: {
          issueType: "COLOR_COMPLIANCE",
          sourceEvaluator: "renderer_palette_compliance",
          rawVisionReason: undefined,
          deterministicEvidence: rendererPaletteCompliance,
          adjudication: "DETERMINISTIC_FAIL",
          finalReason: rendererPaletteCompliance.reason,
        },
      }]
    : [];
  if (rendererPaletteCompliance.result === "FAIL") {
    paletteDiagnostics.push({ decision: "DETERMINISTIC_COLOR_FAILURE", rendererPaletteCompliance });
  }
  const productionRequirementDiagnostics = evaluateProductionRequirementsDeterministically(input.context, input.plan);
  const productionRequirementIssues: CreativeQualityIssue[] = productionRequirementDiagnostics
    .filter((item) => item.result === "FAIL")
    .map((item) => ({
      code: "PRODUCTION_GUIDELINES_VIOLATED",
      message: item.finalReason,
      details: {
        issueType: "PRODUCTION_REQUIREMENTS",
        sourceEvaluator: "deterministic_production_requirements",
        guidelineText: item.guidelineText,
        requirementType: item.requirementType,
        geometryEvidence: item.geometryEvidence,
        adjudication: item.adjudication,
        finalReason: item.finalReason,
      },
    }));
  const verifiedLogoRegions = resolveVerifiedLogoRegions({ plan: input.plan, context: input.context, compositedAssetRoles: input.compositedAssetRoles, assetPixelEvidence: input.assetPixelEvidence });
  const verifiedScreenshotRegions = resolveVerifiedScreenshotRegions({ plan: input.plan, context: input.context, compositedAssetRoles: input.compositedAssetRoles, assetPixelEvidence: input.assetPixelEvidence });
  const screenshotInventoryDecision = resolveUsableScreenshotInventory({ inventory: input.screenshotTextInventory, ownership: input.ownership, context: input.context, verifiedScreenshotRegions });
  const screenshotInventory = screenshotInventoryDecision.usable;
  const verifiedProductRegions = resolveVerifiedProductRegions({ plan: input.plan, context: input.context, compositedAssetRoles: input.compositedAssetRoles, assetPixelEvidence: input.assetPixelEvidence });
  const logoInventoryDecision = resolveUsableLogoInventory({ inventories: input.logoTextInventories, ownership: input.ownership, context: input.context, plan: input.plan, verifiedLogoRegions });
  const logoInventory = logoInventoryDecision.usable;
  const renderedTextRegions = input.assetPixelEvidence ? input.plan.textZones.map((zone) => ({ kind: zone.kind, text: zone.text, rect: zone.rect })) : undefined;
  const textProvenanceLedger = input.assetPixelEvidence
    ? buildTextProvenanceLedger({ plan: input.plan, context: input.context, renderedTextRegions, verifiedLogoRegions, verifiedScreenshotRegions, baseText: input.baseTextDiagnostic, ...(screenshotInventory ? { screenshotInventory } : {}), ...(logoInventory ? { logoInventory } : {}) })
    : undefined;
  const baseImageTexts = input.baseImageTexts ?? (input.baseTextDiagnostic?.status === "AVAILABLE" ? input.baseTextDiagnostic.texts.map((item) => item.text) : undefined);
  const visualIssues = await checkCreativeVisualIntegrity(icaro, {
    finalImageUrl: input.finalImageUrl,
    finalImageWidth: input.finalImageWidth,
    finalImageHeight: input.finalImageHeight,
    referenceProductImageUrl,
    referenceLogoUrl,
    referenceScreenshotUrl,
    specialistId: input.specialistId,
    brandColors: input.context.brandColors,
    colorPolicyInstructions: extractColorPolicyInstructions(input.context),
    rendererPaletteCompliance,
    brandPaletteRenderedDeterministically: input.brandPaletteRenderedDeterministically,
    paletteDiagnostics,
    allowedRenderedTexts: input.plan.allowedRenderedTexts,
    requiredRenderedFacts: input.plan.requiredRenderedFacts,
    verifiedLogoRegions,
    onVerifiedLogoTextExempted: input.onVerifiedLogoTextExempted,
    // Só com prova em pixel (modo editorial) as textZones do plano são a geometria FINAL renderizada.
    ...(renderedTextRegions ? { renderedTextRegions } : {}),
    verifiedScreenshotRegions,
    textDiagnostics,
    occurrenceDiagnostics,
    baseImageTexts,
    textProvenanceLedger,
    ...(screenshotInventory ? { screenshotInventory } : {}),
    ...(logoInventory ? { logoInventory } : {}),
    ...(verifiedProductRegions.length > 0 ? { verifiedProductRegions } : {}),
    onCost: input.onCost,
  });
  const productionGuidelinesIssues = await checkProductionGuidelinesCompliance(icaro, {
    context: input.context,
    plan: input.plan,
    specialistId: input.specialistId,
    deterministicDiagnostics: productionRequirementDiagnostics,
    onCost: input.onCost,
  });

  const result = combineCreativeQualityIssues(
    deterministicIssues,
    commercialFactIssues,
    safeAreaIssues,
    assetSafeAreaIssues,
    assetPlacementOverlapIssues,
    textZoneCollisionIssues,
    overdenseLayoutIssues,
    rendererPaletteIssues,
    visualIssues,
    productionRequirementIssues,
    productionGuidelinesIssues,
  );
  return {
    ...result,
    ...(textDiagnostics.length > 0 ? { textDiagnostics } : {}),
    ...(occurrenceDiagnostics.length > 0 ? { occurrenceDiagnostics } : {}),
    ...(paletteDiagnostics.length > 0 ? { paletteDiagnostics } : {}),
    ...(rendererPaletteCompliance.result !== "NOT_APPLICABLE" ? { rendererPaletteCompliance } : {}),
    ...(productionRequirementDiagnostics.length > 0 ? { productionRequirementDiagnostics } : {}),
    ...(textProvenanceLedger ? { textProvenanceLedger } : {}),
    ...(screenshotInventoryDecision.status !== "ABSENT" ? { screenshotInventoryDecision: { status: screenshotInventoryDecision.status, reason: screenshotInventoryDecision.reason } } : {}),
    ...(logoInventoryDecision.status !== "ABSENT" ? { logoInventoryDecision: { status: logoInventoryDecision.status, reason: logoInventoryDecision.reason } } : {}),
  };
}
