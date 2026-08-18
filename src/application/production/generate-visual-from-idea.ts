import type { UserIntentType } from "../../domain/conversation/conversation.model.js";
import { CONTENT_REQUEST_SCHEMA_V1 } from "../../domain/briefing/schemas/content-request.schema.js";
import { confirmBriefingAndPrepareCommand, startBriefing, type BriefingUseCaseDeps } from "../briefing/briefing-use-cases.js";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.js";
import type { PlanningRepositoryPort } from "../ports/planning-repository.port.js";
import type { RuntimeRepositoryPort } from "../ports/runtime-repository.port.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";

// Nenhum `UserIntentType` dedicado existe para "gerar só uma peça visual" (o enum é fechado —
// `create_campaign`/`edit_campaign`/.../`start_briefing`) — `intent` é só metadado guardado no
// PreparedCommand (nunca gate de comportamento, ver `prepare-command.ts`), então "start_briefing"
// é o valor mais honesto disponível: isto nunca vira uma campanha completa.
const CONTENT_REQUEST_INTENT: UserIntentType = "start_briefing";

const CHANNEL_MAP: Record<string, string> = {
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
  // O schema de briefing (content_request) não tem "youtube" no enum de canal — mapeia para
  // "other" em vez de rejeitar a ideia.
  youtube: "other",
};

export type GenerateVisualFromIdeaInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  objective: string;
  ideaText: string;
  format: "single_image" | "carousel";
  channel: string;
  targetAudience?: string;
  /** URLs de imagens de referência já públicas (upload prévio da própria ideia) — descritas via
   * `deps.imageDescriber` e enviadas adiante como `referenceContext`, nunca a imagem em si (o
   * pipeline de geração real só aceita texto no prompt). */
  referenceImageUrls?: string[];
};

export type GenerateVisualFromIdeaDeps = BriefingUseCaseDeps & {
  conversationRepository: ConversationRepositoryPort;
  planningRepository: PlanningRepositoryPort;
  runtimeRepository: RuntimeRepositoryPort;
  imageDescriber?: { describe(imageUrl: string, instruction: string): Promise<string | undefined> };
  /** Reference Intelligence — extração ESTRUTURADA de fatos (produto, categoria, preço, desconto,
   * oferta, o que preservar), diferente de `imageDescriber` (que só produz prosa de estilo visual).
   * Opcional: sem isto configurado, o comportamento é idêntico ao de antes desta funcionalidade
   * existir (só `referenceContext` em texto livre). */
  referenceIntelligenceExtractor?: { extract(imageUrls: string[]): Promise<ReferenceIntelligence | undefined> };
};

const REFERENCE_IMAGE_DESCRIBE_INSTRUCTION =
  "Descreva objetivamente esta imagem de referência em português para orientar uma geração de imagem por IA: tipo de produto/cena, cores predominantes e estilo visual. No máximo 2 frases curtas.";
const MAX_REFERENCE_IMAGES = 3;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Best-effort: qualquer falha (sem `imageDescriber` configurado, timeout, resposta vazia) devolve
 * `undefined` — a geração nunca deveria travar por causa de uma descrição de referência que não
 * saiu. Corta em 800 caracteres pra nunca violar `referenceContext.validation.maxLength`. */
async function describeReferenceImages(deps: GenerateVisualFromIdeaDeps, urls: string[] | undefined): Promise<string | undefined> {
  if (!deps.imageDescriber || !urls?.length) return undefined;
  const descriptions = await Promise.all(
    urls.slice(0, MAX_REFERENCE_IMAGES).map((url) => deps.imageDescriber!.describe(url, REFERENCE_IMAGE_DESCRIBE_INSTRUCTION).catch(() => undefined)),
  );
  const valid = descriptions.filter((description): description is string => Boolean(description));
  if (valid.length === 0) return undefined;
  return valid.join(" ").slice(0, 800);
}

/**
 * Ponte entre uma ideia simples do tanque de Produção e o pipeline de execução real, que hoje só
 * aceita um `runtimePlanId` nascido de um briefing conversacional completo. Escreve os campos
 * obrigatórios de `campaign_creation` diretamente (`source: "user_message"`,
 * `confirmedByUser: true`), o mesmo par que faz `buildPreparedCommandInput` considerar o campo
 * resolvido sem precisar do fluxo de chat/NLU — ver `field-state.ts`/`prepare-command.ts`. Planning
 * e RuntimePlan nascem automaticamente pelos hooks já existentes (`planningEngine`, injetado em
 * `deps`), nenhum código novo de tradução é necessário aqui.
 */
export async function generateVisualFromIdea(
  deps: GenerateVisualFromIdeaDeps,
  input: GenerateVisualFromIdeaInput,
): Promise<{ runtimePlanId: string }> {
  const conversation = await deps.conversationRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    title: input.name,
  });

  const briefing = await startBriefing(deps, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    type: "content_request",
    schemaVersion: CONTENT_REQUEST_SCHEMA_V1.version,
  });

  const channel = CHANNEL_MAP[normalize(input.channel)] ?? "other";
  const contentFormat = input.format === "carousel" ? "carousel" : "image";
  const targetAudience = input.targetAudience?.trim() || "público principal do workspace";

  const fields: Array<{ key: string; value: string }> = [
    { key: "objective", value: input.objective.trim() },
    { key: "offerOrSubject", value: input.ideaText.trim() },
    { key: "targetAudience", value: targetAudience },
    { key: "channel", value: channel },
    { key: "contentFormat", value: contentFormat },
  ];

  const referenceContext = await describeReferenceImages(deps, input.referenceImageUrls);
  if (referenceContext) fields.push({ key: "referenceContext", value: referenceContext });

  // Reference Intelligence (requisito "toda imagem fornecida deve ser analisada ANTES do
  // planejamento", extraindo fatos verificáveis — produto, preço, desconto, oferta, o que
  // preservar) — best-effort, roda em paralelo à descrição de estilo acima, nunca bloqueia a
  // geração se falhar (ver `OpenAiReferenceIntelligenceExtractor.extract`, que nunca lança).
  const referenceUrls = (input.referenceImageUrls ?? []).map((url) => url.trim()).filter(Boolean);
  const referenceIntelligence = await deps.referenceIntelligenceExtractor?.extract(referenceUrls).catch(() => undefined);
  if (referenceUrls.length > 0) fields.push({ key: "referenceImageUrls", value: JSON.stringify(referenceUrls) });
  if (referenceIntelligence) fields.push({ key: "referenceIntelligence", value: JSON.stringify(referenceIntelligence) });

  // Imagem de entrada real pro `/v1/images/edits` (pixels de verdade, não só texto descritivo) —
  // usa `primaryImageIndex` da Reference Intelligence quando disponível (a imagem mais limpa/
  // representativa do produto, que pode não ser a primeira anexada — achado ao vivo: um print de
  // grade com vários produtos foi anexado antes da foto limpa do produto). Sem Reference
  // Intelligence, cai no comportamento de sempre: a primeira imagem da lista.
  const primaryImageIndex = referenceIntelligence && referenceIntelligence.primaryImageIndex < referenceUrls.length ? referenceIntelligence.primaryImageIndex : 0;
  const primaryReferenceImageUrl = referenceUrls[primaryImageIndex];
  if (primaryReferenceImageUrl) fields.push({ key: "referenceImageUrl", value: primaryReferenceImageUrl });

  // Título/headline/legenda/CTA prontos para postar agora são escritos pela Maria de verdade, via
  // o grafo `content_request-visual-only-v2` (campaign_structure → copy_generation, ver
  // `arthur-planner.ts`) — não mais por um redator paralelo mais fraco rodando aqui, antes do
  // Planning sequer começar (achado da auditoria: dois redatores desconectados, um deles sem loop
  // de qualidade nem inteligência de objetivo de marketing).
  for (const field of fields) {
    await deps.fieldValueRepository.append({
      briefingId: briefing.id,
      fieldKey: field.key,
      value: field.value,
      normalizedValue: normalize(field.value),
      source: "user_message",
      confidence: 1,
      confirmedByUser: true,
      ambiguityStatus: "none",
    });
  }

  const { briefing: readyBriefing, command } = await confirmBriefingAndPrepareCommand(deps, {
    briefing,
    schema: CONTENT_REQUEST_SCHEMA_V1,
    intent: CONTENT_REQUEST_INTENT,
  });

  const planning = await deps.planningRepository.getByPreparedCommand(command.id, readyBriefing.revision);
  if (!planning) {
    throw new Error("PRODUCTION_PLANNING_NOT_CREATED: o Planning não foi gerado a partir da ideia — confira se o hook de Planning está configurado.");
  }

  const runtimePlan = await deps.runtimeRepository.getByPlanningId(planning.id);
  if (!runtimePlan) {
    throw new Error("PRODUCTION_RUNTIME_PLAN_NOT_CREATED: o RuntimePlan não foi gerado a partir do Planning — confira se o hook de Runtime está configurado.");
  }

  return { runtimePlanId: runtimePlan.id };
}
