import { normalize } from "./skill-parsing.js";

/**
 * Creative Director Engine — motor compartilhado que responde "o que faz esta campanha ser
 * memorável?" ANTES de qualquer Skill decidir "como produzir?". Não é uma Skill nem uma nova
 * camada arquitetural (`src/shared` nunca foi Skill, ADR 0002 não se aplica aqui), no mesmo
 * espírito de `cinematic-reference-library.ts` e `visual-reference-library.ts`: Eduardo, João,
 * Bruno, Vanessa, Diego, Nora, Pedro, Rafa e Lucas importam este arquivo diretamente.
 *
 * `deriveCampaignCreativeDNA` é pura e determinística — cada Skill chama com os campos que já
 * recebe (nunca um campo novo passa a fluir entre Skills; nada muda em Arthur/Caio/Helena). Como a
 * derivação é uma função pura do mesmo texto de estratégia (originalRequest/centralPromise/
 * valueProposition/toneOfVoice/targetAudience/keyMessages), Skills diferentes que recebem o mesmo
 * contexto de campanha chegam ao MESMO Creative DNA sem nenhuma coordenação entre elas — a
 * identidade criativa fica consistente ao longo do pipeline por construção, não por acordo.
 *
 * O Creative Director nunca decide nada no lugar de uma Skill — ele só entrega mais contexto.
 * Cada Skill continua livre para ignorar, seguir parcialmente ou seguir integralmente o DNA.
 */

export type CampaignCreativeDNA = {
  bigIdea: string;
  centralMessage: string;
  dominantEmotion: string;
  secondaryEmotion: string;
  mainPromise: string;
  emotionalPromise: string;
  heroScene: string;
  heroFrame: string;
  visualMetaphor: string;
  emotionalHook: string;
  storyArc: string;
  heroColorMood: string;
  heroLighting: string;
  heroComposition: string;
  narrativePace: string;
  desiredAudienceFeeling: string;
  expectedMemoryAfterViewing: string;
  creativeRisks: string[];
  thingsToAvoid: string[];
  visualKeywords: string[];
  narrativeKeywords: string[];
};

/**
 * Bag flexível — cada Skill preenche só os campos que já recebe como input. Nenhum campo é
 * obrigatório: mesmo com apenas `originalRequest` (ex.: Eduardo, o primeiro a rodar, ou Pedro, que
 * nunca recebe a estratégia de João), a derivação sempre produz um DNA completo e válido.
 */
export type CreativeDirectorInput = {
  originalRequest?: string;
  objective?: string;
  centralPromise?: string;
  valueProposition?: string;
  toneOfVoice?: string;
  targetAudience?: string;
  keyMessages?: string[];
  brandName?: string;
};

function combinedText(input: CreativeDirectorInput): string {
  return normalize([
    input.originalRequest,
    input.objective,
    input.centralPromise,
    input.valueProposition,
    input.toneOfVoice,
    input.targetAudience,
    ...(input.keyMessages ?? []),
  ].filter(Boolean).join(" "));
}

function mainPromiseOf(input: CreativeDirectorInput): string {
  return input.centralPromise?.trim() || input.valueProposition?.trim() || input.objective?.trim() || input.originalRequest?.trim() || "a promessa central da campanha";
}

function brandOf(input: CreativeDirectorInput): string {
  return input.brandName?.trim() || "a marca";
}

function audienceOf(input: CreativeDirectorInput): string {
  return input.targetAudience?.trim() || "o público certo";
}

const EMOTION_BY_TONE_KEYWORD: Array<{ keywords: string[]; dominant: string; secondary: string }> = [
  { keywords: ["divertido", "leve", "descontraido", "descontraído"], dominant: "leveza", secondary: "alívio" },
  { keywords: ["confiante", "seguranca", "segurança", "confianca"], dominant: "confiança", secondary: "tranquilidade" },
  { keywords: ["elegante", "sofisticad", "premium", "luxo"], dominant: "sofisticação", secondary: "desejo" },
  { keywords: ["emocional", "sensivel", "sensível", "afetivo", "romantico", "romântico"], dominant: "emoção", secondary: "nostalgia" },
  { keywords: ["urgente", "direto", "objetivo"], dominant: "urgência", secondary: "clareza" },
  { keywords: ["acolhedor", "carinhoso", "humano"], dominant: "acolhimento", secondary: "pertencimento" },
];

function emotionsFromTone(input: CreativeDirectorInput): { dominant: string; secondary: string } {
  const normalized = combinedText(input);
  for (const entry of EMOTION_BY_TONE_KEYWORD) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return { dominant: entry.dominant, secondary: entry.secondary };
    }
  }
  return { dominant: "confiança", secondary: "alívio" };
}

/**
 * Arquétipo específico para campanhas de casamento/organização (ex.: Rumo ao Altar) — reconhecido
 * quando o texto combinado menciona casamento/noivos E organização/organizar, em qualquer ordem
 * de frase. Escrito à mão, não copiado do briefing do usuário: é uma leitura própria da mesma
 * ideia central ("vocês cuidam do amor, nós cuidamos da organização").
 */
export function isWeddingOrganizationTheme(input: CreativeDirectorInput): boolean {
  const normalized = combinedText(input);
  const mentionsWedding = /\b(casamento|noiv[oa]s?|cerimonia|cerimônia)\b/.test(normalized);
  const mentionsOrganization = /\b(organiza|organizacao|organização)/.test(normalized);
  return mentionsWedding && mentionsOrganization;
}

function weddingOrganizationDNA(input: CreativeDirectorInput): CampaignCreativeDNA {
  const brand = brandOf(input);
  return {
    bigIdea: `O casal vive o casamento enquanto ${brand} cuida da organização em silêncio.`,
    centralMessage: mainPromiseOf(input),
    dominantEmotion: "leveza",
    secondaryEmotion: "alívio",
    mainPromise: mainPromiseOf(input),
    emotionalPromise: "Você vai lembrar do seu casamento como o dia mais leve da sua vida, não o mais estressante.",
    heroScene: "O casal rindo em meio à cerimônia, enquanto uma notificação de RSVP confirmado aparece silenciosamente na tela ao fundo.",
    heroFrame: "Casal abraçado em primeiro plano; ao fundo, fora de foco, um celular mostrando a confirmação de um convidado.",
    visualMetaphor: "O amor ocupa o primeiro plano. A organização trabalha em silêncio ao fundo.",
    emotionalHook: "E se você pudesse aproveitar seu casamento sem pensar em nada além dele?",
    storyArc: "Sobrecarga invisível → alívio silencioso → presença plena no próprio casamento.",
    heroColorMood: "Dourado quente, tons de pele naturais, nunca frio ou clínico.",
    heroLighting: "Luz natural, dourada, de fim de tarde — nunca luz de estúdio ou tela de celular dominando o quadro.",
    heroComposition: "Casal nítido em primeiro plano; prova de organização (tela, papel, lista) desfocada e discreta ao fundo, nunca central.",
    narrativePace: "Contemplativo no início, mais vivo na prova concreta, calmo de novo no fechamento.",
    desiredAudienceFeeling: "Alívio antecipado — 'isso pode ser o meu casamento'.",
    expectedMemoryAfterViewing: "Quero viver meu casamento assim, leve, sem planilha na cabeça.",
    creativeRisks: [
      "Deixar a organização/tecnologia roubar a cena do casal.",
      "Parecer um anúncio de software de gestão de eventos em vez de um filme sobre amor.",
    ],
    thingsToAvoid: [
      "Mostrar telas, dashboards ou interfaces como protagonistas.",
      "Linguagem corporativa ou de produto ('funcionalidades', 'recursos').",
      "Tom de urgência ou venda agressiva — a marca deve parecer discreta, não onipresente.",
    ],
    visualKeywords: ["luz dourada", "mãos entrelaçadas", "desfoque proposital", "detalhe fora de foco", "celebração real"],
    narrativeKeywords: ["silêncio", "alívio", "presença", "leveza", "despreocupação"],
  };
}

/**
 * Fallback genérico — nunca deixa uma campanha sem DNA completo só porque não bateu com nenhum
 * arquétipo específico reconhecido (mesmo espírito de `enrichVisualConcept`: todo conceito passa
 * por aqui, mesmo sem reconhecimento, e sai enriquecido). Interpola os campos realmente
 * disponíveis (promessa central, proposta de valor, público, tom) em vez de texto genérico solto.
 */
function genericDNA(input: CreativeDirectorInput): CampaignCreativeDNA {
  const brand = brandOf(input);
  const audience = audienceOf(input);
  const promise = mainPromiseOf(input);
  const { dominant, secondary } = emotionsFromTone(input);

  return {
    bigIdea: `${audience} vive o que realmente importa enquanto ${brand} cuida do resto.`,
    centralMessage: promise,
    dominantEmotion: dominant,
    secondaryEmotion: secondary,
    mainPromise: promise,
    emotionalPromise: `Sentir que "${promise}" é real, não apenas discurso de marketing.`,
    heroScene: `O momento em que ${audience} percebe, na prática, que "${promise}" é verdade.`,
    heroFrame: "Plano fechado no rosto ou gesto que expressa a emoção dominante, com o produto/prova como elemento secundário, nunca central.",
    visualMetaphor: "O benefício central ocupa o primeiro plano; a solução trabalha discretamente ao fundo.",
    emotionalHook: `E se "${promise}" fosse simplesmente verdade, sem esforço?`,
    storyArc: "Tensão não resolvida → prova concreta → alívio e confiança.",
    heroColorMood: "Paleta quente e humana, coerente com o tom de voz da marca.",
    heroLighting: "Luz natural, nunca artificial ou clínica.",
    heroComposition: "Sujeito humano em foco; prova/produto desfocado e secundário, nunca central.",
    narrativePace: "Progressivo — começa contido, ganha energia na prova concreta, resolve com calma.",
    desiredAudienceFeeling: `${dominant}, seguida de ${secondary}.`,
    expectedMemoryAfterViewing: '"Isso poderia ser sobre mim."',
    creativeRisks: [
      "A prova/produto dominar o quadro e apagar o elemento humano.",
      "Soar como uma lista de funcionalidades em vez de uma história.",
    ],
    thingsToAvoid: [
      "Colocar o produto como protagonista visual.",
      "Linguagem corporativa ou técnica em vez de conversacional.",
      "CTA agressivo ou tom de urgência artificial.",
    ],
    visualKeywords: ["luz natural", "expressão genuína", "detalhe humano", "profundidade real"],
    narrativeKeywords: [dominant, secondary, "confiança", "clareza"],
  };
}

/**
 * Motor central: recebe o que a Skill já tem disponível e devolve o Campaign Creative DNA
 * completo (nunca parcial, nunca undefined). Função pura e determinística — mesmo input sempre
 * produz o mesmo DNA, garantindo consistência entre Skills sem nenhuma coordenação explícita.
 */
export function deriveCampaignCreativeDNA(input: CreativeDirectorInput): CampaignCreativeDNA {
  if (isWeddingOrganizationTheme(input)) return weddingOrganizationDNA(input);
  return genericDNA(input);
}

/**
 * Resumo curto (1 linha) do DNA para uso em notas/observações internas de qualquer Skill —
 * nunca deve ser renderizado como texto público.
 */
export function summarizeCreativeDNA(dna: CampaignCreativeDNA): string {
  return `Big Idea: ${dna.bigIdea} | Emoção dominante: ${dna.dominantEmotion} | Metáfora visual: ${dna.visualMetaphor}`;
}
