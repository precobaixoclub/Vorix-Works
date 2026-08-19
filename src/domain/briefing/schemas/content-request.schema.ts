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
    {
      // URL pública da PRIMEIRA imagem de referência anexada — usada de verdade como entrada
      // visual na geração (`POST /v1/images/edits`, não só `/generations` por texto), diferente de
      // `referenceContext` (que é só a descrição em texto, via visão computacional). Sem isto, o
      // produto gerado nunca batia com o exemplo anexado (achado ao vivo comparando com o fluxo do
      // usuário no ChatGPT, que sempre anexa a foto real do produto).
      key: "referenceImageUrl",
      label: "URL da imagem de referência",
      description: "URL pública da imagem de referência principal, usada como entrada visual real na geração.",
      required: false,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { maxLength: 2000 },
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
    {
      // Todas as URLs de referência anexadas (JSON stringificado), não só a primeira —
      // `referenceImageUrl` acima continua sendo o fallback/valor padrão quando não há
      // `referenceIntelligence` (ex.: falha na extração). Existe pra `primaryImageIndex` (ver
      // `referenceIntelligence` abaixo) ter em que indexar quando a Reference Intelligence decide
      // que a imagem mais representativa não é a primeira da lista.
      key: "referenceImageUrls",
      label: "URLs das imagens de referência",
      description: "Lista (JSON) de todas as URLs de imagens de referência anexadas pelo usuário, na ordem original.",
      required: false,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { maxLength: 4000 },
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
    {
      // Fatos estruturados extraídos das imagens de referência (produto, categoria, cor, preço,
      // desconto, condição comercial, texto visível, o que preservar) — JSON stringificado de
      // `ReferenceIntelligence` (`src/shared/utils/reference-intelligence.types.ts`). Correção da
      // falha crítica encontrada ao vivo: sem isto, preço/desconto/oferta visíveis numa foto de
      // referência eram completamente ignorados — só existia descrição de ESTILO visual
      // (`referenceContext`), nunca fato comercial. `never_required`: só preenchido
      // automaticamente por `generate-visual-from-idea.ts`, nunca perguntado ao usuário.
      key: "referenceIntelligence",
      label: "Inteligência de referência",
      description: "Fatos estruturados (produto, categoria, preço, desconto, oferta, o que preservar) extraídos das imagens de referência.",
      required: false,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { maxLength: 4000 },
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
    {
      // Commercial Fact Normalizer (Rodada 2, Prioridade 4) — fatos comerciais extraídos por regex
      // do texto livre da ideia do usuário (JSON stringificado de `CommercialFact[]`,
      // `commercial-fact-normalizer.ts`), mesmo padrão de `referenceIntelligence` acima. Achado ao
      // vivo: sem este campo registrado aqui, o schema do briefing (allowlist explícita de campos)
      // descartava o valor silenciosamente antes mesmo de virar `PreparedCommand.validatedInputs` —
      // um preço mencionado só no texto (ex.: "de R$79,90 por R$39,99") nunca chegava a Bianca,
      // mesmo com a extração em si funcionando corretamente.
      key: "textCommercialFacts",
      label: "Fatos comerciais do texto",
      description: "Fatos comerciais (preço, desconto, frete, urgência) extraídos do texto livre da ideia do usuário.",
      required: false,
      dataType: "string",
      sourcePriority: ["user_message"],
      validation: { maxLength: 4000 },
      sensitivity: "normal",
      confirmationPolicy: "never_required",
    },
  ],
};
