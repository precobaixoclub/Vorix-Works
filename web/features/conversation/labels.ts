import type { ConversationAction, ConversationState, UserIntentType } from "./types";

export const INTENT_LABEL: Record<UserIntentType, string> = {
  create_campaign: "Criar campanha",
  edit_campaign: "Editar campanha",
  answer_question: "Responder dúvida",
  query_workspace: "Consultar Espaço de Trabalho",
  query_assets: "Consultar Ativos",
  query_knowledge: "Consultar Conhecimento",
  start_briefing: "Iniciar briefing",
  free_chat: "Fluxo livre",
  unknown: "Não identificada",
};

export const ACTION_LABEL: Record<ConversationAction, string> = {
  respond: "Responder diretamente",
  request_more_context: "Pedir mais contexto",
  call_caio: "Acionar Caio",
  call_clara: "Consultar Conhecimento (Clara)",
  call_assets: "Consultar Ativos",
  start_briefing: "Iniciar Briefing",
};

export const STATE_LABEL: Record<ConversationState, string> = {
  idle: "Aguardando",
  processing: "Processando",
  awaiting_context: "Aguardando mais contexto",
  waiting_action: "Aguardando ação",
  resolved: "Resolvido",
  collecting_briefing: "Coletando briefing",
  awaiting_confirmation: "Aguardando confirmação",
};
