import type { AIProviderPort } from "../ports/ai-provider.port.js";
import type { IcaroAIRequest, IcaroProviderSelection } from "./icaro.types.js";

export type IcaroProviderSelectionPolicyPort = {
  select(request: IcaroAIRequest, providers: AIProviderPort[]): IcaroProviderSelection[];
};

export class DeterministicIcaroProviderSelectionPolicy implements IcaroProviderSelectionPolicyPort {
  select(request: IcaroAIRequest, providers: AIProviderPort[]): IcaroProviderSelection[] {
    return providers
      .filter((provider) => provider.profile.enabled)
      .filter((provider) => provider.profile.supportedTaskTypes.includes(request.taskType))
      .flatMap((provider) => provider.profile.models
        .filter((model) => model.supportedTaskTypes.includes(request.taskType))
        .map((model) => ({
          provider: provider.profile,
          model,
          score: scoreSelection(request, provider, model),
          reason: buildSelectionReason(request, provider, model),
        })))
      .sort((left, right) => right.score - left.score);
  }
}

function scoreSelection(
  request: IcaroAIRequest,
  provider: AIProviderPort,
  model: AIProviderPort["profile"]["models"][number],
): number {
  const costScore = Math.max(0, 100 - ((model.costPer1kInputTokens + model.costPer1kOutputTokens) * 100));
  const baseScore =
    (provider.profile.priority * 1000) +
    (model.priority * 100) +
    (model.qualityScore * 3) +
    (model.speedScore * 2) +
    costScore;

  if (request.priority === "quality") return baseScore + (model.qualityScore * 5);
  if (request.priority === "speed") return baseScore + (model.speedScore * 5);
  if (request.priority === "cost") return baseScore + (costScore * 5);
  return baseScore;
}

function buildSelectionReason(
  request: IcaroAIRequest,
  provider: AIProviderPort,
  model: AIProviderPort["profile"]["models"][number],
): string {
  const priority = request.priority ?? "balanced";
  return [
    `Provider ${provider.profile.id} suporta ${request.taskType}.`,
    `Modelo ${model.id} suporta ${request.taskType}.`,
    `Critério principal: ${priority}.`,
  ].join(" ");
}
