import { delay, generateId } from "@/lib/mock";
import type { Campaign, CampaignFormat, CampaignStatus } from "./types";

/** Dados simulados — Sprint 04 (Fase 5: "ainda sem geração, apenas estrutura"). */

const campaignsByWorkspace = new Map<string, Campaign[]>();
const seeded = new Set<string>();

function seed(workspaceId: string): void {
  if (seeded.has(workspaceId)) return;
  seeded.add(workspaceId);
  const now = Date.now();
  const seedData: Array<{ name: string; status: CampaignStatus; format: CampaignFormat; daysFromNow: number }> = [
    { name: "Lançamento de coleção — verão", status: "completed", format: "carousel", daysFromNow: -12 },
    { name: "Convite para live de dúvidas", status: "in_progress", format: "reel", daysFromNow: -1 },
    { name: "Promoção de fim de semana", status: "scheduled", format: "story", daysFromNow: 3 },
    { name: "Depoimentos de clientes", status: "draft", format: "video", daysFromNow: 8 },
  ];
  campaignsByWorkspace.set(
    workspaceId,
    seedData.map((item) => ({
      id: generateId("campaign"),
      workspaceId,
      name: item.name,
      status: item.status,
      format: item.format,
      origin: "manual",
      scheduledDate: new Date(now + item.daysFromNow * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(now + (item.daysFromNow - 10) * 24 * 60 * 60 * 1000).toISOString(),
    })),
  );
}

export async function listCampaigns(workspaceId: string): Promise<Campaign[]> {
  await delay();
  seed(workspaceId);
  return [...(campaignsByWorkspace.get(workspaceId) ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createCampaign(workspaceId: string, input: { name: string; format: CampaignFormat }): Promise<Campaign> {
  await delay();
  seed(workspaceId);
  const campaign: Campaign = {
    id: generateId("campaign"),
    workspaceId,
    name: input.name,
    format: input.format,
    status: "draft",
    origin: "manual",
    createdAt: new Date().toISOString(),
  };
  campaignsByWorkspace.set(workspaceId, [campaign, ...(campaignsByWorkspace.get(workspaceId) ?? [])]);
  return campaign;
}
