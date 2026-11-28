/**
 * DIRETOR CRIATIVO AUTÔNOMO — camada compartilhada ANTES da produção de imagem, carrossel e vídeo.
 *
 * A Vorix montava peças a partir do que a pauta já trazia escrito (o conceito era o texto do Bolsão; a
 * composição saía de uma regra determinística). Aqui a IA CRIA: entende a intenção, separa o que é
 * obrigatório do que é livre, olha o que existe de material, concebe alternativas internas DISTINTAS,
 * avalia impacto/originalidade/viabilidade e escolhe uma — antes de gastar com geração ou render.
 *
 * Economia: as alternativas nascem e são escolhidas NUMA chamada (texto); nada é renderizado três vezes.
 * No vídeo a direção vem dentro da própria chamada de planejamento (zero chamada extra); na imagem é uma
 * chamada de texto curta antes da geração (a geração custa muito mais).
 *
 * Módulo puro (sem rede): prompt, schema, validação e seleção determinísticas. Quem chama (piloto: backend
 * no container + scripts do host) executa o Codex e grava a direção no rastro da peça — é dali que a
 * memória lê os conceitos recentes (sem infraestrutura paralela de memória).
 */

export type CreativeMedium = "image" | "carousel" | "video";

/**
 * Linguagens publicitárias que o diretor conhece. NÃO são templates: cada uma diz o que é e como costuma ser
 * executável com o que a Vorix tem; o diretor pode combinar ou inventar outra.
 */
export type AdvertisingLanguage = { id: string; label: string; what: string; image: string; video: string };

export const ADVERTISING_LANGUAGES: readonly AdvertisingLanguage[] = [
  { id: "suspense", label: "Suspense cinematográfico", what: "segura a informação e cria tensão até a virada", image: "luz baixa, recorte dramático, o essencial parcialmente escondido", video: "tensão crescente, silêncio antes da revelação, máscara que abre" },
  { id: "humor_situacao", label: "Humor e situação inesperada", what: "uma situação cotidiana que sai do previsível e faz sorrir", image: "cena com um detalhe fora do lugar que conta a piada", video: "situação narrada com virada cômica e ritmo de esquete" },
  { id: "humor_absurdo", label: "Humor absurdo proposital", what: "exagero deliberado que torna a dor memorável", image: "objeto do dia a dia em escala ou papel absurdo", video: "exagero visual animado, contagem ou relógio fora de controle" },
  { id: "quebra_expectativa", label: "Quebra de expectativa", what: "começa parecendo uma coisa e revela outra", image: "composição que engana o olho e o texto vira a leitura", video: "abertura que parece outro assunto e corte seco para a verdade" },
  { id: "metafora_visual", label: "Metáfora visual", what: "um objeto ou cena que materializa a ideia abstrata", image: "still life conceitual de um único objeto simbólico", video: "objeto metafórico revelado por máscara com paralaxe" },
  { id: "storytelling", label: "Storytelling emocional", what: "um personagem e um momento verdadeiro com antes e depois", image: "cena editorial com um momento humano real", video: "arco curto: tensão, virada e alívio com narração contínua" },
  { id: "problema_solucao", label: "Problema e solução", what: "mostra a dor concreta e a saída", image: "contraste entre o problema e o alívio na mesma peça", video: "dor demonstrada, interrupção de ritmo, solução revelada" },
  { id: "comparacao", label: "Comparação criativa", what: "dois caminhos lado a lado, um claramente melhor", image: "divisão da cena em dois lados com o mesmo enquadramento", video: "tela dividida que vira para o lado vencedor" },
  { id: "revelacao", label: "Revelação surpreendente", what: "pista, expectativa e resposta", image: "detalhe em macro que pede a peça inteira", video: "do macro ao inteiro, contagem curta e resposta" },
  { id: "demonstracao", label: "Demonstração de produto", what: "prova o benefício mostrando o produto real funcionando", image: "o produto real em uso ou no detalhe que comprova", video: "material real com destaque da região que importa" },
  { id: "provocacao", label: "Campanha provocativa", what: "uma pergunta ou afirmação que incomoda e faz pensar", image: "frase forte com uma imagem tensa e econômica", video: "pergunta direta na abertura e resposta no fim" },
  { id: "motion_conceitual", label: "Motion graphics conceitual", what: "formas, números e tipografia animados contam a ideia", image: "composição gráfica com formas da marca", video: "relógio, contagem, gráfico ou formas animadas com função narrativa" },
  { id: "minimalista", label: "Publicidade minimalista", what: "quase nada na tela, uma ideia só, muito espaço", image: "um elemento, muito respiro, tipografia precisa", video: "poucos planos longos, corte seco e silêncio usado" },
  { id: "educativo", label: "Narrativa educativa", what: "ensina algo útil em passos claros", image: "passos visuais numerados com hierarquia clara", video: "passos com tipografia cinética e prova em cada um" },
  { id: "documental", label: "Narrativa documental", what: "verdade do processo, bastidor e gente real", image: "fotografia documental do processo real", video: "gravações reais do cliente, cortes próximos e som ambiente" },
  { id: "transformacao", label: "Transformação visual", what: "antes e depois na mesma peça", image: "mesmo enquadramento em dois estados", video: "transição motivada do antes para o depois" },
  { id: "conceito_original", label: "Conceito original", what: "uma ideia própria que não cabe nas anteriores", image: "a encenação que o conceito pedir", video: "os recursos que o conceito pedir" },
];

/** Arquétipos de imagem (creative-spec.ts) que costumam executar bem cada linguagem, em ordem de preferência. */
const IMAGE_ARCHETYPES_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  suspense: ["concept_closeup", "concept_scene", "fashion_poster", "print_detail"],
  humor_situacao: ["concept_scene", "product_lifestyle"],
  humor_absurdo: ["concept_metaphor", "concept_3d", "concept_scene"],
  quebra_expectativa: ["concept_metaphor", "concept_closeup", "concept_scene"],
  metafora_visual: ["concept_metaphor", "concept_3d"],
  storytelling: ["concept_scene", "product_lifestyle"],
  problema_solucao: ["concept_scene", "ui_focus", "concept_metaphor"],
  comparacao: ["concept_metaphor", "variant_lineup", "concept_scene"],
  revelacao: ["print_detail", "concept_closeup", "fashion_poster"],
  demonstracao: ["print_detail", "ui_focus", "device_laptop", "product_studio"],
  provocacao: ["concept_closeup", "concept_metaphor", "commercial_bold"],
  motion_conceitual: ["concept_3d", "concept_metaphor"],
  minimalista: ["concept_closeup", "product_studio", "concept_metaphor"],
  educativo: ["ui_focus", "concept_scene", "browser_window"],
  documental: ["concept_scene", "product_scene", "product_lifestyle"],
  transformacao: ["concept_scene", "concept_metaphor"],
};

// ----------------------------------------------------------------------------------- briefing do cliente

export type BriefingClassification = {
  /** O que o cliente quer comunicar (a intenção, não a forma). */
  intent: string;
  required: string[];
  preferences: string[];
  suggestions: string[];
  /** Decisões que ficam com a IA (o cliente não falou delas). */
  free: string[];
  /** Linguagens pedidas explicitamente (ex.: "usar suspense"). */
  requestedLanguages: string[];
};

const REQUIRED_RE = /\b(obrigat\w*|sempre|nunca|jamais|n[aã]o (use|usar|mostre|mostrar|fale|falar|coloque|colocar|invente|inventar|cite|citar|altere|alterar)|deve(m)?|precisa(m)?|tem que|t[eê]m que|exatamente|somente|apenas|proibid\w*|mantenha|manter|indispens\w*)\b/i;
const PREFERENCE_RE = /\b(prefer\w*|gostaria|idealmente|de prefer[eê]ncia|se poss[ií]vel|quero que|destac\w*|enfatiz\w*|priorize|priorizar)\b/i;
const SUGGESTION_RE = /\b(pode(ria)?|talvez|sugest\w*|que tal|algo como|por exemplo|ex\.?:|uma ideia)\b/i;

const LANGUAGE_WORDS: ReadonlyArray<[string, RegExp]> = [
  ["suspense", /\bsuspense\b|\bmist[eé]rio\b|\btens[aã]o\b/i],
  ["humor_situacao", /\bhumor\b|\bengra[cç]ad\w*|\bdivertid\w*|\bcom[eé]di\w*/i],
  ["humor_absurdo", /\babsurd\w*|\bexager\w*/i],
  ["quebra_expectativa", /\bquebra de expectativa\b|\binesperad\w*|\bsurpreend\w*/i],
  ["metafora_visual", /\bmet[aá]fora\w*/i],
  ["storytelling", /\bstorytelling\b|\bhist[oó]ria\b|\bemocion\w*/i],
  ["problema_solucao", /\bproblema e solu[cç][aã]o\b|\bdor\b/i],
  ["comparacao", /\bcompara\w*|\bantes e depois\b|\bversus\b|\bvs\.?\b/i],
  ["revelacao", /\brevela\w*/i],
  ["demonstracao", /\bdemonstr\w*|\btutorial\b|\bmostrar funcionando\b/i],
  ["provocacao", /\bprovoca\w*|\bpol[eê]mic\w*/i],
  ["motion_conceitual", /\bmotion\b|\banima[cç][aã]o\b|\bgr[aá]fico\w* animad\w*/i],
  ["minimalista", /\bminimalis\w*|\bclean\b/i],
  ["educativo", /\beducativ\w*|\bensin\w*|\bdica\w*|\bpasso a passo\b/i],
  ["documental", /\bdocumental\b|\bbastidor\w*/i],
  ["transformacao", /\btransforma\w*/i],
];

/** Decisões criativas e as palavras que indicam que o cliente já tomou essa decisão. */
const DECISIONS: ReadonlyArray<[string, RegExp]> = [
  ["linguagem publicitária", /\b(suspense|humor|met[aá]fora|storytelling|revela\w*|compara\w*|minimalis\w*|provoca\w*|documental|educativ\w*)\b/i],
  ["gancho de abertura", /\b(gancho|abertura|come[cç]\w* com|primeiros segundos)\b/i],
  ["enquadramento e composição", /\b(close|macro|enquadra\w*|composi[cç][aã]o|plano)\b/i],
  ["ritmo e montagem", /\b(ritmo|r[aá]pid\w*|lent\w*|cortes?|din[aâ]mic\w*)\b/i],
  ["trilha e efeitos sonoros", /\b(m[uú]sica|trilha|som|efeito sonoro)\b/i],
  ["animações e transições", /\b(anima\w*|transi[cç]\w*|efeito\w*)\b/i],
  ["paleta e luz da cena", /\b(cor(es)?|paleta|luz|ilumina\w*|escur\w*|clar\w*)\b/i],
  ["revelação e encerramento", /\b(revela\w*|final|encerr\w*|fecha\w*)\b/i],
];

const sentences = (text: string) => text.split(/(?<=[.!?;])\s+|\n+/).map((item) => item.trim()).filter((item) => item.length > 2);

/**
 * Classifica o briefing (texto livre da pauta: prompt criativo, direção visual, abordagem, estrutura) em
 * obrigatório / preferência / sugestão; o resto vira contexto. O que o cliente não citou fica livre para a IA.
 * Determinístico — a IA recebe a classificação e não precisa "adivinhar" o peso de cada frase.
 */
export function classifyBriefing(input: { intent: string; instructions: ReadonlyArray<string | undefined> }): BriefingClassification {
  const all = input.instructions.filter((item): item is string => Boolean(item?.trim()));
  const required: string[] = [];
  const preferences: string[] = [];
  const suggestions: string[] = [];
  for (const sentence of all.flatMap(sentences)) {
    if (REQUIRED_RE.test(sentence)) required.push(sentence);
    else if (PREFERENCE_RE.test(sentence)) preferences.push(sentence);
    else if (SUGGESTION_RE.test(sentence)) suggestions.push(sentence);
    else preferences.push(sentence);
  }
  const text = `${input.intent} ${all.join(" ")}`;
  const requestedLanguages = LANGUAGE_WORDS.filter(([, re]) => re.test(all.join(" "))).map(([id]) => id);
  const free = DECISIONS.filter(([, re]) => !re.test(all.join(" "))).map(([label]) => label);
  const cap = (list: string[]) => [...new Set(list)].slice(0, 8).map((item) => item.slice(0, 240));
  return { intent: input.intent.trim().slice(0, 300) || text.slice(0, 300), required: cap(required), preferences: cap(preferences), suggestions: cap(suggestions), free, requestedLanguages };
}

// ----------------------------------------------------------------------------------- materiais disponíveis

export type MaterialInventory = {
  have: string[];
  produceLocally: string[];
  imageEngine: string[];
  /** O que pediria vídeo realista que a Vorix NÃO tem: o conceito precisa de outra execução. */
  unavailable: string[];
  footage: boolean;
  productPhotos: boolean;
  screens: boolean;
};

/** O que o diretor pode usar, produzir ou não tem — para conceber só o que é executável. */
export function materialInventory(input: { medium: CreativeMedium; productPhotos?: number; footage?: number; screens?: number; logo?: boolean; references?: number; conceptImages?: boolean }): MaterialInventory {
  const have = [
    ...(input.productPhotos ? [`${input.productPhotos} foto(s) oficial(is) de produto`] : []),
    ...(input.footage ? [`${input.footage} gravação(ões) real(is) do cliente`] : []),
    ...(input.screens ? [`${input.screens} captura(s)/gravação(ões) de tela real(is)`] : []),
    ...(input.logo ? ["logotipo oficial"] : []),
    ...(input.references ? [`${input.references} referência(s) de estilo da marca`] : []),
  ];
  const produceLocally = input.medium === "video"
    ? ["tipografia cinética", "relógio/cronômetro animado (clock)", "contagem ou número animado (counter — só número que a pauta traz)", "comparação em tela dividida (versus)", "revelação por máscara com paralaxe (mask_reveal)", "câmera simulada sobre foto (zoom, pan, macro→inteiro)", "callouts e destaque de região", "trilha composta e efeitos sonoros próprios", "narração local quando o fluxo tiver voz"]
    : ["composição programática com a foto/tela real", "tipografia com hierarquia", "elementos gráficos da marca"];
  const imageEngine = input.conceptImages === false ? [] : ["imagem conceitual/metafórica gerada (cena, objeto, still life, 3D)", ...(input.productPhotos ? ["produto real em nova cena (edição com a foto oficial como referência)"] : [])];
  const unavailable = [
    ...(input.footage ? [] : ["filmagem real de pessoas, gestos ou processo (não existe material)"]),
    "vídeo realista gerado de pessoas (serviço pago não habilitado)",
    "memes, músicas ou imagens de terceiros sem direito de uso",
  ];
  return { have, produceLocally, imageEngine, unavailable, footage: Boolean(input.footage), productPhotos: Boolean(input.productPhotos), screens: Boolean(input.screens) };
}

// ----------------------------------------------------------------------------------- prompt e schema

export type RecentConcept = { name: string; language?: string; idea?: string };

export type CreativeBriefInput = {
  medium: CreativeMedium;
  brand: { name: string; positioning?: string; tone?: string; audience?: string };
  idea: { title: string; objective?: string; concept?: string; keyMessage?: string; cta?: string; audience?: string };
  briefing: BriefingClassification;
  inventory: MaterialInventory;
  facts?: readonly string[];
  recentConcepts?: readonly RecentConcept[];
  lessons?: readonly string[];
  references?: ReadonlyArray<{ name: string; guidance?: string }>;
};

const QUESTIONS: Record<CreativeMedium, string[]> = {
  video: [
    "O que prende a atenção nos 2 primeiros segundos (sem abrir com logotipo)?",
    "Por que alguém continuaria assistindo?",
    "Qual emoção a peça quer provocar?",
    "Qual história é contada (tensão → virada → ação)?",
    "Quando o produto ou benefício aparece e qual é a revelação?",
    "Como encerrar de forma convincente, com a chamada da pauta?",
  ],
  image: [
    "Qual é o gancho visual que faz parar o scroll?",
    "Qual metáfora, situação ou encenação traduz a mensagem sem explicar demais?",
    "Qual emoção a peça quer provocar?",
    "Onde fica o produto/benefício e como o texto completa a imagem?",
  ],
  carousel: [
    "Qual capa faz abrir o carrossel (gancho visual)?",
    "Como as telas progridem (tensão → prova → ação) sem repetir a mesma composição?",
    "Qual emoção a peça quer provocar?",
    "Como a última tela fecha com a chamada da pauta?",
  ],
};

/** Seção do prompt com a direção criativa (a mesma para imagem, carrossel e vídeo). */
export function creativeBriefLines(input: CreativeBriefInput): string[] {
  const { briefing, inventory } = input;
  const list = (title: string, items: readonly string[]) => (items.length ? [title, ...items.map((item) => `- ${item}`)] : []);
  return [
    `DIREÇÃO CRIATIVA AUTÔNOMA — você CRIA a campanha (não preenche um modelo). O cliente disse o que quer comunicar; o conceito, a linguagem e a encenação são decisão sua, fundamentada.`,
    `Marca: ${input.brand.name}${input.brand.positioning ? ` — ${input.brand.positioning}` : ""}${input.brand.tone ? ` · tom: ${input.brand.tone}` : ""}${input.brand.audience ?? input.idea.audience ? ` · público: ${input.brand.audience ?? input.idea.audience}` : ""}.`,
    `Pauta: ${input.idea.title}${input.idea.keyMessage ? ` — ${input.idea.keyMessage}` : ""}${input.idea.objective ? ` · objetivo: ${input.idea.objective}` : ""}${input.idea.cta ? ` · chamada: ${input.idea.cta}` : ""}.`,
    `Intenção do cliente: ${briefing.intent}`,
    ...list("OBRIGATÓRIO (cumpra à risca):", briefing.required),
    ...list("PREFERÊNCIAS (siga, salvo motivo forte):", briefing.preferences),
    ...list("SUGESTÕES (use se servirem ao conceito):", briefing.suggestions),
    ...(briefing.requestedLanguages.length ? [`Linguagem pedida pelo cliente: ${briefing.requestedLanguages.map((id) => ADVERTISING_LANGUAGES.find((item) => item.id === id)?.label ?? id).join(", ")} — honre isso em todos os conceitos.`] : []),
    `Decisões livres para você: ${briefing.free.join(", ") || "as que o briefing não fixou"}.`,
    ...list("FATOS COMPROVADOS (os únicos números, preços, prazos e benefícios que podem aparecer):", input.facts ?? []),
    `Nunca invente preço, desconto, funcionalidade, depoimento, número ou benefício que não esteja na pauta ou nos fatos.`,
    ...list("MATERIAIS QUE JÁ EXISTEM:", inventory.have.length ? inventory.have : ["nenhum material próprio além da identidade da marca"]),
    ...list("O QUE A VORIX PRODUZ SOZINHA:", inventory.produceLocally),
    ...list("O QUE O MOTOR DE IMAGEM GERA:", inventory.imageEngine),
    ...list("NÃO DISPONÍVEL (troque por outra execução, nunca finja):", inventory.unavailable),
    ...list("REFERÊNCIAS DA MARCA (inspiram direção, ritmo e acabamento; não copie):", (input.references ?? []).map((item) => `${item.name}${item.guidance ? `: ${item.guidance}` : ""}`)),
    ...list("CONCEITOS RECENTES DESTA MARCA (não repita nem faça quase igual):", (input.recentConcepts ?? []).map((item) => `${item.name}${item.language ? ` (${item.language})` : ""}${item.idea ? ` — ${item.idea}` : ""}`)),
    ...list("APRENDIZADO DA MARCA (reprovações recorrentes — não repita):", input.lessons ?? []),
    `LINGUAGENS (repertório aberto — combine ou crie outra; nenhuma é obrigatória): ${ADVERTISING_LANGUAGES.map((item) => `${item.label} (${item.what})`).join("; ")}.`,
    `A ideia decide as ferramentas, não o contrário: não escolha um recurso (relógio, contagem, tela dividida, máscara…) só porque ele existe — ele entra quando é a melhor forma de contar ESTE conceito. Os 3 conceitos não podem depender do mesmo recurso central.`,
    `Antes de decidir, responda para você: ${QUESTIONS[input.medium].join(" ")}`,
    `Conceba 3 conceitos REALMENTE DIFERENTES entre si (linguagem, gancho e encenação distintos — não três variações do mesmo). Para cada um dê notas inteiras de 1 a 5, com rigor (5 é excepcional e raro; notas iguais em tudo não ajudam a escolher): impact (para o scroll e lembrança), originality (fora do óbvio do segmento e dos recentes), feasibility (executável com o que existe acima, sem material inexistente), brandFit (tom e posicionamento). Escolha o melhor em chosen e justifique em rationale. Evite como padrão "produto centralizado + título + fundo + logo" e "abrir com logotipo"; use só quando for a melhor ideia.`,
  ];
}

const int15 = { type: "integer", minimum: 1, maximum: 5 } as const;
const text = { type: "string" } as const;

/** Schema ESTRITO (todas as chaves obrigatórias) para o `--output-schema` do Codex. */
export const creativeDirectionSchema = {
  type: "object", additionalProperties: false,
  required: ["intent", "objective", "emotion", "audienceInsight", "requiredCovered", "concepts", "chosen", "rationale"],
  properties: {
    intent: text, objective: text, emotion: text, audienceInsight: text,
    requiredCovered: { type: "array", items: text },
    concepts: {
      type: "array", minItems: 3, maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "name", "language", "idea", "hook", "story", "reveal", "closing", "visualDevice", "resources", "usesRealisticFootage", "impact", "originality", "feasibility", "brandFit"],
        properties: {
          id: { type: "string", enum: ["A", "B", "C"] }, name: text, language: text, idea: text, hook: text, story: text, reveal: text, closing: text, visualDevice: text,
          resources: { type: "array", items: text }, usesRealisticFootage: { type: "boolean" },
          impact: int15, originality: int15, feasibility: int15, brandFit: int15,
        },
      },
    },
    chosen: { type: "string", enum: ["A", "B", "C"] }, rationale: text,
  },
} as const;

// ----------------------------------------------------------------------------------- seleção determinística

export type CreativeConcept = {
  id: string; name: string; language: string; idea: string; hook: string; story: string; reveal: string; closing: string; visualDevice: string;
  resources: string[]; usesRealisticFootage: boolean; impact: number; originality: number; feasibility: number; brandFit: number;
};

export type CreativeDirection = {
  intent: string; objective: string; emotion: string; audienceInsight: string;
  concept: CreativeConcept;
  /** Por que este conceito (do Codex) e o que o sistema conferiu. */
  rationale: string;
  decision: "codex" | "override" | "fallback";
  score: number;
  alternatives: Array<{ id: string; name: string; language: string; score: number; rejected?: string }>;
  warnings: string[];
};

const clamp15 = (value: unknown) => Math.max(1, Math.min(5, Math.round(Number(value) || 1)));
const cut = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const words = (value: string) => new Set(value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length > 3));

/** Similaridade (Jaccard) entre dois conceitos — nome, ideia e recurso visual. */
export function conceptSimilarity(a: { name: string; idea?: string; visualDevice?: string }, b: { name: string; idea?: string; visualDevice?: string }): number {
  const x = words(`${a.name} ${a.idea ?? ""} ${a.visualDevice ?? ""}`);
  const y = words(`${b.name} ${b.idea ?? ""} ${b.visualDevice ?? ""}`);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const item of x) if (y.has(item)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/** Nota ponderada: impacto e originalidade pesam mais; viabilidade e marca garantem que dá para fazer bem. */
export const conceptScore = (c: Pick<CreativeConcept, "impact" | "originality" | "feasibility" | "brandFit">) =>
  Math.round((0.35 * c.impact + 0.3 * c.originality + 0.2 * c.feasibility + 0.15 * c.brandFit) * 100) / 100;

/**
 * Confere a escolha do Codex com regras objetivas e escolhe: conceito inviável (filmagem que não existe,
 * viabilidade ≤ 2), repetido em relação aos recentes da marca ou que ignora a linguagem pedida pelo cliente
 * não passa. Mantém a escolha do Codex quando válida e perto da melhor nota (o julgamento criativo é dele).
 */
export function selectCreativeDirection(raw: unknown, ctx: { inventory: Pick<MaterialInventory, "footage">; recentConcepts?: readonly RecentConcept[]; requestedLanguages?: readonly string[] }): CreativeDirection | undefined {
  const value = raw as Record<string, unknown> | undefined;
  const list = Array.isArray(value?.concepts) ? (value!.concepts as Array<Record<string, unknown>>) : [];
  const concepts: CreativeConcept[] = list.slice(0, 3).map((item, index) => ({
    id: cut(item.id, 1) || "ABC"[index]!, name: cut(item.name, 80), language: cut(item.language, 60), idea: cut(item.idea, 400), hook: cut(item.hook, 240), story: cut(item.story, 400),
    reveal: cut(item.reveal, 240), closing: cut(item.closing, 240), visualDevice: cut(item.visualDevice, 240),
    resources: (Array.isArray(item.resources) ? item.resources : []).map((resource) => cut(resource, 80)).filter(Boolean).slice(0, 8),
    usesRealisticFootage: item.usesRealisticFootage === true,
    impact: clamp15(item.impact), originality: clamp15(item.originality), feasibility: clamp15(item.feasibility), brandFit: clamp15(item.brandFit),
  })).filter((item) => item.name && item.idea);
  if (!concepts.length) return undefined;
  const requested = ctx.requestedLanguages ?? [];
  const languageOf = (concept: CreativeConcept) => {
    const text = `${concept.language} ${concept.name} ${concept.idea}`;
    return LANGUAGE_WORDS.filter(([, re]) => re.test(text)).map(([id]) => id);
  };
  const judged = concepts.map((concept) => {
    const recent = (ctx.recentConcepts ?? []).find((item) => conceptSimilarity(concept, item) >= 0.5);
    const rejected = concept.usesRealisticFootage && !ctx.inventory.footage ? "pede filmagem real que não existe"
      : concept.feasibility <= 2 ? "viabilidade baixa com os materiais disponíveis"
        : recent ? `quase igual ao conceito recente "${recent.name}"`
          : requested.length && !requested.some((id) => languageOf(concept).includes(id) || concept.language.toLowerCase().includes((ADVERTISING_LANGUAGES.find((item) => item.id === id)?.label ?? id).toLowerCase().split(" ")[0]!))
            ? "não usa a linguagem pedida pelo cliente" : undefined;
    return { concept, score: conceptScore(concept), rejected };
  });
  const valid = judged.filter((item) => !item.rejected).sort((a, b) => b.score - a.score);
  const codexId = cut(value?.chosen, 1);
  const codexPick = judged.find((item) => item.concept.id === codexId);
  let pick = codexPick && !codexPick.rejected && valid.length && codexPick.score >= valid[0]!.score - 0.5 ? codexPick : valid[0];
  const decision: CreativeDirection["decision"] = !pick ? "fallback" : pick === codexPick ? "codex" : "override";
  const warnings: string[] = [];
  if (!pick) {
    pick = [...judged].sort((a, b) => b.score - a.score)[0]!;
    warnings.push(`nenhum conceito passou nas restrições; usado o de maior nota (${pick.rejected})`);
  } else if (decision === "override") {
    warnings.push(codexPick?.rejected ? `escolha do Codex (${codexPick.concept.name}) descartada: ${codexPick.rejected}` : `escolha do Codex com nota bem abaixo da melhor alternativa`);
  }
  return {
    intent: cut(value?.intent, 300), objective: cut(value?.objective, 200), emotion: cut(value?.emotion, 80), audienceInsight: cut(value?.audienceInsight, 240),
    concept: pick.concept, rationale: cut(value?.rationale, 500), decision, score: pick.score,
    alternatives: judged.filter((item) => item !== pick).map((item) => ({ id: item.concept.id, name: item.concept.name, language: item.concept.language, score: item.score, ...(item.rejected ? { rejected: item.rejected } : {}) })),
    warnings,
  };
}

// ----------------------------------------------------------------------------------- uso pelos motores

/** Linhas que entram na instrução da IMAGEM (gerador) e na revisão da cena. */
export function directionImageLines(direction: CreativeDirection): string[] {
  const c = direction.concept;
  return [
    `CONCEITO CRIATIVO ESCOLHIDO: "${c.name}" (${c.language}) — ${c.idea}`,
    `Gancho visual: ${c.hook}. Recurso visual: ${c.visualDevice}.`,
    `Emoção a provocar: ${direction.emotion}. Encene o conceito na composição indicada; a imagem precisa contar a ideia sozinha, sem depender do texto.`,
  ];
}

/** Linhas que entram no plano do VÍDEO e na revisão editorial. */
export function directionVideoLines(direction: CreativeDirection): string[] {
  const c = direction.concept;
  return [
    `CONCEITO ESCOLHIDO: "${c.name}" (${c.language}) — ${c.idea}`,
    `Gancho: ${c.hook} · História: ${c.story} · Revelação: ${c.reveal} · Encerramento: ${c.closing}`,
    `Recurso visual central: ${c.visualDevice}. Emoção: ${direction.emotion}.`,
  ];
}

/**
 * Arquétipos de imagem a favorecer, na ordem, entre os PERMITIDOS para a peça (o motor determinístico decide
 * o que é possível; a direção só reordena dentro disso — nunca libera o que a marca ou o material vetam).
 */
export function preferredArchetypes(direction: CreativeDirection, allowed: readonly string[]): string[] {
  const text = `${direction.concept.language} ${direction.concept.name} ${direction.concept.visualDevice}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const fromLanguage = LANGUAGE_WORDS.filter(([, re]) => re.test(text)).flatMap(([id]) => IMAGE_ARCHETYPES_BY_LANGUAGE[id] ?? []);
  const fromDevice = [
    ...(/\b(macro|close|detalhe)\b/.test(text) ? ["concept_closeup", "print_detail"] : []),
    ...(/\b(3d|render|vidro|metal)\b/.test(text) ? ["concept_3d"] : []),
    ...(/\b(pessoa|cena|momento|cotidian\w*|situac\w*)\b/.test(text) ? ["concept_scene", "product_lifestyle"] : []),
    ...(/\b(objeto|simbol\w*|metafor\w*|still)\b/.test(text) ? ["concept_metaphor"] : []),
  ];
  return [...new Set([...fromDevice, ...fromLanguage])].filter((id) => allowed.includes(id));
}

/** Registro compacto da direção no rastro da peça (é dele que a memória lê os conceitos recentes). */
export function directionRecord(direction: CreativeDirection) {
  return {
    name: direction.concept.name, language: direction.concept.language, idea: direction.concept.idea, hook: direction.concept.hook, visualDevice: direction.concept.visualDevice,
    emotion: direction.emotion, decision: direction.decision, score: direction.score, alternatives: direction.alternatives.map((item) => `${item.name}${item.rejected ? ` (descartado: ${item.rejected})` : ""}`),
  };
}

/** Conceitos recentes a partir dos rastros guardados nas peças (mais recentes primeiro). */
export function recentConceptsFrom(records: ReadonlyArray<{ direction?: { name?: unknown; language?: unknown; idea?: unknown } | null } | null | undefined>, limit = 6): RecentConcept[] {
  const out: RecentConcept[] = [];
  for (const record of records) {
    const d = record?.direction;
    if (!d || typeof d.name !== "string" || !d.name.trim()) continue;
    out.push({ name: d.name.slice(0, 80), ...(typeof d.language === "string" ? { language: d.language.slice(0, 60) } : {}), ...(typeof d.idea === "string" ? { idea: d.idea.slice(0, 200) } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Monta o brief completo de uma pauta do Bolsão (usado pelo backend do piloto e pela API). */
export function briefFromIdea(input: Omit<CreativeBriefInput, "briefing"> & { instructions: ReadonlyArray<string | undefined> }) {
  const briefing = classifyBriefing({ intent: [input.idea.title, input.idea.keyMessage, input.idea.concept].filter(Boolean).join(" — "), instructions: input.instructions });
  return { briefing, prompt: creativeBriefLines({ ...input, briefing }).join("\n"), schema: creativeDirectionSchema };
}
