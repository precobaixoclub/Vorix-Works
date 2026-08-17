import { normalize } from "./skill-parsing.js";

/**
 * Classificação de objetivo de marketing usada por João (`joao-marketing-strategy.skill.ts`) para
 * fazer a estrutura da publicação mudar conforme o objetivo real, em vez da fórmula única que o
 * pipeline usava antes (heurística rasa de 4 categorias em `inferAngle`/`defaultCtaFor`). Utilitário
 * puro e sem estado — `src/shared` não é uma Skill (ADR 0002 só proíbe Skill importar de Skill).
 */
export const MARKETING_OBJECTIVES = [
  "venda_conversao",
  "promocao_oferta",
  "engajamento",
  "reconhecimento_marca",
  "conteudo_educativo",
  "prova_social",
  "lancamento",
  "relacionamento",
  "geracao_leads",
] as const;

export type MarketingObjective = (typeof MARKETING_OBJECTIVES)[number];

export type MarketingObjectiveStructuralGuidance = {
  funnelStage: "topo" | "meio" | "fundo";
  ctaStyle: string;
  captionStructureHint: string;
  defaultCta: string;
  angleDescription: string;
};

const KEYWORDS_BY_OBJECTIVE: Record<MarketingObjective, string[]> = {
  promocao_oferta: ["promocao", "desconto", "oferta", "cupom", "liquidacao", "black friday"],
  geracao_leads: ["cadastr", "lead", "formulario", "inscri", "orcamento gratis", "orcamento"],
  lancamento: ["lancar", "lancamento", "novidade", "chegou", "em breve", "pre venda"],
  prova_social: ["depoimento", "avaliacao", "review", "cliente satisfeito", "resultado real", "case"],
  conteudo_educativo: ["educar", "explicar", "ensinar", "informar", "dica", "como fazer", "tutorial"],
  engajamento: ["engajar", "interacao", "comunidade", "comentario", "compartilh", "enquete"],
  reconhecimento_marca: ["marca", "posicionamento", "institucional", "quem somos", "proposito"],
  relacionamento: ["fidelizar", "relacionamento", "proximidade", "cuidado", "atendimento"],
  venda_conversao: ["vender", "venda", "comprar", "conversao", "assinar", "adquirir", "fechar pedido"],
};

const GUIDANCE_BY_OBJECTIVE: Record<MarketingObjective, MarketingObjectiveStructuralGuidance> = {
  venda_conversao: {
    funnelStage: "fundo",
    ctaStyle: "direto, com senso de urgência e ação imediata",
    captionStructureHint: "abrir com o benefício mais forte, resolver a objeção principal e fechar com CTA de compra claro",
    defaultCta: "Compre agora",
    angleDescription: "Ângulo de conversão: benefício direto, objeção resolvida e chamada clara para ação de compra.",
  },
  promocao_oferta: {
    funnelStage: "fundo",
    ctaStyle: "urgente, ancorado na condição/prazo da oferta",
    captionStructureHint: "abrir com a oferta concreta (o que muda de preço/condição), justificar o porquê e fechar com prazo/CTA",
    defaultCta: "Aproveite agora",
    angleDescription: "Ângulo promocional: condição concreta em destaque, com urgência genuína (nunca inventada).",
  },
  engajamento: {
    funnelStage: "topo",
    ctaStyle: "convite à interação (comentar, responder, compartilhar), nunca venda direta",
    captionStructureHint: "abrir com uma pergunta ou afirmação que gere identificação, sem empurrar produto",
    defaultCta: "Comenta aqui",
    angleDescription: "Ângulo de identificação e conversa próxima com o público, sem tom de venda.",
  },
  reconhecimento_marca: {
    funnelStage: "topo",
    ctaStyle: "suave, foco em lembrança de marca, não em conversão imediata",
    captionStructureHint: "contar quem é a marca/o que ela representa, sem pedir venda",
    defaultCta: "Conheça mais",
    angleDescription: "Ângulo de posicionamento: quem a marca é e o que a diferencia, sem pressa de vender.",
  },
  conteudo_educativo: {
    funnelStage: "topo",
    ctaStyle: "convite a aprender mais / salvar o conteúdo, não venda direta",
    captionStructureHint: "ensinar algo concreto e verificável primeiro, produto aparece como consequência, não como abertura",
    defaultCta: "Salve este post",
    angleDescription: "Ângulo educativo: um ensinamento prático e verdadeiro em primeiro lugar, autoridade como consequência.",
  },
  prova_social: {
    funnelStage: "meio",
    ctaStyle: "convite a ver mais casos/resultados, reforça confiança",
    captionStructureHint: "abrir com o resultado/depoimento real, contextualizar como aconteceu, fechar com convite a conhecer mais",
    defaultCta: "Veja mais resultados",
    angleDescription: "Ângulo de prova social: um resultado ou depoimento real em primeiro plano, nunca inventado.",
  },
  lancamento: {
    funnelStage: "topo",
    ctaStyle: "expectativa/novidade, pode incluir urgência de primeira leva",
    captionStructureHint: "anunciar a novidade com clareza, dizer por que ela importa agora, fechar com próximo passo",
    defaultCta: "Seja um dos primeiros",
    angleDescription: "Ângulo de novidade: o que está chegando e por que importa agora, com expectativa genuína.",
  },
  relacionamento: {
    funnelStage: "meio",
    ctaStyle: "próximo, tom de cuidado contínuo, não transacional",
    captionStructureHint: "reforçar proximidade e cuidado com quem já é cliente, sem tom de venda nova",
    defaultCta: "Fale com a gente",
    angleDescription: "Ângulo de relacionamento: proximidade e cuidado contínuo com quem já conhece a marca.",
  },
  geracao_leads: {
    funnelStage: "meio",
    ctaStyle: "direto para a ação de cadastro/contato, baixo atrito",
    captionStructureHint: "mostrar o valor de deixar contato/cadastrar-se antes de pedir o dado",
    defaultCta: "Cadastre-se",
    angleDescription: "Ângulo de captação: valor claro em deixar contato, pedido de cadastro de baixo atrito.",
  },
};

/** Ordem de checagem das palavras-chave — categorias mais específicas primeiro, `venda_conversao`
 * por último (é também o fallback final), para que um pedido de "promoção"/"lead" não caia em
 * venda_conversao só por conter um verbo genérico de venda. */
const MATCH_PRIORITY: MarketingObjective[] = [
  "promocao_oferta",
  "geracao_leads",
  "lancamento",
  "prova_social",
  "conteudo_educativo",
  "engajamento",
  "reconhecimento_marca",
  "relacionamento",
  "venda_conversao",
];

function matchAgainst(normalizedText: string): MarketingObjective | undefined {
  for (const objective of MATCH_PRIORITY) {
    const keywords = KEYWORDS_BY_OBJECTIVE[objective];
    if (keywords.some((keyword) => normalizedText.includes(normalize(keyword)))) {
      return objective;
    }
  }
  return undefined;
}

/** Heurística por palavra-chave (mesmo padrão de `inferAngle`/`defaultCtaFor` anteriores), com
 * fallback para `venda_conversao` (o objetivo mais comum e mais seguro por padrão). O texto do
 * objetivo declarado pelo usuário (`objectiveText`) pesa mais que o texto livre do pedido original
 * (`offerOrSubject`/`originalRequest`): é checado primeiro sozinho, e só cai para o texto combinado
 * se o objetivo isolado não bater em nenhuma categoria — evita que uma menção lateral (ex.:
 * "lançamento" citado de passagem) sobreponha o objetivo que o usuário de fato declarou. */
export function classifyMarketingObjective(objectiveText: string, offerOrSubject: string): MarketingObjective {
  const fromObjectiveAlone = matchAgainst(normalize(objectiveText));
  if (fromObjectiveAlone) return fromObjectiveAlone;

  const fromCombined = matchAgainst(normalize(`${objectiveText} ${offerOrSubject}`));
  return fromCombined ?? "venda_conversao";
}

export function structuralGuidanceFor(objective: MarketingObjective): MarketingObjectiveStructuralGuidance {
  return GUIDANCE_BY_OBJECTIVE[objective];
}
