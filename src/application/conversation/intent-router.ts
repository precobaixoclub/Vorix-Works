import type { ConversationAction, InternalCommand, UserIntent, UserIntentType } from "../../domain/conversation/conversation.model.js";

/**
 * Intent Router — Sprint 06 (Fase 3). 100% regras (nenhum modelo, nenhuma chamada externa).
 * Primeira regra que bate vence — a ordem é a prioridade. `classifyIntent` nunca lança para texto
 * vazio/estranho: cai em `unknown` com confiança baixa, nunca finge certeza que não tem.
 *
 * `routeIntent` traduz a intenção classificada numa SUGESTÃO de ação (`InternalCommand`) — nunca
 * aciona a Skill de verdade (`chamar Caio`/`chamar Clara`/`chamar Assets` aqui são só rótulos). A
 * decisão FINAL é do Arthur (`arthur-conversation-decision.ts`, Fase 4), que pode confirmar ou
 * substituir esta sugestão.
 */

type IntentRule = {
  type: Exclude<UserIntentType, "unknown">;
  pattern: RegExp;
  label: string;
};

const INTENT_RULES: IntentRule[] = [
  { type: "start_briefing", pattern: /\bbriefing\b/i, label: "keyword:briefing" },
  {
    type: "create_campaign",
    pattern: /\b(criar|nova|novo|lan[cç]ar|come[cç]ar|iniciar)\b[^.?!]{0,40}\bcampanha\b|\bcampanha\b[^.?!]{0,40}\b(nova|criar)\b/i,
    label: "keyword:criar+campanha",
  },
  {
    type: "edit_campaign",
    pattern: /\b(editar|alterar|mudar|atualizar|ajustar|revisar)\b[^.?!]{0,40}\bcampanha\b/i,
    label: "keyword:editar+campanha",
  },
  {
    type: "query_assets",
    pattern: /\b(assets?|ativos?|arquivos?|imagens?|logos?|v[ií]deos?|documentos?|mockups?|brand ?book)\b/i,
    label: "keyword:assets",
  },
  {
    type: "query_knowledge",
    pattern: /\b(conhecimento|creative dna|diferenciai?s|p[uú]blico[- ]alvo|posicionamento|marca\b)/i,
    label: "keyword:knowledge",
  },
  { type: "query_workspace", pattern: /\b(workspace|integra[cç][aã]o|integra[cç][oõ]es|minha conta)\b/i, label: "keyword:workspace" },
];

const CONFIDENT_MATCH = 0.9;
// `answer_question`/`free_chat` são classificações COMPLETAS e corretas dentro do que se propõem
// (nunca "eu não sei o que é isto") — por isso ficam ACIMA do limiar de baixa confiança do Arthur
// (`LOW_CONFIDENCE_THRESHOLD`, `arthur-conversation-decision.ts`). Só `unknown` (texto vazio, a
// única entrada que nenhuma regra consegue classificar) fica abaixo — é a única situação em que
// "confiança baixa" significa de verdade "não sei o que fazer com isto".
const QUESTION_FALLBACK = 0.6;
const FREE_CHAT_FALLBACK = 0.6;
const UNKNOWN_CONFIDENCE = 0.1;

export function classifyIntent(rawText: string): UserIntent {
  const text = rawText.trim();
  if (!text) {
    return { type: "unknown", confidence: UNKNOWN_CONFIDENCE, rawText };
  }

  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(text)) {
      return { type: rule.type, confidence: CONFIDENT_MATCH, rawText, matchedRule: rule.label };
    }
  }

  if (text.includes("?")) {
    return { type: "answer_question", confidence: QUESTION_FALLBACK, rawText, matchedRule: "fallback:question-mark" };
  }

  return { type: "free_chat", confidence: FREE_CHAT_FALLBACK, rawText, matchedRule: "fallback:free-chat" };
}

const INTENT_TO_ACTION: Record<UserIntentType, ConversationAction> = {
  create_campaign: "call_caio",
  edit_campaign: "call_caio",
  start_briefing: "start_briefing",
  query_assets: "call_assets",
  query_knowledge: "call_clara",
  query_workspace: "respond",
  answer_question: "respond",
  free_chat: "respond",
  unknown: "request_more_context",
};

const ACTION_REASON: Record<ConversationAction, string> = {
  respond: "A intenção pode ser respondida diretamente, sem delegar a nenhum outro componente.",
  request_more_context: "Não foi possível classificar a intenção com confiança suficiente.",
  call_caio: "A intenção envolve criar ou editar uma campanha — trabalho do Caio (execução de workflow).",
  call_clara: "A intenção pede informação de Knowledge (marca, Creative DNA, público, diferenciais).",
  call_assets: "A intenção pede informação da Asset Library.",
  start_briefing: "A intenção pede o início de um Briefing.",
};

export function routeIntent(intent: UserIntent): InternalCommand {
  const action = INTENT_TO_ACTION[intent.type];
  return { action, intent, reason: ACTION_REASON[action] };
}
