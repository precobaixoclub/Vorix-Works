/**
 * Protótipo Paralelo — GPT/OpenAI como motor criativo principal (validação isolada, ver
 * `scripts/run-gpt-creative-prototype.mjs`). Tipos puros do `creative_context` (entrada
 * consolidada) e do `creative_plan` (saída estruturada do GPT) — nenhuma lógica de IA aqui, só
 * formas de dado e o parser tolerante da resposta.
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002. Este módulo é
 * DELIBERADAMENTE separado do motor atual (`ad-layout.types.ts`, `layout-family-rules.ts` etc.) —
 * o protótipo não reaproveita a árvore de regras de layout, só os guardrails de fidelidade
 * factual (Reference Intelligence, Product Asset Pipeline) e a técnica de composição
 * determinística (logo/screenshot).
 */

export const CREATIVE_PLAN_ASSET_ROLES = ["product_photo", "screenshot", "logo", "reference_style", "other"] as const;
export type CreativePlanAssetRole = (typeof CREATIVE_PLAN_ASSET_ROLES)[number];

export type CreativeContextAsset = {
  url: string;
  /** Papel do asset já DECIDIDO por quem monta o contexto (nunca pelo GPT) — "produto real,
   * preservar", "screenshot real do site, usar fielmente", "logo obrigatória", "referência de
   * estilo apenas". O GPT recebe isso como fato, não como algo a inferir sozinho. */
  role: CreativePlanAssetRole;
  description: string;
};

/** Uma peça recente já aprovada do mesmo workspace — memória editorial, pra o GPT evitar repetir
 * headline/CTA/conceito visual recentes (nunca um dado factual, só contexto de variedade). */
export type CreativeContextHistoryEntry = {
  headline?: string;
  cta?: string;
  visualConcept?: string;
};

export type CreativeContext = {
  brandName: string;
  objective: string;
  channel: string;
  /** Proporção/formato final, ex.: "4:5", "9:16", "1:1". */
  format: string;
  ideaText: string;
  assets: CreativeContextAsset[];
  /** Fatos comerciais já confirmados (preço, desconto, URL, etc.) — nunca inventados; lista vazia
   * = nenhum fato comercial disponível, e o `creative_plan` não deve inventar nenhum. */
  confirmedFacts: string[];
  brandColors?: string[];
  /** Elementos que o usuário pediu explicitamente para NÃO aparecer (ex.: "não usar 'Comente
   * QUERO'") — repassado ao GPT como restrição literal, nunca reinterpretado. */
  forbiddenElements?: string[];
  /** Público-alvo já definido pela marca (quando disponível) — o GPT ainda pode refinar dentro
   * do `creative_plan` (`targetAudience`), mas nunca inventa um público do zero se este já existe. */
  audience?: string;
  /** Posicionamento de marca (Clara `BrandContext.positioning`, quando disponível). */
  brandPositioning?: string;
  /** Descrição do negócio (Clara `BusinessContext.description`, quando disponível). */
  businessDescription?: string;
  productsOrServices?: string[];
  /** Notas de identidade visual (tipografia, estilo, personalidade da marca) — nunca uma decisão
   * de layout, só contexto para a direção de arte do GPT. */
  visualIdentityNotes?: string;
  /** Últimas peças aprovadas do workspace — ver `CreativeContextHistoryEntry`. */
  recentHistory?: CreativeContextHistoryEntry[];
};

export const VISUAL_DENSITIES_GPT_PLAN = ["clean", "balanced", "dense"] as const;
export type CreativePlanVisualDensity = (typeof VISUAL_DENSITIES_GPT_PLAN)[number];

/** Retângulo em percentual do canvas final (0-100), nunca pixel absoluto — a mesma peça pode
 * sair em tamanhos nativos diferentes (ver `resolveOpenAiImageSize`) e ser cortada depois
 * (`aspect-ratio-crop.ts`); percentual sobrevive a ambos sem recálculo. */
export type CreativePlanRect = { xPct: number; yPct: number; widthPct: number; heightPct: number };

export const CREATIVE_PLAN_ASSET_FRAMES = ["phone", "laptop", "none"] as const;
export type CreativePlanAssetFrame = (typeof CREATIVE_PLAN_ASSET_FRAMES)[number];

/** Geometria de UM asset real (produto/screenshot/logo) decidida ANTES da geração — o compositor
 * determinístico (`screenshot-mockup-compositor.ts`/`logo-compositor.ts`) usa este retângulo
 * exato, nunca um percentual fixo desconectado do que o plano realmente pediu ao modelo. */
export type CreativePlanAssetPlacement = {
  role: CreativePlanAssetRole;
  /** Mesma chave de `CreativeContext.assets[].url` — liga o placement ao asset real. */
  url: string;
  rect: CreativePlanRect;
  frame?: CreativePlanAssetFrame;
  treatment?: string;
};

export const CREATIVE_PLAN_TEXT_ZONE_KINDS = ["headline", "subheadline", "cta", "price", "discount", "url", "badge"] as const;
export type CreativePlanTextZoneKind = (typeof CREATIVE_PLAN_TEXT_ZONE_KINDS)[number];

export const CREATIVE_PLAN_TEXT_ZONE_EMPHASIS = ["primary", "secondary"] as const;
export type CreativePlanTextZoneEmphasis = (typeof CREATIVE_PLAN_TEXT_ZONE_EMPHASIS)[number];

export const CREATIVE_PLAN_TEXT_ZONE_RENDERERS = ["image_model", "renderer"] as const;
export type CreativePlanTextZoneRenderer = (typeof CREATIVE_PLAN_TEXT_ZONE_RENDERERS)[number];

/** Uma zona de texto do plano — `renderedBy: "renderer"` é executada pelo compositor
 * determinístico (`render-creative-plan-text-zones.ts`, Satori+sharp, legibilidade perfeita);
 * `renderedBy: "image_model"` é desenhada pelo próprio modelo de imagem dentro da cena. O
 * renderer NUNCA decide qual dos dois — só executa o que o plano já decidiu. */
export type CreativePlanTextZone = {
  kind: CreativePlanTextZoneKind;
  text: string;
  rect: CreativePlanRect;
  emphasis: CreativePlanTextZoneEmphasis;
  renderedBy: CreativePlanTextZoneRenderer;
};

export type CreativePlan = {
  objective: string;
  angle: string;
  targetAudience: string;
  /** Título curto para a tela de revisão do usuário — nunca o headline desenhado na imagem
   * (esse é `headline`). */
  title: string;
  /** Descrição/legenda da peça — texto pronto para a tela de revisão do usuário. */
  description: string;
  headline: string;
  subheadline?: string;
  cta: string;
  visualDirection: string;
  compositionIntent: string;
  /** Para cada asset (por `url`, mesma chave do `CreativeContext.assets`), como o plano quer que
   * ele apareça na peça final — eco do papel já decidido, nunca uma reinterpretação. */
  assetUsage: Record<string, string>;
  /** Geometria de cada asset real que será colado por composição determinística — ver
   * `CreativePlanAssetPlacement`. Lista vazia = nenhum asset com posição definida ainda (o
   * prompt de imagem cai para a instrução genérica de "deixar espaço", ver
   * `buildImageGenerationPromptFromPlan`). */
  assetPlacements: CreativePlanAssetPlacement[];
  /** Zonas de texto decididas pelo plano — ver `CreativePlanTextZone`. */
  textZones: CreativePlanTextZone[];
  requiredElements: string[];
  forbiddenElements: string[];
  visualDensity: CreativePlanVisualDensity;
  styleNotes: string;
  rationale: string;
};

export const CREATIVE_PLAN_RESPONSE_SCHEMA_HINT =
  '{"objective": "...", "angle": "...", "targetAudience": "...", "title": "...", "description": "...", ' +
  '"headline": "...", "subheadline": "...", ' +
  '"cta": "...", "visualDirection": "...", "compositionIntent": "...", "assetUsage": {"<url>": "..."}, ' +
  '"assetPlacements": [{"role": "product_photo"|"screenshot"|"logo"|"reference_style"|"other", "url": "...", ' +
  '"rect": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}, "frame": "phone"|"laptop"|"none", "treatment": "..."}], ' +
  '"textZones": [{"kind": "headline"|"subheadline"|"cta"|"price"|"discount"|"url"|"badge", "text": "...", ' +
  '"rect": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}, "emphasis": "primary"|"secondary", "renderedBy": "image_model"|"renderer"}], ' +
  '"requiredElements": ["..."], "forbiddenElements": ["..."], "visualDensity": "clean"|"balanced"|"dense", ' +
  '"styleNotes": "...", "rationale": "..."}';

function describeAsset(asset: CreativeContextAsset): string {
  const roleLabel: Record<CreativePlanAssetRole, string> = {
    product_photo: "PRODUTO REAL — preserve fielmente, nunca substitua por um produto genérico ou reimaginado.",
    screenshot: "SCREENSHOT REAL DO SITE/APP — deve ser usado fielmente (será colado por composição determinística depois, não redesenhado por você).",
    logo: "LOGO OFICIAL DA MARCA — obrigatória na peça, cores/proporções/identidade preservadas (também colada por composição determinística).",
    reference_style: "REFERÊNCIA DE ESTILO — inspiração visual apenas, não precisa ser reproduzida literalmente.",
    other: "Asset de apoio — use com bom senso.",
  };
  return `- ${asset.url}: ${roleLabel[asset.role]} ${asset.description}`.trim();
}

/**
 * Monta o prompt enviado ao GPT para produzir o `creative_plan` — instrui explicitamente o papel
 * de cada asset (nunca deixa o modelo adivinhar) e proíbe inventar fato comercial fora de
 * `confirmedFacts`. Multimodal: as URLs de `context.assets` também vão como `imageUrls` na
 * chamada ao `IcaroBrainPort` (o GPT literalmente VÊ as referências, não só lê a descrição).
 */
export function buildCreativePlanPrompt(context: CreativeContext): string {
  const lines = [
    "Você é um diretor de criação sênior de uma agência de publicidade digital. Sua tarefa é produzir um PLANO CRIATIVO estruturado para uma peça publicitária — não a peça em si, só a direção.",
    "",
    `Marca: ${context.brandName}`,
    `Objetivo: ${context.objective}`,
    `Canal: ${context.channel}`,
    `Formato final: ${context.format}`,
    `Ideia/briefing do cliente: ${context.ideaText}`,
  ];

  if (context.brandColors && context.brandColors.length > 0) {
    lines.push(`Cores de marca: ${context.brandColors.join(", ")}`);
  }
  if (context.brandPositioning) lines.push(`Posicionamento de marca: ${context.brandPositioning}`);
  if (context.businessDescription) lines.push(`Sobre o negócio: ${context.businessDescription}`);
  if (context.audience) lines.push(`Público-alvo já definido pela marca: ${context.audience}`);
  if (context.productsOrServices && context.productsOrServices.length > 0) {
    lines.push(`Produtos/serviços: ${context.productsOrServices.join(", ")}`);
  }
  if (context.visualIdentityNotes) lines.push(`Identidade visual: ${context.visualIdentityNotes}`);
  if (context.recentHistory && context.recentHistory.length > 0) {
    lines.push(
      "",
      "Peças recentes já aprovadas deste workspace (evite repetir headline/CTA/conceito visual — busque variedade):",
      ...context.recentHistory.map((entry) => `- ${[entry.headline, entry.cta, entry.visualConcept].filter(Boolean).join(" | ")}`),
    );
  }

  lines.push("", "Fatos comerciais CONFIRMADOS (use exatamente estes, nunca invente outro valor, nunca omita se relevante ao objetivo):");
  lines.push(context.confirmedFacts.length > 0 ? context.confirmedFacts.map((fact) => `- ${fact}`).join("\n") : "- Nenhum fato comercial confirmado disponível. Não mencione preço, desconto, prazo ou qualquer condição comercial específica.");

  if (context.assets.length > 0) {
    lines.push("", "Assets reais disponíveis (cada um já tem um papel definido, não reinterprete):");
    lines.push(...context.assets.map(describeAsset));
  }

  if (context.forbiddenElements && context.forbiddenElements.length > 0) {
    lines.push("", "Proibido incluir:", ...context.forbiddenElements.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "Regras:",
    "- Nunca invente fato comercial (preço, desconto, prazo, condição) fora dos fatos confirmados acima.",
    "- Quando houver produto real ou screenshot real, o plano deve construir a peça AO REDOR desse asset — nunca sugerir substituí-lo por algo genérico.",
    "- Priorize clareza da mensagem principal sobre densidade visual — só adicione elementos que sirvam ao objetivo.",
    "- `requiredElements` deve listar o que é obrigatório (ex.: \"logo\", \"headline\", \"cta\", \"screenshot do site em mockup de celular\").",
    "- `assetPlacements`: para cada asset REAL (produto/screenshot/logo) da lista acima, defina a geometria exata (retângulo em percentual do canvas final, 0-100) de onde ele vai entrar na composição — essa geometria será usada por composição determinística depois, então precisa ser definida ANTES da imagem existir, nunca improvisada depois.",
    "- `textZones`: para headline/subheadline/CTA/preço/desconto/URL/badge que devem aparecer na peça, defina o retângulo exato e se você (o modelo de imagem) vai desenhar o texto (`renderedBy: \"image_model\"`) ou se um renderer determinístico vai desenhá-lo depois com legibilidade perfeita (`renderedBy: \"renderer\"`) — prefira `\"renderer\"` para preço/desconto/CTA/URL (texto factual que precisa ser perfeitamente legível) e `\"image_model\"` para headline quando fizer parte da composição fotográfica.",
    "",
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    CREATIVE_PLAN_RESPONSE_SCHEMA_HINT,
  );

  return lines.join("\n");
}

function isCreativePlanVisualDensity(value: unknown): value is CreativePlanVisualDensity {
  return typeof value === "string" && (VISUAL_DENSITIES_GPT_PLAN as readonly string[]).includes(value);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isCreativePlanAssetRole(value: unknown): value is CreativePlanAssetRole {
  return typeof value === "string" && (CREATIVE_PLAN_ASSET_ROLES as readonly string[]).includes(value);
}

function isCreativePlanAssetFrame(value: unknown): value is CreativePlanAssetFrame {
  return typeof value === "string" && (CREATIVE_PLAN_ASSET_FRAMES as readonly string[]).includes(value);
}

function isCreativePlanTextZoneKind(value: unknown): value is CreativePlanTextZoneKind {
  return typeof value === "string" && (CREATIVE_PLAN_TEXT_ZONE_KINDS as readonly string[]).includes(value);
}

function isCreativePlanTextZoneEmphasis(value: unknown): value is CreativePlanTextZoneEmphasis {
  return typeof value === "string" && (CREATIVE_PLAN_TEXT_ZONE_EMPHASIS as readonly string[]).includes(value);
}

function isCreativePlanTextZoneRenderer(value: unknown): value is CreativePlanTextZoneRenderer {
  return typeof value === "string" && (CREATIVE_PLAN_TEXT_ZONE_RENDERERS as readonly string[]).includes(value);
}

/** Retângulo válido: dentro do canvas (0-100 em cada eixo) e com área real (largura/altura > 0).
 * Nunca clampa um retângulo fora dos limites — um retângulo inválido rejeita o `creative_plan`
 * INTEIRO (ver `parseCreativePlan`), porque um retângulo "corrigido" silenciosamente é exatamente
 * o tipo de geometria desconectada que já causou um screenshot mal posicionado no motor legado. */
function isValidCreativePlanRect(value: unknown): value is CreativePlanRect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  const { xPct, yPct, widthPct, heightPct } = rect;
  if (typeof xPct !== "number" || typeof yPct !== "number" || typeof widthPct !== "number" || typeof heightPct !== "number") return false;
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || !Number.isFinite(widthPct) || !Number.isFinite(heightPct)) return false;
  if (xPct < 0 || yPct < 0 || widthPct <= 0 || heightPct <= 0) return false;
  if (xPct + widthPct > 100 || yPct + heightPct > 100) return false;
  return true;
}

/** `undefined` de entrada (campo ausente) vira lista vazia — legítimo, plano antigo ou plano que
 * ainda não posicionou nenhum asset. Qualquer item malformado (role/url/rect inválidos) devolve
 * `undefined` — que o chamador (`parseCreativePlan`) trata como "plano inteiro inválido", nunca
 * descarta silenciosamente só o item ruim. */
function parseAssetPlacements(value: unknown): CreativePlanAssetPlacement[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;

  const result: CreativePlanAssetPlacement[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return undefined;
    const record = item as Record<string, unknown>;
    if (!isCreativePlanAssetRole(record.role) || typeof record.url !== "string" || !isValidCreativePlanRect(record.rect)) return undefined;
    result.push({
      role: record.role,
      url: record.url,
      rect: record.rect,
      frame: isCreativePlanAssetFrame(record.frame) ? record.frame : undefined,
      treatment: typeof record.treatment === "string" ? record.treatment : undefined,
    });
  }
  return result;
}

function parseTextZones(value: unknown): CreativePlanTextZone[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;

  const result: CreativePlanTextZone[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return undefined;
    const record = item as Record<string, unknown>;
    if (
      !isCreativePlanTextZoneKind(record.kind)
      || typeof record.text !== "string"
      || !record.text.trim()
      || !isValidCreativePlanRect(record.rect)
      || !isCreativePlanTextZoneEmphasis(record.emphasis)
      || !isCreativePlanTextZoneRenderer(record.renderedBy)
    ) {
      return undefined;
    }
    result.push({ kind: record.kind, text: record.text, rect: record.rect, emphasis: record.emphasis, renderedBy: record.renderedBy });
  }
  return result;
}

/** Parser tolerante — nunca lança; devolve `undefined` em qualquer entrada malformada (mesmo
 * padrão best-effort do resto do pipeline de visão/texto do Vorix). Campos ausentes recebem
 * valores neutros nunca inventados como "preenchidos". Exceção deliberada: `assetPlacements`/
 * `textZones` presentes MAS com algum item inválido (papel desconhecido, retângulo fora dos
 * limites, etc.) rejeitam o plano INTEIRO — nunca clampam ou descartam silenciosamente só o item
 * ruim, porque isso é exatamente como um asset acaba posicionado errado sem ninguém perceber. */
export function parseCreativePlan(raw: string): CreativePlan | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.headline !== "string" || typeof parsed.cta !== "string") return undefined;

    const assetUsage: Record<string, string> = {};
    if (parsed.assetUsage && typeof parsed.assetUsage === "object") {
      for (const [key, value] of Object.entries(parsed.assetUsage as Record<string, unknown>)) {
        if (typeof value === "string") assetUsage[key] = value;
      }
    }

    const assetPlacements = parseAssetPlacements(parsed.assetPlacements);
    if (assetPlacements === undefined) return undefined;
    const textZones = parseTextZones(parsed.textZones);
    if (textZones === undefined) return undefined;

    return {
      objective: typeof parsed.objective === "string" ? parsed.objective : "",
      angle: typeof parsed.angle === "string" ? parsed.angle : "",
      targetAudience: typeof parsed.targetAudience === "string" ? parsed.targetAudience : "",
      title: typeof parsed.title === "string" ? parsed.title : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      headline: parsed.headline,
      subheadline: typeof parsed.subheadline === "string" && parsed.subheadline.trim() ? parsed.subheadline : undefined,
      cta: parsed.cta,
      visualDirection: typeof parsed.visualDirection === "string" ? parsed.visualDirection : "",
      compositionIntent: typeof parsed.compositionIntent === "string" ? parsed.compositionIntent : "",
      assetUsage,
      assetPlacements,
      textZones,
      requiredElements: toStringArray(parsed.requiredElements),
      forbiddenElements: toStringArray(parsed.forbiddenElements),
      visualDensity: isCreativePlanVisualDensity(parsed.visualDensity) ? parsed.visualDensity : "balanced",
      styleNotes: typeof parsed.styleNotes === "string" ? parsed.styleNotes : "",
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return undefined;
  }
}

/**
 * Deriva o prompt de GERAÇÃO DE IMAGEM a partir do `creative_plan` — substitui a árvore de regras
 * da Bianca + guard clauses do Pedro. Elementos que serão colados por composição determinística
 * depois (logo, screenshot) são explicitamente excluídos da instrução de desenho — o modelo deve
 * deixar espaço/composição para eles, nunca tentar desenhá-los.
 */
export function buildImageGenerationPromptFromPlan(plan: CreativePlan, context: CreativeContext): string {
  const hasScreenshotAsset = context.assets.some((asset) => asset.role === "screenshot");
  const hasLogoAsset = context.assets.some((asset) => asset.role === "logo");

  const lines = [
    `Crie uma peça publicitária ${context.format} para "${context.brandName}".`,
    `Direção visual: ${plan.visualDirection}`,
    `Intenção de composição: ${plan.compositionIntent}`,
    `Headline (desenhar exatamente este texto, com destaque tipográfico forte): "${plan.headline}"`,
  ];
  if (plan.subheadline) lines.push(`Subheadline: "${plan.subheadline}"`);
  lines.push(`CTA (desenhar exatamente este texto): "${plan.cta}"`);
  if (plan.requiredElements.length > 0) lines.push(`Elementos obrigatórios na composição: ${plan.requiredElements.join(", ")}.`);
  if (plan.forbiddenElements.length > 0) lines.push(`NUNCA incluir: ${plan.forbiddenElements.join(", ")}.`);
  lines.push(`Densidade visual desejada: ${plan.visualDensity}.`);
  if (plan.styleNotes) lines.push(`Notas de estilo: ${plan.styleNotes}`);

  const logoPlacement = plan.assetPlacements.find((placement) => placement.role === "logo");
  if (hasLogoAsset) {
    lines.push(
      logoPlacement
        ? `Deixe a região de ${logoPlacement.rect.xPct}%–${logoPlacement.rect.xPct + logoPlacement.rect.widthPct}% na horizontal e ${logoPlacement.rect.yPct}%–${logoPlacement.rect.yPct + logoPlacement.rect.heightPct}% na vertical completamente limpa, sem elementos concorrentes: a logo real será colada exatamente ali depois. NÃO desenhe uma logo.`
        : "Deixe um espaço visualmente limpo (canto superior, sem elementos concorrentes) para a logo da marca — ela será colada por cima depois, NÃO desenhe uma logo.",
    );
  }

  const screenshotPlacement = plan.assetPlacements.find((placement) => placement.role === "screenshot");
  if (hasScreenshotAsset) {
    lines.push(
      screenshotPlacement
        ? `Deixe a região de ${screenshotPlacement.rect.xPct}%–${screenshotPlacement.rect.xPct + screenshotPlacement.rect.widthPct}% na horizontal e ${screenshotPlacement.rect.yPct}%–${screenshotPlacement.rect.yPct + screenshotPlacement.rect.heightPct}% na vertical completamente limpa: um screenshot REAL do site será colado exatamente ali depois. Desenhe apenas a moldura do dispositivo${screenshotPlacement.frame && screenshotPlacement.frame !== "none" ? ` (${screenshotPlacement.frame === "phone" ? "celular" : "notebook"})` : ""} e a cena ao redor — NUNCA a interface do site.`
        : "Deixe espaço para um mockup de dispositivo (celular ou notebook) exibindo uma interface de site — a tela real será colada por cima depois, NÃO desenhe a interface do site você mesmo, apenas o dispositivo/cenário ao redor.",
    );
  }

  return lines.join("\n");
}
