import type { UserIntentType } from "../../domain/conversation/conversation.model.js";
import { CAMPAIGN_CREATION_SCHEMA_V1 } from "../../domain/briefing/schemas/campaign-creation.schema.js";
import { confirmBriefingAndPrepareCommand, startBriefing, type BriefingUseCaseDeps } from "../briefing/briefing-use-cases.js";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.js";
import type { PlanningRepositoryPort } from "../ports/planning-repository.port.js";
import type { RuntimeRepositoryPort } from "../ports/runtime-repository.port.js";

const CREATE_CAMPAIGN_INTENT: UserIntentType = "create_campaign";

const CHANNEL_MAP: Record<string, string> = {
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
  // O schema de briefing (campaign_creation) não tem "youtube" no enum de canal — mapeia para
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
};

export type GenerateVisualFromIdeaDeps = BriefingUseCaseDeps & {
  conversationRepository: ConversationRepositoryPort;
  planningRepository: PlanningRepositoryPort;
  runtimeRepository: RuntimeRepositoryPort;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
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
    type: "campaign_creation",
    schemaVersion: CAMPAIGN_CREATION_SCHEMA_V1.version,
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
    schema: CAMPAIGN_CREATION_SCHEMA_V1,
    intent: CREATE_CAMPAIGN_INTENT,
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
