import type { BriefingSchema } from "../briefing.model.js";

/**
 * Schema `content_request` v1 — caminho reduzido para gerar só uma peça visual (imagem/carrossel)
 * a partir de uma ideia do tanque de Produção, sem nenhuma etapa de publicação. Subconjunto
 * deliberado dos campos de `campaign_creation` (mesmas chaves — `objective`/`offerOrSubject`/
 * `targetAudience`/`channel`/`contentFormat` — para reaproveitar `generate-visual-from-idea.ts`
 * sem tradução): omite `desiredAction`/`tone`/`deadlineOrPublicationDate`/`referencedAssetName`,
 * que só fazem sentido numa campanha completa com copy/publicação.
 */
export const CONTENT_REQUEST_SCHEMA_V1: BriefingSchema = {
  type: "content_request",
  version: 1,
  questionGroups: [["objective", "offerOrSubject"]],
  fields: [
    {
      key: "objective",
      label: "Objetivo",
      description: "O que a peça visual deve alcançar (ex.: divulgar, captar, vender, engajar).",
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
      description: "O produto, serviço ou assunto central da peça visual.",
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
      description: "Para quem a peça visual é dirigida.",
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
      description: "Onde a peça visual vai ser usada.",
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
      description: "O formato da peça visual (imagem ou carrossel).",
      required: false,
      requiredWhen: { operator: "exists", field: "channel" },
      dependsOn: ["channel"],
      dataType: "enum",
      acceptedValues: ["image", "carousel"],
      sourcePriority: ["user_message", "conversation_memory"],
      sensitivity: "normal",
      confirmationPolicy: "required_for_external_source",
    },
    {
      // Sem isto, imagens de referência anexadas na ideia (`ContentBlueprint.referenceImages`)
      // nunca chegavam à geração real — só o texto seguia adiante. `offerOrSubject` tem só 200
      // caracteres de limite (apertado demais para uma descrição de imagem via visão computacional
      // sem risco de estourar), por isso um campo próprio, com mais espaço, nunca perguntado
      // interativamente (`never_required` — só preenchido por `generate-visual-from-idea.ts`).
      key: "referenceContext",
      label: "Contexto de referência",
      description: "Descrição derivada de imagens de referência anexadas pelo usuário (produto, cores, estilo).",
      required: false,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { maxLength: 800 },
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
  ],
};
