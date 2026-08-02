import type { BriefingSchema } from "../briefing.model.js";

/**
 * Schema `campaign_creation` v1 — Sprint 07. Único schema implementado integralmente nesta
 * sprint (escopo aprovado). Campos revisados contra `CampaignPlan` real
 * (`src/application/campaign/campaign.types.ts`): `CampaignPlan` usa `persona` (string única) em
 * vez de `targetAudience`, não tem `tone`, não tem `deadline` isolado — este schema é
 * DELIBERADAMENTE distinto de `CampaignPlan`. O Briefing decide SE e COM QUE DADOS uma campanha
 * deveria nascer; traduzir isso para um `CampaignPlan` de verdade é trabalho de sprint futura
 * (ver `PreparedCommand` — nunca executado aqui).
 */
export const CAMPAIGN_CREATION_SCHEMA_V1: BriefingSchema = {
  type: "campaign_creation",
  version: 1,
  questionGroups: [["objective", "offerOrSubject"]],
  fields: [
    {
      key: "objective",
      label: "Objetivo",
      description: "O que a campanha deve alcançar (ex.: divulgar, captar, vender, engajar).",
      required: true,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { minLength: 3, maxLength: 300 },
      sensitivity: "normal",
      confirmationPolicy: "always_required",
    },
    {
      key: "offerOrSubject",
      label: "Oferta ou assunto",
      description: "O produto, serviço ou assunto central da campanha.",
      required: true,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { minLength: 2, maxLength: 200 },
      sensitivity: "normal",
      confirmationPolicy: "always_required",
    },
    {
      key: "targetAudience",
      label: "Público-alvo",
      description: "Para quem a campanha é dirigida.",
      // "obrigatório, salvo se houver valor empresarial confirmado" — a obrigatoriedade estática
      // continua true; o que muda é que um valor de company_knowledge só deixa de faltar depois
      // de CONFIRMADO (ver confirmationPolicy) — nunca por presença isolada da fonte.
      required: true,
      dataType: "string",
      sourcePriority: ["user_message", "conversation_memory", "company_knowledge"],
      validation: { minLength: 2, maxLength: 300 },
      sensitivity: "normal",
      confirmationPolicy: "required_for_external_source",
    },
    {
      key: "channel",
      label: "Canal",
      description: "Onde a campanha vai rodar.",
      required: true,
      dataType: "enum",
      acceptedValues: ["instagram", "facebook", "tiktok", "website", "email", "other"],
      sourcePriority: ["user_message", "conversation_memory", "workspace"],
      sensitivity: "normal",
      confirmationPolicy: "required_for_external_source",
    },
    {
      key: "contentFormat",
      label: "Formato",
      description: "O formato de conteúdo (imagem, carrossel, vídeo, story, reel, texto).",
      required: false,
      // Só vira obrigatório depois que o canal é conhecido — "contentFormat pode depender do canal".
      requiredWhen: { operator: "exists", field: "channel" },
      dependsOn: ["channel"],
      dataType: "enum",
      acceptedValues: ["image", "carousel", "video", "story", "reel", "text"],
      sourcePriority: ["user_message", "conversation_memory"],
      sensitivity: "normal",
      confirmationPolicy: "required_for_external_source",
    },
    {
      key: "desiredAction",
      label: "Chamada para ação",
      description: "O que o público deve fazer ao ver a campanha.",
      required: false,
      highImpact: true,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { maxLength: 200 },
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
    {
      key: "tone",
      label: "Tom de voz",
      description: "O tom desejado para a comunicação.",
      required: false,
      highImpact: true,
      dataType: "string",
      sourcePriority: ["user_message", "company_knowledge"],
      validation: { maxLength: 100 },
      sensitivity: "normal",
      confirmationPolicy: "required_for_external_source",
    },
    {
      key: "deadlineOrPublicationDate",
      label: "Prazo ou data de publicação",
      description: "Quando a campanha precisa estar pronta ou ser publicada.",
      required: false,
      // "condicional para agendamento ou pedido com data" — vira obrigatório quando o próprio
      // objetivo já menciona agendamento.
      requiredWhen: { operator: "contains", field: "objective", value: "agend" },
      dataType: "date",
      sourcePriority: ["user_message"],
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
    {
      key: "referencedAssetName",
      label: "Asset de referência",
      description: "Um ativo já existente na biblioteca que deve ser usado como referência.",
      required: false,
      dataType: "string",
      sourcePriority: ["user_message", "asset_metadata"],
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
  ],
};
