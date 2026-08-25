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

/**
 * Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — um material da
 * Asset Library do workspace, já SELECIONADO como relevante para esta geração específica (ver
 * `select-brand-materials.ts`) — nunca a biblioteca inteira despejada sem critério. Distinto de
 * `CreativeContextAsset`: `assets[]` é a lista plana usada pela composição determinística
 * (role→geometria); `brandMaterials[]` é o catálogo rico (prioridade/regra/instrução) que dá ao
 * GPT o "porquê" e o "como" de cada material, não só o "o quê". `type`/`priority` ficam como
 * `string` (não importam o enum do domínio) de propósito — este módulo permanece deliberadamente
 * desacoplado de `src/domain` (ver comentário de topo do arquivo).
 */
export type CreativeContextBrandMaterial = {
  id: string;
  name: string;
  type: string;
  /** "required" nunca é omitido pela seleção; "on_request" só entra se o pedido atual referenciar
   * o material explicitamente. Ver `AssetUsagePriority` (`asset-library.model.ts`). */
  priority: string;
  aiInstructions?: string;
  usageRule?: string;
  /** Sempre "asset_library" nesta versão — campo mantido para permitir outras origens no futuro
   * (ex.: um material vindo só do pedido atual, sem estar na Asset Library) sem quebrar o formato. */
  source: string;
  /** URL real do material — mesma chave usada em `CreativeContext.assets[].url` quando este
   * material também entra na lista plana de composição (papel required/preferred mapeável). */
  url?: string;
  /** Por que este material foi selecionado para ESTA geração — auditável, nunca "porque sim".
   * Ver `select-brand-materials.ts`. */
  selectionReason: string;
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
  /** Diferenciais reais da marca frente à concorrência (Clara `ProductContext.differentiators`),
   * distinto de `productsOrServices` (o que a marca vende). */
  differentiators?: string[];
  /** Tom de voz da marca (Clara `BrandContext.toneOfVoice`) — só quando não é mais o texto
   * genérico do bootstrap (`GENERIC_BRAND_TONE_OF_VOICE`, `container.ts`). */
  toneOfVoice?: string;
  /** Notas de identidade visual (tipografia, estilo, personalidade da marca) — nunca uma decisão
   * de layout, só contexto para a direção de arte do GPT. */
  visualIdentityNotes?: string;
  /** Últimas peças aprovadas do workspace — ver `CreativeContextHistoryEntry`. */
  recentHistory?: CreativeContextHistoryEntry[];
  /** Migração "Prompt Persistente de Produção" — texto livre permanente do workspace ("Prompt de
   * Produção"/"Diretrizes Criativas"), incluído verbatim. Prioridade 2 na precedência de
   * instruções (perde só para o pedido atual — `objective`/`ideaText` — quando houver conflito
   * explícito; vence sobre materiais/dados de marca). `undefined` = workspace sem prompt
   * configurado ainda, nunca inventado. */
  productionInstructions?: string;
  /** Número de versão do prompt persistente NO MOMENTO desta execução — snapshot para auditoria
   * (ver `workspace_production_settings.version`); nunca reconstruído a partir de execuções
   * antigas se o prompt for editado depois. */
  productionInstructionsVersion?: number;
  /** Frases derivadas das opções estruturadas de comportamento do workspace (ver
   * `describeProductionSettingsAsInstructions`, `production-settings.types.ts`) — mesma
   * prioridade 2 do `productionInstructions`. */
  behaviorPreferences?: string[];
  /** Materiais da Asset Library já selecionados como relevantes para este pedido — ver
   * `CreativeContextBrandMaterial`. Prioridade 3 na precedência (perde para o pedido atual E para
   * as instruções permanentes do workspace, vence sobre dados estruturados de marca). Lista vazia
   * = nenhum material relevante encontrado (nunca a biblioteca inteira despejada aqui). */
  brandMaterials?: CreativeContextBrandMaterial[];
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

const BRAND_MATERIAL_PRIORITY_LABEL: Record<string, string> = {
  required: "OBRIGATÓRIO",
  preferred: "PREFERENCIAL",
  automatic: "uso automático quando relevante",
  on_request: "só quando solicitado explicitamente",
};

function describeBrandMaterial(material: CreativeContextBrandMaterial): string {
  const priorityLabel = BRAND_MATERIAL_PRIORITY_LABEL[material.priority] ?? material.priority;
  const parts = [`- ${material.name} (${material.type}, ${priorityLabel})`];
  if (material.aiInstructions) parts.push(`Instrução: ${material.aiInstructions}`);
  if (material.usageRule) parts.push(`REGRA: ${material.usageRule}`);
  return parts.join(" ");
}

/**
 * Bloco de contexto COMPARTILHADO entre o prompt do plano inicial (`buildCreativePlanPrompt`) e o
 * prompt de reparo (`buildCreativePlanRepairPrompt`, `creative-repair.ts`) — achado ao vivo numa
 * autorrevisão: o reparo (`gpt_replan`) reenvia o MESMO modelo diretor, mas antes desta função só
 * recebia `brandName`/`confirmedFacts`, nunca `productionInstructions`/`behaviorPreferences`/
 * `brandMaterials`. Resultado prático: um plano corrigido por reparo podia silenciosamente deixar
 * de respeitar o Prompt de Produção e os materiais de marca configurados, exatamente o tipo de
 * regressão que "só aparece na segunda chamada". Extrair este bloco garante que as duas chamadas
 * ao GPT (plano inicial e todo reparo) vejam exatamente o mesmo contexto de workspace, nunca uma
 * versão empobrecida.
 */
export function buildWorkspaceContextLines(context: CreativeContext): string[] {
  const lines: string[] = [];

  if (context.productionInstructions || (context.behaviorPreferences && context.behaviorPreferences.length > 0)) {
    lines.push("", "Instruções permanentes deste workspace (prioridade 2 — respeite exceto quando conflitar com o pedido atual):");
    if (context.productionInstructions) lines.push(context.productionInstructions);
    if (context.behaviorPreferences) lines.push(...context.behaviorPreferences.map((item) => `- ${item}`));
  }

  if (context.brandColors && context.brandColors.length > 0) {
    // Achado ao vivo em produção: uma linha informativa solta ("Cores de marca: X, Y, Z") no meio
    // de vários outros dados estruturados de marca (posicionamento, público, etc.) não bastava —
    // peças reais saíam com fundo branco e cores completamente diferentes da paleta configurada.
    // Fraseado agora como REQUISITO direto, não um dado de contexto entre outros.
    lines.push(
      `PALETA DE CORES OFICIAL DESTA MARCA (obrigatória, não uma sugestão): ${context.brandColors.join(", ")}. ` +
        "Estas precisam ser as cores predominantes do fundo e dos elementos visuais principais da peça final — nunca substitua por outra paleta de cores por preferência estética.",
    );
  }
  if (context.brandPositioning) lines.push(`Posicionamento de marca: ${context.brandPositioning}`);
  if (context.businessDescription) lines.push(`Sobre o negócio: ${context.businessDescription}`);
  if (context.audience) lines.push(`Público-alvo já definido pela marca: ${context.audience}`);
  if (context.productsOrServices && context.productsOrServices.length > 0) {
    lines.push(`Produtos/serviços: ${context.productsOrServices.join(", ")}`);
  }
  if (context.differentiators && context.differentiators.length > 0) {
    lines.push(`Diferenciais da marca: ${context.differentiators.join(", ")}`);
  }
  if (context.toneOfVoice) lines.push(`Tom de voz da marca: ${context.toneOfVoice}`);
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

  if (context.brandMaterials && context.brandMaterials.length > 0) {
    lines.push("", "Materiais de marca selecionados para esta geração (prioridade 3 — cada um já tem papel/prioridade/regra definidos, siga exatamente como instruído):");
    lines.push(...context.brandMaterials.map(describeBrandMaterial));
  }

  if (context.assets.length > 0) {
    lines.push("", "Assets reais disponíveis para composição determinística (cada um já tem um papel definido, não reinterprete):");
    lines.push(...context.assets.map(describeAsset));
  }

  if (context.forbiddenElements && context.forbiddenElements.length > 0) {
    lines.push("", "Proibido incluir:", ...context.forbiddenElements.map((item) => `- ${item}`));
  }

  return lines;
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
    "PRECEDÊNCIA DE INSTRUÇÕES — quando houver conflito entre as seções abaixo, siga exatamente esta ordem (a de número menor vence):",
    "1. O PEDIDO ATUAL do usuário nesta geração (objetivo/ideia abaixo).",
    "2. Instruções permanentes deste workspace e preferências de comportamento (se houver).",
    "3. Materiais de marca selecionados e suas regras de uso (se houver).",
    "4. Dados estruturados da marca (posicionamento, identidade visual, público, etc.).",
    "5. Guardrails factuais/técnicos ao final deste prompt — estes são SEMPRE ABSOLUTOS e nunca podem ser sobrepostos por nenhuma das seções 1-4 (nunca invente fato comercial, nunca redesenhe uma logo obrigatória, nunca substitua um screenshot real por interface fictícia quando isso estiver proibido).",
    "",
    `Marca: ${context.brandName}`,
    `Objetivo: ${context.objective}`,
    `Canal: ${context.channel}`,
    `Formato final: ${context.format}`,
    `Ideia/briefing do cliente (PEDIDO ATUAL — prioridade 1): ${context.ideaText}`,
    ...buildWorkspaceContextLines(context),
  ];

  lines.push(
    "",
    "Regras:",
    "- Nunca invente fato comercial (preço, desconto, prazo, condição) fora dos fatos confirmados acima.",
    "- Quando houver produto real ou screenshot real, o plano deve construir a peça AO REDOR desse asset — nunca sugerir substituí-lo por algo genérico.",
    "- Priorize clareza da mensagem principal sobre densidade visual — só adicione elementos que sirvam ao objetivo.",
    "- `requiredElements` deve listar o que é obrigatório (ex.: \"logo\", \"headline\", \"cta\", \"screenshot do site em mockup de celular\").",
    "- `assetPlacements`: para cada asset REAL (produto/screenshot/logo) da lista acima, defina a geometria exata (retângulo em percentual do canvas final, 0-100) de onde ele vai entrar na composição — essa geometria será usada por composição determinística depois, então precisa ser definida ANTES da imagem existir, nunca improvisada depois.",
    // Achado ao vivo em produção: a orientação anterior ("prefira image_model pro headline") deu
    // errado nas duas primeiras tentativas reais após este pipeline entrar no ar — o headline,
    // desenhado livremente pelo modelo de imagem sem um retângulo determinístico, saiu cortado nas
    // bordas do canvas nas duas vezes, sempre reprovado e sem chance real de reparo (um novo plano
    // cai na mesma armadilha). `renderedBy: "renderer"` nunca corta: o compositor ajusta a fonte
    // pra caber no retângulo. Virou o padrão pra TODO texto principal, não só factual.
    "- `textZones`: para headline/subheadline/CTA/preço/desconto/URL/badge que devem aparecer na peça, defina o retângulo exato e se você (o modelo de imagem) vai desenhar o texto (`renderedBy: \"image_model\"`) ou se um renderer determinístico vai desenhá-lo depois com legibilidade perfeita e SEM risco de cortar nas bordas (`renderedBy: \"renderer\"`) — PREFIRA `\"renderer\"` para TODO texto principal (headline, subheadline, CTA, preço, desconto, URL, badge) por padrão. Só use `\"image_model\"` quando o texto for parte física e pequena de um cenário real dentro da composição (ex.: uma placa/vitrine ao fundo da cena), nunca para o headline/CTA principal da peça.",
    "- Todo texto que você (modelo de imagem) desenhar precisa ter ALTO CONTRASTE com o fundo exato onde ele cai — nunca texto claro sobre fundo claro, nem texto escuro sobre fundo escuro. Se a área por trás do texto for de tom duvidoso, adicione um leve escurecimento/scrim ou uma cor de texto claramente oposta, nunca arrisque legibilidade.",
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
/**
 * Achado ao vivo em produção: quando o plano decide `renderedBy: "renderer"` para o headline/CTA
 * (o compositor determinístico Satori+sharp vai desenhar por cima depois, com legibilidade
 * perfeita), este prompt seguia mandando o próprio modelo de imagem desenhar o MESMO texto —
 * gerando duas camadas de texto sobrepostas (uma fantasma/embutida no fundo, outra do renderer
 * por cima de uma caixa de contraste), sempre reprovado como `TEXT_ILLEGIBLE_OR_CUT`/
 * `CRITICAL_OVERLAP`/`COMPOSITION_BROKEN` e sem nenhuma chance real de reparo (nenhuma rodada de
 * `gpt_replan` corrige isso, porque o novo plano cai na mesma armadilha). Mesmo princípio já usado
 * pra logo/screenshot: se uma zona é `renderedBy: "renderer"`, o modelo de imagem só pode deixar o
 * espaço limpo — nunca escrever o texto ele mesmo, nem uma versão aproximada.
 */
function textZoneDrawInstruction(zone: CreativePlanTextZone | undefined, label: string, exactText: string, emphasisNote: string): string {
  if (zone && zone.renderedBy === "renderer") {
    return `Deixe a região de ${zone.rect.xPct}%–${zone.rect.xPct + zone.rect.widthPct}% na horizontal e ${zone.rect.yPct}%–${zone.rect.yPct + zone.rect.heightPct}% na vertical completamente limpa, sem nenhum texto: o ${label.toLowerCase()} será desenhado por cima depois, com tipografia perfeita e legibilidade garantida. NÃO escreva o ${label.toLowerCase()} você mesmo, nem uma versão aproximada, fantasma ou estilizada dele.`;
  }
  return `${label} (desenhar exatamente este texto${emphasisNote}): "${exactText}"`;
}

export function buildImageGenerationPromptFromPlan(plan: CreativePlan, context: CreativeContext): string {
  const hasScreenshotAsset = context.assets.some((asset) => asset.role === "screenshot");
  const hasLogoAsset = context.assets.some((asset) => asset.role === "logo");
  const headlineZone = plan.textZones.find((zone) => zone.kind === "headline");
  const subheadlineZone = plan.textZones.find((zone) => zone.kind === "subheadline");
  const ctaZone = plan.textZones.find((zone) => zone.kind === "cta");

  const lines = [
    `Crie uma peça publicitária ${context.format} para "${context.brandName}".`,
    `Direção visual: ${plan.visualDirection}`,
    `Intenção de composição: ${plan.compositionIntent}`,
    textZoneDrawInstruction(headlineZone, "Headline", plan.headline, ", com destaque tipográfico forte"),
  ];
  if (plan.subheadline) lines.push(textZoneDrawInstruction(subheadlineZone, "Subheadline", plan.subheadline, ""));
  lines.push(textZoneDrawInstruction(ctaZone, "CTA", plan.cta, ""));
  if (plan.requiredElements.length > 0) lines.push(`Elementos obrigatórios na composição: ${plan.requiredElements.join(", ")}.`);
  if (plan.forbiddenElements.length > 0) lines.push(`NUNCA incluir: ${plan.forbiddenElements.join(", ")}.`);
  lines.push(`Densidade visual desejada: ${plan.visualDensity}.`);
  if (plan.styleNotes) lines.push(`Notas de estilo: ${plan.styleNotes}`);
  // Achado ao vivo em produção: este prompt (o que de fato gera os pixels) nunca mencionava as
  // cores da marca — elas só chegavam indiretamente, se o plano tivesse escrito algo sobre cor em
  // `visualDirection`/`styleNotes` (texto livre, nem sempre explícito). Repetir aqui, no ponto
  // exato que desenha a imagem, é a forma mais direta de reduzir peças que saem com paleta errada
  // já na primeira tentativa — nunca depender só do prompt do plano, um passo antes.
  if (context.brandColors && context.brandColors.length > 0) {
    lines.push(
      `PALETA DE CORES OBRIGATÓRIA: ${context.brandColors.join(", ")}. Estas devem ser as cores predominantes do fundo e dos elementos visuais principais — nunca use outra paleta.`,
    );
  }
  lines.push("Garanta ALTO CONTRASTE entre todo texto e o fundo exato atrás dele — nunca texto claro sobre fundo claro, nem texto escuro sobre fundo escuro.");
  // Achado ao vivo em produção: um headline desenhado pelo próprio modelo (sem textZone/rect
  // determinado) saiu cortado nas bordas superior e esquerda do canvas — nada no prompt até aqui
  // dizia pra manter distância da borda quando o texto não tem uma zona com rect explícito.
  lines.push("Mantenha TODO texto (headline, subheadline, CTA, badges, preços) a pelo menos 6% de distância de cada borda do canvas — nunca corte ou aproxime letras da borda.");

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
  } else {
    // Achado ao vivo em produção: sem nenhum screenshot real cadastrado, este prompt não dizia
    // nada sobre eventuais mockups de dispositivo que o próprio plano decidisse incluir — o modelo
    // desenhou uma interface de site fictícia inteira, com nomes de marca digitados errado
    // ("Shopce", "mereado livre" em vez de "Shopee"/"Mercado Livre"). Modelos de imagem quase
    // sempre erram a grafia de texto pequeno — a única forma confiável de evitar isso é nunca
    // pedir esse texto, nunca torná-lo mais legível.
    lines.push(
      "Se a composição incluir um mockup de dispositivo (celular, notebook etc.) mostrando uma tela, NUNCA escreva texto legível dentro dela (nomes de marcas, menus, nomes de produtos) — represente o conteúdo da tela só com blocos de cor, fotos e formas, sem nenhuma palavra real, pois texto pequeno gerado sempre sai com erros de grafia.",
    );
  }

  return lines.join("\n");
}
