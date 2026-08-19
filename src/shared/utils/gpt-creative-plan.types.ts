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
};

export const VISUAL_DENSITIES_GPT_PLAN = ["clean", "balanced", "dense"] as const;
export type CreativePlanVisualDensity = (typeof VISUAL_DENSITIES_GPT_PLAN)[number];

export type CreativePlan = {
  objective: string;
  angle: string;
  targetAudience: string;
  headline: string;
  subheadline?: string;
  cta: string;
  visualDirection: string;
  compositionIntent: string;
  /** Para cada asset (por `url`, mesma chave do `CreativeContext.assets`), como o plano quer que
   * ele apareça na peça final — eco do papel já decidido, nunca uma reinterpretação. */
  assetUsage: Record<string, string>;
  requiredElements: string[];
  forbiddenElements: string[];
  visualDensity: CreativePlanVisualDensity;
  styleNotes: string;
  rationale: string;
};

export const CREATIVE_PLAN_RESPONSE_SCHEMA_HINT =
  '{"objective": "...", "angle": "...", "targetAudience": "...", "headline": "...", "subheadline": "...", ' +
  '"cta": "...", "visualDirection": "...", "compositionIntent": "...", "assetUsage": {"<url>": "..."}, ' +
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

/** Parser tolerante — nunca lança; devolve `undefined` em qualquer entrada malformada (mesmo
 * padrão best-effort do resto do pipeline de visão/texto do Vorix). Campos ausentes recebem
 * valores neutros nunca inventados como "preenchidos". */
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

    return {
      objective: typeof parsed.objective === "string" ? parsed.objective : "",
      angle: typeof parsed.angle === "string" ? parsed.angle : "",
      targetAudience: typeof parsed.targetAudience === "string" ? parsed.targetAudience : "",
      headline: parsed.headline,
      subheadline: typeof parsed.subheadline === "string" && parsed.subheadline.trim() ? parsed.subheadline : undefined,
      cta: parsed.cta,
      visualDirection: typeof parsed.visualDirection === "string" ? parsed.visualDirection : "",
      compositionIntent: typeof parsed.compositionIntent === "string" ? parsed.compositionIntent : "",
      assetUsage,
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

  if (hasLogoAsset) lines.push("Deixe um espaço visualmente limpo (canto superior, sem elementos concorrentes) para a logo da marca — ela será colada por cima depois, NÃO desenhe uma logo.");
  if (hasScreenshotAsset) lines.push("Deixe espaço para um mockup de dispositivo (celular ou notebook) exibindo uma interface de site — a tela real será colada por cima depois, NÃO desenhe a interface do site você mesmo, apenas o dispositivo/cenário ao redor.");

  return lines.join("\n");
}
