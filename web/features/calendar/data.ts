import { delay, generateId } from "@/lib/mock";
import { listCampaigns } from "@/features/campaigns/data";
import type { CalendarEvent, CalendarEventType } from "./types";

/** Dados simulados — Sprint 04 (Fase 7: "sem integração social"). Deriva parte dos eventos das
 * campanhas simuladas (`features/campaigns/data.ts`) para o calendário não parecer desconectado
 * do resto do Workspace, mais alguns posts avulsos simulados. */
export async function listCalendarEvents(workspaceId: string, filter?: { type?: CalendarEventType }): Promise<CalendarEvent[]> {
  await delay();
  const campaigns = await listCampaigns(workspaceId);
  const fromCampaigns: CalendarEvent[] = campaigns
    .filter((campaign) => campaign.scheduledDate)
    .map((campaign) => ({
      id: `event-${campaign.id}`,
      date: campaign.scheduledDate as string,
      title: campaign.name,
      type: "campaign",
      status: campaign.status,
    }));

  const now = Date.now();
  const standalonePosts: CalendarEvent[] = [2, 5, 14, 20].map((dayOffset) => ({
    id: generateId("event"),
    date: new Date(now + dayOffset * 24 * 60 * 60 * 1000).toISOString(),
    title: "Post de engajamento",
    type: "post",
    status: "scheduled",
  }));

  return [...fromCampaigns, ...standalonePosts].filter((event) => (filter?.type ? event.type === filter.type : true));
}
