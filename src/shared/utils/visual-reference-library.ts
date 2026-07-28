import { normalize } from "./skill-parsing.js";

/**
 * Biblioteca interna de referências visuais e motor de "Visual Enrichment" — não é uma Skill nem
 * uma nova camada arquitetural, é lógica pura compartilhada (`src/shared` nunca foi Skill, ADR
 * 0002 não se aplica aqui), no mesmo espírito de `content-format-classification.ts` (usada
 * diretamente por Arthur e Eduardo). Sofia, Bianca e Pedro importam este arquivo diretamente.
 *
 * Objetivo: eliminar qualquer aparência de clipart, ícone, desenho simples, vetor genérico,
 * ilustração infantil, PowerPoint, Canva básico ou template — todo conceito visual simples
 * ("caixa de presente", "dinheiro") passa por aqui antes de qualquer prompt ser montado, e vira
 * uma cena publicitária completa com protagonista, elemento secundário, plano de fundo,
 * iluminação, profundidade, lente simulada, enquadramento, composição, movimento implícito,
 * emoção visual, textura, materiais e qualidade fotográfica.
 */

export const VISUAL_REFERENCE_STYLES = [
  "photographicAdvertising",
  "luxuryEditorial",
  "premiumCampaign",
  "highEndWeddingPhotography",
  "cinematicDirection",
  "minimalistModernCampaign",
] as const;

export type VisualReferenceStyle = (typeof VISUAL_REFERENCE_STYLES)[number];

/** Referências de gênero que orientam automaticamente o estilo fotográfico de qualquer cena. */
export const VISUAL_REFERENCE_LIBRARY: Record<VisualReferenceStyle, string> = {
  photographicAdvertising:
    "Fotografia publicitária: produto real fotografado com luz de estúdio controlada, sombra natural e acabamento comercial de campanha.",
  luxuryEditorial:
    "Editorial de luxo: composição de revista premium, materiais nobres, texturas ricas, paleta contida e enquadramento sofisticado.",
  premiumCampaign:
    "Campanha premium: um único protagonista visual, muito espaço negativo, tipografia dominante e zero elementos decorativos sem função.",
  highEndWeddingPhotography:
    "Fotografia de casamento de alto padrão: luz natural suave, cores quentes, sensação documental e emocional, sem pose artificial.",
  cinematicDirection:
    "Direção cinematográfica: profundidade de campo real, foco seletivo, iluminação com intenção dramática e composição de enquadramento de cena.",
  minimalistModernCampaign:
    "Campanha minimalista moderna: fundo limpo, poucos elementos, alto contraste funcional e acabamento gráfico contemporâneo.",
};

/**
 * Lista negativa explícita, sempre incluída no prompt final de Pedro (e citada por Sofia/Bianca
 * como lembrete). Cobre literalmente cada aparência banida pelo pedido original.
 */
export const ANTI_GENERIC_VISUAL_CONSTRAINTS: string[] = [
  "nunca clipart",
  "nunca ícone simples ou flat icon representando o conceito sozinho",
  "nunca desenho/ilustração simples de contorno",
  "nunca vetor genérico de banco de imagens",
  "nunca ilustração infantil ou estilo cartoon",
  "nunca aparência de slide de PowerPoint",
  "nunca aparência de template pronto de Canva básico",
  "nunca aparência de template genérico reaproveitável entre marcas",
  "sempre cena fotográfica ou composição de campanha publicitária premium — nunca um objeto isolado sem cena, luz ou contexto ao redor",
];

export type VisualEmotionHint = "loss" | "gain" | "neutral";

export type EnrichedVisualScene = {
  concept: string;
  protagonist: string;
  secondaryElement: string;
  background: string;
  lighting: string;
  depthOfField: string;
  simulatedLens: string;
  framing: string;
  composition: string;
  implicitMovement: string;
  visualEmotion: string;
  texture: string;
  materials: string;
  photographicQuality: string;
  referenceStyle: VisualReferenceStyle;
  /** Parágrafo narrativo pronto para uso em prompt, no mesmo estilo do exemplo do pedido original. */
  sceneDescription: string;
};

type SceneFields = Omit<EnrichedVisualScene, "concept" | "sceneDescription">;
type SceneTemplate = (emotionHint: VisualEmotionHint, concept: string) => SceneFields;

const COMMON_PHOTOGRAPHIC_QUALITY =
  "Qualidade de campanha publicitária, alta resolução, acabamento comercial premium, sem ruído, sem serrilhado e sem artefato digital.";

const GIFT_BOX_TEMPLATE: SceneTemplate = () => ({
  protagonist: "Uma caixa de presente premium aberta sobre uma superfície elegante",
  secondaryElement: "notas de dinheiro reais",
  background: "Superfície nobre desfocada ao fundo (mármore claro ou madeira escura), sem elementos concorrentes",
  lighting: "luz natural suave",
  depthOfField: "Profundidade de campo rasa (f/2.8 simulado): caixa em foco nítido, fundo suavemente desfocado em bokeh",
  simulatedLens: "Lente macro/50mm simulada, ângulo levemente elevado, perspectiva editorial",
  framing: "Enquadramento fechado no objeto, com espaço negativo generoso ao redor para respiro",
  composition: "Composição na regra dos terços, protagonista deslocado do centro geométrico para criar tensão visual",
  implicitMovement: "escapam lentamente da embalagem antes de chegar ao destino",
  visualEmotion: "perda financeira",
  texture: "Textura real de papel de presente com leve brilho e trama visível do laço de tecido",
  materials: "Papel de presente premium, fita de cetim, notas de dinheiro brasileiras com relevo e textura reais",
  photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
  referenceStyle: "photographicAdvertising",
});

const MONEY_TEMPLATE: SceneTemplate = (emotionHint) => {
  const isGain = emotionHint === "gain";
  return {
    protagonist: "Notas de dinheiro brasileiras reais em pleno movimento",
    secondaryElement: isGain ? "uma mão ou superfície representando o destino do valor" : "o espaço vazio entre a origem e o destino do valor",
    background: "Fundo neutro desfocado, com leve gradiente de luz, sem elementos concorrentes",
    lighting: "luz direcional suave, lateral, criando sombra natural sobre a superfície",
    depthOfField: "Profundidade de campo rasa: nota em primeiro plano nítida, demais notas suavemente desfocadas",
    simulatedLens: "Lente macro simulada, close-up físico e tátil",
    framing: "Enquadramento fechado, notas cortando o quadro para reforçar movimento",
    composition: "Composição diagonal, guiando o olho na direção do movimento das notas",
    implicitMovement: isGain
      ? "chegam inteiras e alinhadas ao destino, em movimento de pouso suave"
      : "flutuam e se dispersam no ar, em movimento de queda e dispersão",
    visualEmotion: isGain ? "ganho e confiança" : "perda e dispersão",
    texture: "Textura real de papel-moeda, relevo, leve desgaste natural e reflexo de luz na superfície",
    materials: "Notas de dinheiro brasileiras reais (não estilizadas, não genéricas)",
    photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
    referenceStyle: "photographicAdvertising",
  };
};

const RING_TEMPLATE: SceneTemplate = () => ({
  protagonist: "Um par de alianças de casamento reais, apoiadas sobre um tecido nobre",
  secondaryElement: "reflexo suave de luz na superfície metálica",
  background: "Tecido de linho ou veludo desfocado ao fundo, tom neutro e quente",
  lighting: "luz natural suave, quase dourada, típica de golden hour",
  depthOfField: "Profundidade de campo rasa: aliança em primeiro plano em foco absoluto, restante suavemente desfocado",
  simulatedLens: "Lente macro simulada, extremo close-up",
  framing: "Enquadramento íntimo, centrado no par de alianças",
  composition: "Composição simétrica e centrada, reforçando união e equilíbrio",
  implicitMovement: "repousam paradas, com brilho sutil que sugere movimento de luz, não do objeto",
  visualEmotion: "intimidade e compromisso",
  texture: "Textura real de metal polido com microrreflexos, fibra visível do tecido de apoio",
  materials: "Ouro ou prata reais, tecido de linho ou veludo",
  photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
  referenceStyle: "highEndWeddingPhotography",
});

const INVITATION_TEMPLATE: SceneTemplate = () => ({
  protagonist: "Um convite de casamento editorial impresso, com tipografia elegante em relevo",
  secondaryElement: "um envelope aberto ao lado, com selo de cera",
  background: "Superfície de mármore claro ou madeira nobre, levemente desfocada",
  lighting: "luz natural suave vinda de uma janela lateral",
  depthOfField: "Profundidade de campo rasa: convite em foco nítido, envelope levemente desfocado",
  simulatedLens: "Lente 50mm simulada, ângulo levemente aéreo (flat lay editorial)",
  framing: "Enquadramento flat lay, com espaço negativo generoso ao redor",
  composition: "Composição assimétrica equilibrada, convite deslocado do centro geométrico",
  implicitMovement: "papel levemente curvado, como se tivesse acabado de ser aberto",
  visualEmotion: "expectativa e celebração",
  texture: "Textura de papel de algodão com relevo tipográfico real, cera derretida com brilho",
  materials: "Papel de algodão premium, cera de selo, tinta metálica",
  photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
  referenceStyle: "luxuryEditorial",
});

const FLOWERS_TEMPLATE: SceneTemplate = () => ({
  protagonist: "Um buquê de flores frescas reais, com pétalas em textura visível",
  secondaryElement: "gotas de orvalho ou água sobre as pétalas",
  background: "Fundo desfocado em tom neutro quente, sem elementos concorrentes",
  lighting: "luz natural suave e difusa, sem sombra dura",
  depthOfField: "Profundidade de campo rasa: pétala em primeiro plano em foco absoluto",
  simulatedLens: "Lente macro simulada, close-up botânico",
  framing: "Enquadramento fechado, buquê levemente cortado nas bordas para sensação de proximidade",
  composition: "Composição orgânica, seguindo o fluxo natural das pétalas e caules",
  implicitMovement: "pétalas levemente movidas por uma brisa sutil",
  visualEmotion: "delicadeza e frescor",
  texture: "Textura real de pétala aveludada, gotas de água com reflexo de luz",
  materials: "Flores reais frescas, fitas de tecido natural",
  photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
  referenceStyle: "highEndWeddingPhotography",
});

const COUPLE_TEMPLATE: SceneTemplate = () => ({
  protagonist: "Um casal real em um momento espontâneo e não posado",
  secondaryElement: "detalhes do local da celebração desfocados ao fundo",
  background: "Ambiente elegante e desfocado (jardim, salão ou terraço), sem poluição visual",
  lighting: "luz natural suave de fim de tarde (golden hour)",
  depthOfField: "Profundidade de campo rasa: casal em foco nítido, fundo em bokeh suave",
  simulatedLens: "Lente 85mm simulada, perspectiva documental discreta",
  framing: "Enquadramento médio, respeitando espaço negativo ao redor do casal",
  composition: "Composição documental, momento capturado sem pose rígida",
  implicitMovement: "movimento natural de um gesto espontâneo (sorriso, olhar, toque de mãos)",
  visualEmotion: "cumplicidade e emoção genuína",
  texture: "Textura real de tecido, pele e ambiente, sem tratamento artificial",
  materials: "Tecidos reais de roupa de cerimônia, elementos reais do ambiente",
  photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
  referenceStyle: "highEndWeddingPhotography",
});

const GENERIC_TEMPLATE: SceneTemplate = (_emotionHint, concept) => ({
  protagonist: `O elemento central do conceito ("${concept}"), tratado como protagonista de uma cena fotográfica real sobre uma superfície elegante`,
  secondaryElement: "elementos de apoio reais ao redor do protagonista",
  background: "Ambiente ou superfície elegante, desfocado, sem elementos concorrentes",
  lighting: "luz natural suave e direcional",
  depthOfField: "Profundidade de campo rasa: protagonista em foco nítido, fundo suavemente desfocado",
  simulatedLens: "Lente 50mm simulada, perspectiva editorial",
  framing: "Enquadramento fechado no protagonista, com espaço negativo generoso ao redor",
  composition: "Composição na regra dos terços, evitando centralização genérica",
  implicitMovement: "reforçam profundidade com um detalhe em leve movimento, evitando a sensação de objeto estático e parado",
  visualEmotion: "clareza e sofisticação",
  texture: "Texturas reais e tangíveis, nunca superfícies lisas e artificiais",
  materials: "Materiais reais e nobres, coerentes com o conceito recebido",
  photographicQuality: COMMON_PHOTOGRAPHIC_QUALITY,
  referenceStyle: "premiumCampaign",
});

/**
 * Palavra-chave (já normalizada) -> template de cena. A primeira correspondência encontrada
 * decide o template; `GENERIC_TEMPLATE` cobre qualquer conceito não reconhecido, garantindo que
 * *todo* conceito passe por enriquecimento, nunca só os objetos previstos aqui.
 */
const SIMPLE_OBJECT_SCENE_LIBRARY: Array<{ keywords: string[]; template: SceneTemplate }> = [
  { keywords: ["caixa de presente", "caixa", "presente", "embalagem"], template: GIFT_BOX_TEMPLATE },
  { keywords: ["dinheiro", "notas", "nota de dinheiro", "cedula", "pix", "valor"], template: MONEY_TEMPLATE },
  { keywords: ["alianca", "aliancas", "anel", "aneis"], template: RING_TEMPLATE },
  { keywords: ["convite", "envelope"], template: INVITATION_TEMPLATE },
  { keywords: ["flor", "flores", "buque"], template: FLOWERS_TEMPLATE },
  { keywords: ["casal", "noivos", "noiva", "noivo"], template: COUPLE_TEMPLATE },
];

const LOSS_HINT_KEYWORDS = ["perda", "perder", "perde", "escapa", "escapando", "vazamento", "retido", "retencao", "taxa"];
const GAIN_HINT_KEYWORDS = ["ganho", "conquista", "realizacao", "sucesso", "chegando", "conversao", "aprovado"];

/** Deriva perda/ganho/neutro a partir de qualquer texto de contexto disponível (ângulo, emoção, tema). */
export function inferVisualEmotionHint(...contextTexts: Array<string | undefined>): VisualEmotionHint {
  const normalized = normalize(contextTexts.filter(Boolean).join(" "));
  if (LOSS_HINT_KEYWORDS.some((term) => normalized.includes(term))) return "loss";
  if (GAIN_HINT_KEYWORDS.some((term) => normalized.includes(term))) return "gain";
  return "neutral";
}

function findTemplate(normalizedConcept: string): SceneTemplate {
  for (const entry of SIMPLE_OBJECT_SCENE_LIBRARY) {
    if (entry.keywords.some((keyword) => normalizedConcept.includes(keyword))) return entry.template;
  }
  return GENERIC_TEMPLATE;
}

function composeSceneDescription(fields: SceneFields): string {
  return `${fields.protagonist}, iluminada por ${fields.lighting}, enquanto ${fields.secondaryElement} ${fields.implicitMovement}, criando uma sensação imediata de ${fields.visualEmotion}.`;
}

/**
 * Estágio de "Visual Enrichment": transforma qualquer conceito visual simples (uma frase curta,
 * possivelmente um substantivo isolado como "caixa de presente") em uma cena publicitária
 * completa. Função pura e determinística — mesma entrada sempre produz a mesma cena, sem
 * depender de IA, para que o enriquecimento nunca falhe mesmo sem apoio do Ícaro/IA
 * desenvolvedora.
 */
export function enrichVisualConcept(rawConcept: string, emotionHint: VisualEmotionHint = "neutral"): EnrichedVisualScene {
  const concept = rawConcept.trim() || "elemento visual da campanha";
  const normalizedConcept = normalize(concept);
  const template = findTemplate(normalizedConcept);
  const fields = template(emotionHint, concept);
  return {
    concept,
    ...fields,
    sceneDescription: composeSceneDescription(fields),
  };
}
