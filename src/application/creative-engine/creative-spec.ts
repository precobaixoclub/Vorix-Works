import type { ClassifiedReference, ReferenceGuidance, ResolvedReferences } from "./reference-roles.js";
import type { BrandIdentity } from "../../shared/utils/brand-identity.js";
import { ideaText, VISUAL_MODE_LABELS, type VisualIntentDecision, type VisualIntentIdea, type VisualMode } from "./visual-intent.js";
import { archetypeRecencyPenalty, type VisualFingerprint } from "./visual-variety.js";

/**
 * Planejamento criativo ANTES da geração — separa "o que a peça precisa ser" de "como renderizar".
 *
 * Achado da auditoria (25/11/2026): o piloto mandava um único prompt genérico ("base visual da
 * pauta… proíba letras") para todas as marcas e deixava a IA decidir composição, produto e tela.
 * Aqui sai uma especificação estruturada (marca, objetivo, modo, referências obrigatórias,
 * restrições de fidelidade, composição, texto, formato) e o gerador recebe instruções concretas
 * derivadas dela. A composição vem de arquétipos por modo, escolhidos por afinidade com a pauta e
 * penalizados pelo uso recente (variedade), mantendo a mesma família numa série (carrossel).
 */

export type CompositionOperation =
  /** Composição controlada com os arquivos originais (sem IA): fidelidade garantida por construção. */
  | "deterministic_composite"
  /** IA cria só o cenário (área reservada vazia); produto/tela reais são compostos depois. */
  | "ai_scene_with_composite"
  /** IA edita a partir da foto original do produto (referência visual real); fidelidade verificada. */
  | "ai_edit_with_reference"
  /** IA cria a cena inteira (só campanha conceitual). */
  | "ai_generation";

export type CompositionArchetype = {
  id: string;
  mode: VisualMode;
  label: string;
  operation: CompositionOperation;
  textLayout: "top" | "left" | "bottom";
  /** Variações reais necessárias (fotos de cores diferentes do mesmo produto). */
  minVariants?: number;
  /** Exige uma captura real da tela no celular (não recorta a tela de desktop). */
  needsMobileCapture?: boolean;
  /** Usa o produto recortado: só com foto de estúdio (foto de cena nunca é recortada). */
  needsCutout?: boolean;
  /** Palavras da pauta que favorecem este arquétipo (texto já normalizado sem acento). */
  affinity: RegExp;
  /** Arquétipo determinístico usado quando a IA não preserva o produto/tela. */
  fallback?: string;
  /** Só entra quando a IA não está disponível ou o arquétipo principal foi vetado (ex.: repetição). */
  onlyAsAlternative?: boolean;
  intent: string;
};

export const COMPOSITION_ARCHETYPES: readonly CompositionArchetype[] = [
  // Produto físico
  { id: "fashion_poster", mode: "physical_product", label: "Pôster de moda", operation: "deterministic_composite", textLayout: "top", affinity: /\b(campanha|editorial|poster|moda|close|textura|futurista|recorte)\b/, intent: "Uma foto oficial dominante, luz de recorte e contraste de campanha. Manchete curta. Sem miniatura duplicada, rótulos de catálogo ou moldura de página." },
  { id: "product_studio", mode: "physical_product", label: "Produto em destaque (estúdio)", operation: "deterministic_composite", textLayout: "top", needsCutout: true, affinity: /\b(destaque|novidade|isolad\w*|estudio|vitrine|basic\w*|essencial)\b/, intent: "A peça original recortada, grande e centralizada, sobre fundo de estúdio nas cores da marca, com sombra de contato." },
  { id: "product_editorial", mode: "physical_product", label: "Composição editorial", operation: "deterministic_composite", textLayout: "left", affinity: /\b(editorial|revista|tendencia\w*|estilo|elegan\w*|classic\w*|atemporal)\b/, intent: "Foto original emoldurada em página editorial: coluna de texto à esquerda, foto alta à direita, fio de destaque e legenda da cor." },
  { id: "variant_lineup", mode: "physical_product", label: "Variações reais de cor", operation: "deterministic_composite", textLayout: "top", minVariants: 2, needsCutout: true, affinity: /\b(cor|cores|variac\w*|versao|versoes|escolh\w*|opc\w*|duas|tres|qual)\b/, intent: "Duas ou três cores REAIS do mesmo modelo em leque, com profundidade e etiquetas de cor — nunca grade de catálogo." },
  { id: "print_detail", mode: "physical_product", label: "Destaque da estampa", operation: "deterministic_composite", textLayout: "top", needsCutout: true, affinity: /\b(estampa\w*|detalhe\w*|arte|desenho|print|bordad\w*|dtf|silk)\b/, intent: "Zoom da estampa original em recorte grande + a peça inteira em miniatura, mostrando que a arte é exatamente a do produto." },
  { id: "commercial_bold", mode: "physical_product", label: "Comercial com chamada curta", operation: "deterministic_composite", textLayout: "left", needsCutout: true, affinity: /\b(oferta\w*|promo\w*|compre|garanta|chegou|lancamento\w*|ultim\w*|desconto|frete)\b/, intent: "Produto grande à direita sobre faixa diagonal da cor de destaque, chamada curta e CTA fortes à esquerda." },
  { id: "product_scene", mode: "physical_product", label: "Produto na cena original", operation: "deterministic_composite", textLayout: "top", affinity: /\b(cena|ambiente|lancamento\w*|presente\w*|exclusiv\w*|premium|noite)\b/, intent: "A fotografia original inteira, sem recorte, em tela cheia, com a área de texto preparada — para fotos de cena em que o produto depende do ambiente." },
  { id: "product_lifestyle", mode: "physical_product", label: "Lifestyle", operation: "ai_edit_with_reference", textLayout: "left", fallback: "product_editorial", affinity: /\b(lifestyle|dia a dia|rotina|usar|vestir|passeio|rua|cafe|fim de semana|viagem|look)\b/, intent: "A mesma peça (foto original como referência) vestida em cena real; estampa, cor e modelo idênticos." },
  // Software
  { id: "device_laptop", mode: "software", label: "Notebook com a tela real", operation: "deterministic_composite", textLayout: "top", affinity: /\b(sistema|plataforma|painel|dashboard|equipe|gestao|visao|controle)\b/, intent: "Notebook em leve perspectiva com a captura real encaixada na tela, brilho da marca ao fundo." },
  { id: "ui_focus", mode: "software", label: "Foco na funcionalidade", operation: "deterministic_composite", textLayout: "top", affinity: /\b(historico|detalhe\w*|resumo|transcric\w*|decis\w*|responsavel|contexto|continuidade|registro)\b/, intent: "Janela com a captura real e um cartão ampliado do trecho que importa (histórico, responsável, resumo), ligado por traço de destaque." },
  { id: "phone_conversation", mode: "software", label: "Celular com a conversa", operation: "deterministic_composite", textLayout: "left", needsMobileCapture: true, affinity: /\b(whatsapp|celular|mensage\w*|cliente\w*|atendimento|responder|resposta)\b/, intent: "Celular com a coluna real da conversa, texto à esquerda." },
  { id: "browser_window", mode: "software", label: "Janela do sistema", operation: "deterministic_composite", textLayout: "top", affinity: /\b(tela|interface|relatorio\w*|calendario|agenda|kanban|funil|ideias|conteudo\w*)\b/, intent: "Janela do navegador grande e reta com a captura real, legível de ponta a ponta." },
  // Conceitual
  // Várias linguagens para a mesma pauta conceitual (antes só havia a "cena fotográfica": toda peça saía como foto de
  // banco de imagens com texto no topo, o Quality Gate reprovava por repetição e caía na frase tipográfica vazia).
  { id: "concept_scene", mode: "conceptual", label: "Cena editorial", operation: "ai_generation", textLayout: "top", affinity: /^./, intent: "Fotografia editorial de uma cena real que traduz o conceito: pessoas ou ambiente com um momento verdadeiro, ângulo de revista, luz com intenção e as cores da marca na cena." },
  { id: "concept_closeup", mode: "conceptual", label: "Close-up fotográfico", operation: "ai_generation", textLayout: "bottom", affinity: /^./, intent: "Close-up fotográfico (macro) do objeto ou detalhe central do tema, profundidade de campo rasa, textura tátil e luz dramática lateral; o objeto ocupa a parte de cima e o fundo desfocado deixa a base livre para o texto." },
  { id: "concept_metaphor", mode: "conceptual", label: "Metáfora visual", operation: "ai_generation", textLayout: "left", affinity: /^./, intent: "Metáfora visual surpreendente: um único objeto ou situação simbólica que materializa a ideia de forma inesperada (still life conceitual), fotografado sobre fundo limpo nas cores da marca, com sombra marcada; o objeto fica à direita e a esquerda livre para o texto." },
  { id: "concept_3d", mode: "conceptual", label: "3D tecnológico", operation: "ai_generation", textLayout: "bottom", affinity: /\b(tecnolog\w*|inova\w*|futur\w*|digital\w*|inteligencia|ia|automac\w*|app|aplicativo\w*|sistema\w*|dados|gadget\w*|eletronic\w*|robo\w*|smart|conectad\w*)\b/, intent: "Render 3D estilizado e moderno: objetos do tema simplificados em vidro, metal fosco e acrílico, luz de recorte nas cores da marca, profundidade e brilho sutil; composição limpa com o objeto principal no alto e a base livre para o texto." },
  { id: "typographic_statement", mode: "conceptual", label: "Manifesto tipográfico", operation: "deterministic_composite", textLayout: "top", onlyAsAlternative: true, affinity: /\b(frase|manifesto|pergunta|reflex\w*|valores|proposito|verdade)\b/, intent: "Peça tipográfica nas cores e fontes da marca, sem imagem gerada." },
];

export const archetypeById = (id: string) => COMPOSITION_ARCHETYPES.find((item) => item.id === id);

export type ChooseCompositionInput = {
  mode: VisualMode;
  presentation?: "fashion_campaign";
  idea: VisualIntentIdea;
  references: ResolvedReferences;
  history: readonly VisualFingerprint[];
  seriesKey?: string;
  /** Arquétipo da série em andamento (carrossel): mantém a família de propósito. */
  seriesArchetype?: string;
  /** Sem orçamento/IA disponível: só composição controlada. */
  allowAi: boolean;
  /** Arquétipos vetados nesta tentativa (ex.: reprovados por repetição). */
  exclude?: readonly string[];
  /** Linguagens que a marca não usa (ex.: 3D tecnológico numa marca de casamento) — nunca escolhidas. */
  avoid?: readonly string[];
  /** Memória criativa da marca: pontos por linguagem (negativo = reprovada de forma recorrente). Nunca proíbe. */
  bias?: Readonly<Record<string, number>>;
  /** Semente estável (id da pauta) para desempate sem aleatoriedade. */
  seed: string;
};

export type CompositionChoice = { archetype: CompositionArchetype; score: number; reasons: string[]; alternatives: string[] };

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

export function chooseComposition(input: ChooseCompositionInput): CompositionChoice {
  const text = ideaText(input.idea);
  const variants = (input.references.primary ? 1 : 0) + input.references.variants.length;
  const available = COMPOSITION_ARCHETYPES.filter((item) => item.mode === input.mode && !(input.avoid ?? []).includes(item.id) && (
    input.presentation === "fashion_campaign" && input.mode === "physical_product"
      ? ["fashion_poster", "product_lifestyle", "variant_lineup"].includes(item.id)
      : item.id !== "fashion_poster"
  ));
  const eligible = available.filter((item) =>
    !(input.exclude ?? []).includes(item.id)
    && (input.allowAi || item.operation === "deterministic_composite")
    && (!item.minVariants || variants >= item.minVariants)
    && (!item.needsMobileCapture || [input.references.primary, ...input.references.variants].some((reference) => reference?.form === "mobile"))
    && (!item.needsCutout || input.references.primary?.photoKind !== "scene"));
  const primaryPool = eligible.filter((item) => !item.onlyAsAlternative);
  // Todas as linguagens principais já usadas nas telas anteriores (carrossel longo): repete uma delas em vez de
  // cair na alternativa (5ª tela tipográfica "vazia" na Preço Baixo Club, 26/11/2026).
  const reusable = primaryPool.length ? [] : available.filter((item) => !item.onlyAsAlternative && (input.exclude ?? []).includes(item.id)
    && (input.allowAi || item.operation === "deterministic_composite") && (!item.minVariants || variants >= item.minVariants)
    && (!item.needsMobileCapture || [input.references.primary, ...input.references.variants].some((reference) => reference?.form === "mobile"))
    && (!item.needsCutout || input.references.primary?.photoKind !== "scene"));
  const pool = primaryPool.length ? primaryPool : reusable.length ? reusable : eligible;
  // Arquétipos "só como alternativa" (ex.: frase tipográfica) entram no fim da fila de troca. Antes ficavam
  // de fora: pauta conceitual reprovada por repetição não tinha para onde trocar (produção, 26/11/2026).
  const backups = eligible.filter((item) => !pool.includes(item)).map((item) => item.id);
  if (input.seriesArchetype) {
    const series = pool.find((item) => item.id === input.seriesArchetype);
    if (series) return { archetype: series, score: 0, reasons: ["Mesma família visual da série (carrossel/campanha padronizada)."], alternatives: [...pool.filter((item) => item !== series).map((item) => item.id), ...backups] };
  }
  if (!pool.length) {
    const fallback = available.find((item) => item.operation === "deterministic_composite")!;
    return { archetype: fallback, score: 0, reasons: ["Único arquétipo disponível para este modo."], alternatives: [] };
  }
  const scored = pool.map((archetype) => {
    const affinity = (text.match(new RegExp(archetype.affinity.source, "g")) ?? []).length;
    const recency = archetypeRecencyPenalty(archetype.id, input.history, input.seriesKey);
    const tieBreak = (stableHash(`${input.seed}:${archetype.id}`) % 1000) / 10_000;
    const learned = input.bias?.[archetype.id] ?? 0;
    return { archetype, affinity, recency, learned, score: Math.min(affinity, 3) * 1.2 - recency * 1.5 + learned + tieBreak };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const reasons = [
    best.affinity ? `A pauta combina com "${best.archetype.label}" (${best.affinity} sinal(is) no texto).` : `"${best.archetype.label}" escolhido para variar em relação às peças recentes.`,
    ...(best.recency ? [`Uso recente pesou ${best.recency.toFixed(2)} contra este arquétipo.`] : []),
    ...(best.learned ? [`Memória da marca: ${best.learned > 0 ? "aprovada" : "reprovada"} em peças recentes (${best.learned > 0 ? "+" : ""}${best.learned.toFixed(2)}).`] : []),
    ...scored.filter((item) => item.learned < 0 && item !== best).slice(0, 2).map((item) => `Memória da marca: "${item.archetype.label}" perdeu ${Math.abs(item.learned).toFixed(2)} por reprovações recorrentes.`),
  ];
  // Já usados (ex.: telas anteriores do carrossel) voltam ao fim da fila: melhor repetir um arquétipo da
  // série do que ficar sem alternativa quando a peça é reprovada.
  const excludedAgain = available.filter((item) => (input.exclude ?? []).includes(item.id)
    && (input.allowAi || item.operation === "deterministic_composite") && (!item.minVariants || variants >= item.minVariants)
    && (!item.needsMobileCapture || [input.references.primary, ...input.references.variants].some((reference) => reference?.form === "mobile"))
    && (!item.needsCutout || input.references.primary?.photoKind !== "scene"));
  return { archetype: best.archetype, score: best.score, reasons, alternatives: [...scored.slice(1).map((item) => item.archetype.id), ...backups, ...excludedAgain.map((item) => item.id).filter((id) => !backups.includes(id))] };
}

export type CreativeSpec = {
  workspaceId: string;
  brand: string;
  brandIdentity?: Pick<BrandIdentity, "colors" | "notes">;
  visualDirection?: string;
  presentation?: "fashion_campaign";
  objective?: string;
  audience?: string;
  /** Produto (código + variante) ou funcionalidade divulgada. */
  subject: { kind: "product"; productCode?: string; variant?: string } | { kind: "feature"; key?: string; label?: string } | { kind: "concept" };
  mainMessage: string;
  valueProposition?: string;
  mode: VisualMode;
  modeLabel: string;
  modeReasons: string[];
  composition: { archetype: string; label: string; operation: CompositionOperation; textLayout: "top" | "left" | "bottom"; intent: string; fallback?: string; reasons: string[]; alternatives: string[] };
  requiredReferences: Array<{ id: string; role: ClassifiedReference["role"]; label?: string }>;
  complementaryReferences: Array<{ id: string; role: ClassifiedReference["role"] }>;
  fidelityConstraints: string[];
  desiredElements: string[];
  avoid: string[];
  headline: string;
  supportingText?: string;
  cta?: string;
  format: { width: number; height: number; aspectRatio: "4:5" };
  network: string[];
  immutable: string[];
  /** Pendências que impedem a geração (falta de referência obrigatória). */
  blockers: ReferenceGuidance[];
  seriesKey?: string;
  /** Aprendizado da marca (reprovações recorrentes) que a imagem precisa respeitar. */
  learned?: string[];
};

export type BuildCreativeSpecInput = {
  workspaceId: string;
  brand: { name: string; identity?: CreativeSpec["brandIdentity"]; presentation?: CreativeSpec["presentation"] };
  idea: VisualIntentIdea & { id: string; targetAudience?: string; cta?: string };
  screen: { headline: string; body?: string; cta?: string };
  decision: VisualIntentDecision;
  references: ResolvedReferences;
  history: readonly VisualFingerprint[];
  allowAi: boolean;
  networks?: string[];
  seriesKey?: string;
  seriesArchetype?: string;
  excludeArchetypes?: readonly string[];
  /** Linguagens que a marca não usa. */
  avoidArchetypes?: readonly string[];
  /** Memória criativa da marca (ver creative-memory.ts). */
  memory?: { archetypeBias?: Readonly<Record<string, number>>; guidance?: readonly string[] };
};

const PRODUCT_IMMUTABLE = ["forma e modelagem da peça", "cor comercial", "estampa (desenho, posição e proporção)", "logotipos e etiquetas visíveis", "variante anunciada"];
const PRODUCT_CREATIVE = ["cenário", "iluminação", "fundo", "elementos decorativos", "enquadramento", "tipografia", "chamada comercial"];

export function buildCreativeSpec(input: BuildCreativeSpecInput): CreativeSpec {
  const { decision, references } = input;
  const brandIdentity = input.brand.identity;
  const direction = input.idea.visualDirection?.trim();
  const visualDirection = direction === "Seguir a identidade visual da marca." || direction === "Usar as imagens de referência da ideia." ? undefined : direction;
  const choice = chooseComposition({
    mode: decision.mode, presentation: input.brand.presentation, idea: input.idea, references, history: input.history, seriesKey: input.seriesKey,
    seriesArchetype: input.seriesArchetype, allowAi: input.allowAi, exclude: input.excludeArchetypes, avoid: input.avoidArchetypes, bias: input.memory?.archetypeBias, seed: input.idea.id,
  });
  const primary = references.primary;
  const subject: CreativeSpec["subject"] = decision.mode === "physical_product"
    ? { kind: "product", productCode: primary?.productCode, variant: primary?.variantLabel }
    : decision.mode === "software"
      ? { kind: "feature", key: decision.feature?.feature.key, label: decision.feature?.feature.label ?? primary?.name }
      : { kind: "concept" };
  const fidelityConstraints = decision.mode === "physical_product"
    ? [
      "Usar a fotografia original selecionada como referência principal.",
      "Preservar cor, formato, estampa, logotipos e etiquetas — não inventar detalhes.",
      "Não trocar o produto por outro semelhante nem por print de loja/catálogo.",
      "Se a IA não preservar o produto, recompor com a fotografia original.",
    ]
    : decision.mode === "software"
      ? [
        "A interface exibida é a captura real selecionada, inserida por composição geométrica.",
        "Nada de tela vazia, painel genérico ou interface inventada pela IA.",
        "Captura legível: sem distorção que impeça a leitura.",
      ]
      : ["Liberdade visual dentro da identidade da marca.", "Não simular produto ou interface reais."];
  const avoid = decision.mode === "physical_product"
    ? ["prints de catálogo", "troca da estampa", "mudança de cor", "produto diferente", "cabides ou araras vazios", "repetir a composição das peças anteriores"]
    : decision.mode === "software"
      ? ["papéis e pastas genéricos", "telas vazias", "fotografias sem relação com o sistema", "interface fictícia"]
      : ["logotipos inventados", "texto dentro da imagem gerada"];
  return {
    workspaceId: input.workspaceId,
    brand: input.brand.name,
    ...(brandIdentity ? { brandIdentity: { colors: brandIdentity.colors, notes: brandIdentity.notes } } : {}),
    ...(visualDirection ? { visualDirection } : {}),
    ...(input.brand.presentation ? { presentation: input.brand.presentation } : {}),
    objective: input.idea.objective,
    audience: input.idea.targetAudience,
    subject,
    mainMessage: input.screen.headline,
    valueProposition: input.idea.concept,
    mode: decision.mode,
    modeLabel: VISUAL_MODE_LABELS[decision.mode],
    modeReasons: decision.reasons,
    composition: {
      archetype: choice.archetype.id, label: choice.archetype.label, operation: choice.archetype.operation, textLayout: choice.archetype.textLayout,
      intent: choice.archetype.intent, ...(choice.archetype.fallback ? { fallback: input.brand.presentation === "fashion_campaign" && decision.mode === "physical_product" ? "fashion_poster" : choice.archetype.fallback } : {}), reasons: choice.reasons, alternatives: choice.alternatives,
    },
    requiredReferences: [...(primary ? [primary] : []), ...references.variants].map((reference) => ({ id: reference.id, role: reference.role, ...(reference.variantLabel ? { label: reference.variantLabel } : reference.name ? { label: reference.name } : {}) })),
    complementaryReferences: references.complementary.map((reference) => ({ id: reference.id, role: reference.role })),
    fidelityConstraints,
    desiredElements: decision.mode === "physical_product" ? PRODUCT_CREATIVE : decision.mode === "software" ? ["captura real da funcionalidade", "destaque do benefício concreto", "identidade da marca"] : ["conceito da pauta em imagem", "identidade da marca"],
    avoid,
    headline: input.screen.headline,
    ...(input.screen.body ? { supportingText: input.screen.body } : {}),
    ...(input.screen.cta ?? input.idea.cta ? { cta: input.screen.cta ?? input.idea.cta } : {}),
    format: { width: 1080, height: 1350, aspectRatio: "4:5" },
    network: input.networks ?? ["instagram", "facebook"],
    immutable: decision.mode === "physical_product" ? PRODUCT_IMMUTABLE : decision.mode === "software" ? ["conteúdo e layout da interface capturada"] : [],
    blockers: references.missing.filter((item) => item.blocking),
    ...(input.seriesKey ? { seriesKey: input.seriesKey } : {}),
    ...(input.memory?.guidance?.length ? { learned: [...input.memory.guidance] } : {}),
  };
}

export function sceneArtDirection(spec: Pick<CreativeSpec, "brandIdentity" | "visualDirection">): string[] {
  const colors = spec.brandIdentity?.colors ?? [];
  const notes = spec.brandIdentity?.notes?.trim();
  return [
    ...(colors.length ? [`Paleta da marca (respeite a hierarquia e o uso indicado no nome da cor): ${colors.map(({ name, hex, role }) => `${name} ${hex} (${role})`).join(", ")}.`] : []),
    ...(notes ? [`Perfil da marca: ${notes}`] : []),
    ...(spec.visualDirection ? [`Direção visual da pauta: ${spec.visualDirection}`] : []),
  ];
}

/**
 * Instrução concreta para o gerador de imagem, derivada da especificação — nunca um prompt genérico.
 * `referenceOrder` descreve, na ordem de envio, o papel de cada imagem anexada.
 */
export function buildImageInstruction(spec: CreativeSpec, referenceOrder: readonly ClassifiedReference[], correction?: string): string {
  const attachments = referenceOrder.map((reference, index) => {
    const what = reference.role === "product_photo"
      ? `FOTO ORIGINAL do produto anunciado${reference.productCode ? ` (${reference.productCode}${reference.variantLabel ? `, ${reference.variantLabel}` : ""})` : ""}`
      : reference.role === "product_variant" ? `variação real do mesmo produto${reference.variantLabel ? ` (${reference.variantLabel})` : ""}`
        : reference.role === "software_capture" ? "captura real da interface (só para entender o tema; a tela será inserida depois)"
          : reference.role === "style_reference" ? "referência de estilo (luz, clima) — não altera o produto"
            : "inspiração visual — não altera o produto";
    return `Imagem ${index + 1}: ${what}.`;
  });
  const lines = [
    `Marca: ${spec.brand}. Modo: ${spec.modeLabel}. Composição: ${spec.composition.label} — ${spec.composition.intent}`,
    `Mensagem da peça: ${spec.mainMessage}${spec.supportingText ? ` / ${spec.supportingText}` : ""}.`,
    ...sceneArtDirection(spec),
    ...(spec.presentation === "fashion_campaign" ? ["Direção de campanha streetwear: um ponto focal forte, enquadramento de moda, contraste intencional, textura tátil e espaço para uma manchete curta. Quando o briefing pedir futurismo, use luz de recorte, reflexo metálico e perspectiva; evite interfaces, tabelas, grades de produtos, molduras de e-commerce e sci-fi decorativo."] : []),
    ...(attachments.length ? ["Imagens anexadas, nesta ordem:", ...attachments] : []),
  ];
  if (spec.mode === "physical_product") {
    lines.push(
      "PRODUTO IMUTÁVEL — reproduza a peça da Imagem 1 exatamente: " + spec.immutable.join("; ") + ".",
      "Não redesenhe, não simplifique e não 'melhore' a estampa; mesma posição e proporção no peito. Sem marcas de terceiros que não estejam na foto.",
      "Pode criar: " + spec.desiredElements.join(", ") + ". A peça é a protagonista, inteira e bem iluminada.",
    );
  } else if (spec.mode === "software") {
    lines.push(
      "Crie SOMENTE o cenário. Não desenhe telas, interfaces, monitores ligados nem celulares com conteúdo: a interface real será inserida por composição na área reservada.",
      "Deixe a área reservada livre e plana (mesa/superfície limpa), com luz coerente para receber um dispositivo.",
    );
  } else {
    lines.push(
      `Traduza o conceito na linguagem "${spec.composition.label}" descrita acima, com os elementos e a paleta da direção visual (a direção diz O QUE mostrar; a composição diz COMO encenar).`,
      "Direção de arte: um ponto focal forte, ângulo ou enquadramento incomum, luz com intenção e uma ideia visual que faça parar o scroll. Nada de banco de imagens genérico (pessoas sorrindo para a câmera, mesa de escritório arrumada sem propósito, aperto de mão).",
      "Reserve as cores de apoio a pequenos detalhes quando o perfil pedir. Sem letras, números ou logotipos.",
    );
  }
  lines.push("Evite: " + spec.avoid.join(", ") + ".");
  if (spec.learned?.length) lines.push("APRENDIZADO DA MARCA (problemas que o cliente já reprovou mais de uma vez — não repita):", ...spec.learned.map((item) => `- ${item}`));
  lines.push("Nenhum texto, letra, número, logotipo ou marca d'água na imagem — o texto é aplicado depois pelo renderizador.");
  if (correction) lines.push(`CORREÇÃO DIRECIONADA desta tentativa: ${correction}`);
  return lines.join("\n");
}
