import type { ExecutionPlan } from "../orchestration/execution-plan.contract.js";
import type {
  CampaignContentItem,
  CampaignContentStatus,
  CampaignCreationInput,
  CampaignPlan,
  CampaignQuery,
  CampaignStatusSummary,
} from "./campaign.types.js";

export type CampaignContentExecutionPlanResult = {
  contentId: string;
  executionPlan: ExecutionPlan;
};

/**
 * Porta pública do Campaign Manager. Funciona ACIMA do Arthur: nenhum método aqui participa de um
 * ExecutionPlan ou é convocado por Caio/Helena. `generateExecutionPlanForContent` é o único ponto
 * de contato com o resto do sistema, e é uma chamada unidirecional a
 * `ArthurTextCommandPlannerPort.planFromText` — Arthur nunca chama o Campaign Manager de volta.
 */
export type CampaignManagerPort = {
  createCampaign(input: CampaignCreationInput): Promise<CampaignPlan>;
  listCampaigns(query?: CampaignQuery): Promise<CampaignPlan[]>;
  getCampaign(campaignId: string): Promise<CampaignPlan | undefined>;
  generateExecutionPlanForContent(campaignId: string, contentId: string): Promise<CampaignContentExecutionPlanResult>;
  updateContentStatus(campaignId: string, contentId: string, status: CampaignContentStatus, reason?: string): Promise<CampaignContentItem>;
  getStatusSummary(campaignId: string): Promise<CampaignStatusSummary>;
};
