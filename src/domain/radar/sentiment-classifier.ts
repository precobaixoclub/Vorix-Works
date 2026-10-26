import { findWordStartIndexes, isNegatedAt, normalizeRadarText } from "./radar-keywords.js";

/**
 * Classificador léxico do Radar (Camada 1, gratuita) — vocabulário ponderado em português, com
 * tratamento de negação. Nunca chama LLM/provider: roda a cada mensagem, custo zero.
 */
export type RadarSentimentResult = {
  sentiment: "positive" | "neutral" | "negative";
  /** -1 a 1. */
  score: number;
  urgency: "low" | "medium" | "high";
  hasComplaint: boolean;
  /** Primeiro termo que pesou na classificação (para auditoria), nunca o texto inteiro. */
  evidence: string;
};

/** `[termo, peso, negável]` — "negável" = uma negação antes dele inverte o sentido ("não estou
 * insatisfeito"). Frases que já carregam a própria negação ("não resolveram") nunca são negáveis. */
const NEGATIVE_VOCABULARY: ReadonlyArray<readonly [string, number, boolean?]> = [
  // Ameaças legais / escalação
  ["procon", 1.0], ["reclame aqui", 1.0], ["processo judicial", 1.0], ["acao judicial", 0.95], ["advogado", 0.9],
  // Reclamação formal
  ["protocolo de reclamacao", 0.9], ["registrar reclamacao", 0.85], ["abrir reclamacao", 0.85], ["fazer uma reclamacao", 0.85],
  ["quero reclamar", 0.8], ["preciso reclamar", 0.75], ["vou reclamar", 0.8], ["reclamacao", 0.7, true], ["reclamar", 0.65, true],
  // Insatisfação explícita
  ["extremamente insatisfeito", 0.95], ["muito insatisfeito", 0.9], ["nao resolveram", 0.95], ["ninguem resolve", 0.95],
  ["ja falei varias vezes", 0.95], ["ja entrei em contato varias", 0.9], ["ninguem responde", 0.9], ["nao me atendem", 0.9],
  ["falta de respeito", 0.9], ["nunca resolve", 0.9], ["nao esta resolvendo", 0.85], ["nao resolveu", 0.85], ["nao vai resolver", 0.8],
  ["pessimo atendimento", 0.9], ["pessimo servico", 0.9], ["qualidade pessima", 0.85], ["sem qualidade", 0.7],
  // Problema persistente
  ["sempre o mesmo problema", 0.9], ["continua com problema", 0.8], ["continua o problema", 0.8], ["continua sem funcionar", 0.85],
  ["ainda nao funciona", 0.8], ["ainda nao foi resolvido", 0.85], ["ainda sem solucao", 0.8], ["nao foi resolvido", 0.85],
  ["problema voltou", 0.75], ["voltou o problema", 0.75], ["problema no sistema", 0.65], ["problema com o sistema", 0.65],
  // Cancelamento
  ["cancelamento imediato", 0.95], ["solicito cancelamento", 0.9], ["solicitar cancelamento", 0.9], ["cancelamento do contrato", 0.85],
  ["cancelamento do servico", 0.85], ["cancelamento do plano", 0.85], ["quero o cancelamento", 0.85], ["quero cancelar", 0.85, true],
  ["vou cancelar", 0.85, true], ["cancela minha", 0.8], ["cancela o meu", 0.8], ["quero encerrar", 0.8, true], ["nao quero mais", 0.75],
  ["desistir do servico", 0.8],
  // Cobrança / financeiro
  ["cobrado errado", 0.85], ["cobrado indevidamente", 0.85], ["cobranca indevida", 0.85], ["cobranca incorreta", 0.8], ["cobranca errada", 0.85],
  ["valor errado", 0.75], ["estorno", 0.6], ["reembolso", 0.55], ["devolucao do dinheiro", 0.7], ["dinheiro de volta", 0.7],
  // Estados emocionais (negáveis)
  ["insatisfeit", 0.8, true], ["pessimo", 0.8, true], ["horrivel", 0.8, true], ["absurdo", 0.8, true], ["ridiculo", 0.8, true],
  ["vergonhoso", 0.8, true], ["vergonha", 0.75, true], ["indignad", 0.8, true], ["decepcionad", 0.75, true], ["decepcionante", 0.75, true],
  ["revoltad", 0.8, true], ["raiva", 0.8, true], ["frustrad", 0.7, true], ["irritad", 0.7, true], ["chatead", 0.6, true], ["muito ruim", 0.8],
  ["nao gostei", 0.65],
  // Indisponibilidade
  ["fora do ar", 0.75], ["sistema fora", 0.75], ["sistema caiu", 0.75], ["caiu o sistema", 0.75], ["servico indisponivel", 0.8],
  ["sistema indisponivel", 0.8],
  // Instabilidade / lentidão / falha
  ["instabilidade", 0.65], ["sistema instavel", 0.75], ["instavel", 0.6, true], ["oscilando", 0.6], ["intermitente", 0.6],
  ["quedas constantes", 0.75], ["sem conexao", 0.65], ["extremamente lento", 0.75], ["muito lento", 0.7], ["sistema lento", 0.65],
  ["lentidao", 0.55, true], ["lento", 0.4, true], ["falha no sistema", 0.75], ["falha tecnica", 0.75], ["sistema travado", 0.7],
  ["travado", 0.6, true], ["travou", 0.6], ["bugado", 0.65], ["bloqueado", 0.55, true],
  // Acesso / funcionalidade
  ["nao funciona", 0.75], ["nao ta funcionando", 0.75], ["nao esta funcionando", 0.75], ["nao consigo acessar", 0.7],
  ["nao consigo fazer login", 0.7], ["nao consigo entrar", 0.65], ["nao consigo usar", 0.65], ["nao acessa", 0.65], ["nao abre", 0.6],
  ["nao carrega", 0.6], ["nao consigo", 0.5], ["nao recebi", 0.55], ["nao aparece", 0.5], ["erro no sistema", 0.7], ["deu erro", 0.65],
  // Atendimento / espera
  ["sem resposta", 0.7], ["sem retorno", 0.7], ["nao recebo resposta", 0.75], ["nao respondem", 0.7], ["nao me respondem", 0.75],
  ["demora muito", 0.65], ["demorando muito", 0.65], ["ha dias esperando", 0.7], ["semanas esperando", 0.75], ["faz dias", 0.55],
  ["nao aguento mais", 0.85], ["descaso", 0.8, true], ["prejuizo", 0.7, true], ["incompeten", 0.8, true],
  // Sinais fracos — só pesam acumulados
  ["problema", 0.2, true], ["demora", 0.3, true], ["erro", 0.2, true], ["falha", 0.25, true],
];

const POSITIVE_VOCABULARY: ReadonlyArray<readonly [string, number]> = [
  ["excelente", 0.85], ["otimo", 0.8], ["muito bom", 0.75], ["parabens", 0.75], ["resolvido", 0.65], ["foi resolvido", 0.7],
  ["problema resolvido", 0.75], ["perfeito", 0.85], ["adorei", 0.75], ["maravilhoso", 0.8], ["incrivel", 0.7], ["satisfeit", 0.75],
  ["muito satisfeit", 0.85], ["muito obrigad", 0.5], ["obrigad", 0.35], ["gostei", 0.6], ["funcionou", 0.6], ["funcionando", 0.45],
  ["resolveu", 0.65], ["rapido", 0.45], ["eficiente", 0.55], ["agradec", 0.5], ["sem problemas", 0.55], ["tudo certo", 0.5],
  ["tudo bem", 0.35], ["deu certo", 0.55], ["consegui", 0.4], ["ja consigo", 0.5], ["deu certinho", 0.6],
];

const URGENCY_HIGH_TERMS: readonly string[] = [
  "urgente", "urgencia", "emergencia", "imediato", "imediatamente", "agora mesmo", "preciso agora", "preciso hoje", "nao posso esperar",
  "procon", "processo judicial", "acao judicial", "advogado", "reclame aqui", "vencimento hoje", "prazo hoje", "prazo vencendo",
  "cancelamento imediato", "cancela agora", "cancelar agora",
];

const URGENCY_MEDIUM_TERMS: readonly string[] = [
  "quanto tempo", "quando vai", "ate quando", "ha dias", "faz dias", "semanas", "esperando", "demorando", "precisando", "ja faz", "desde",
  "instabilidade", "oscilando", "intermitente", "quero cancelar", "vou cancelar", "nao foi resolvido", "continua com problema",
];

const COMPLAINT_TERMS: readonly string[] = [
  "nao resolveram", "ja falei varias vezes", "ninguem responde", "ninguem resolve", "insatisfeit", "falta de respeito", "nunca resolve",
  "pessimo", "horrivel", "absurdo", "revoltad", "indignad", "quero cancelar", "vou cancelar", "solicitar cancelamento", "quero reclamar",
  "reclamacao", "cobrado errado", "cobrado indevidamente", "cobranca indevida", "cobranca errada", "procon", "reclame aqui",
  "processo judicial", "advogado", "fora do ar", "sistema caiu", "nao foi resolvido", "continua com problema", "problema voltou",
];

/** Negativos fracos isolados (soma < 0.40) pesam só 30% — "problema" sozinho não é sentimento
 * negativo, precisa acumular com outros sinais. */
const MIN_EFFECTIVE_NEGATIVE = 0.4;
const NEGATIVE_THRESHOLD = -0.12;
const POSITIVE_THRESHOLD = 0.18;

function hasUnnegated(normalized: string, term: string): boolean {
  return findWordStartIndexes(normalized, term).some((index) => !isNegatedAt(normalized, index, term));
}

export function classifyRadarMessage(text: string | undefined): RadarSentimentResult {
  if (!text || text.trim().length < 3) return { sentiment: "neutral", score: 0, urgency: "low", hasComplaint: false, evidence: "" };

  const normalized = normalizeRadarText(text);
  let negativeTotal = 0;
  let positiveTotal = 0;
  let evidence = "";

  for (const [term, weight, negatable] of NEGATIVE_VOCABULARY) {
    const present = negatable ? hasUnnegated(normalized, term) : findWordStartIndexes(normalized, term).length > 0;
    if (!present) continue;
    negativeTotal += weight;
    if (!evidence) evidence = term;
  }

  // Positivo sempre é negável: "não funcionou"/"não gostei" nunca contam a favor.
  for (const [term, weight] of POSITIVE_VOCABULARY) {
    if (!hasUnnegated(normalized, term)) continue;
    positiveTotal += weight;
    if (!evidence) evidence = term;
  }

  const effectiveNegative = negativeTotal < MIN_EFFECTIVE_NEGATIVE ? negativeTotal * 0.3 : negativeTotal;
  const score = Math.max(-1, Math.min(1, positiveTotal - effectiveNegative * 1.1));

  const sentiment: RadarSentimentResult["sentiment"] = score < NEGATIVE_THRESHOLD ? "negative" : score > POSITIVE_THRESHOLD ? "positive" : "neutral";

  let urgency: RadarSentimentResult["urgency"] = "low";
  if (URGENCY_HIGH_TERMS.some((term) => hasUnnegated(normalized, term))) urgency = "high";
  else if (URGENCY_MEDIUM_TERMS.some((term) => findWordStartIndexes(normalized, term).length > 0)) urgency = "medium";

  const hasComplaint = COMPLAINT_TERMS.some((term) => hasUnnegated(normalized, term));

  return { sentiment, score, urgency, hasComplaint, evidence };
}
