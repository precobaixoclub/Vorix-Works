import { describe, expect, it } from "vitest";
import { buildSectionContent, SECTION_SOURCE, sectionLines } from "@/features/reports/sections";
import type { CommercialMetricsReport } from "@/features/crm/types";
import type { InboxMetricsReport } from "@/features/inbox/types";
import type { ReportSectionKey } from "@/features/reports/types";

const commercial: CommercialMetricsReport = {
  dealsCreatedCount: 12, openPipelineValueCents: 5_000_000, wonCount: 4, wonValueCents: 2_000_000, lostCount: 2, conversionRate: 0.6667,
  avgTicketCents: 500_000, avgCycleDays: 9.5, proposalsSentCount: 5, proposalsAcceptedCount: 3, proposalAcceptRate: 0.6, dealsWithoutNextActionCount: 1,
  stageAging: [{ stageId: "s1", stageName: "Negociação", openCount: 3, avgDaysInStage: 4 }],
  lossReasons: [{ reason: "Preço", count: 2 }],
  revenueByOrigin: [{ origin: "whatsapp", wonCount: 3, wonValueCents: 1_500_000 }],
};

const inbox: InboxMetricsReport = {
  receivedCount: 40, openCount: 5, pendingCount: 2, resolvedCount: 33, backlogCount: 7, avgFirstResponseSeconds: 95, avgHandleTimeSeconds: 7200,
  aiResolvedMessageCount: 10, humanResolvedMessageCount: 30, volumeByAgent: [{ userId: "u1", messageCount: 12 }, { userId: "u2", messageCount: 30 }],
};

const sources = { commercial, inbox, memberName: (id: string) => (id === "u1" ? "Ana" : "Bruno") };

describe("seções de relatório", () => {
  it("todas as seções do catálogo têm fonte de dados", () => {
    expect(Object.keys(SECTION_SOURCE)).toHaveLength(14);
  });

  it("visão comercial formata números já calculados (sem recalcular)", () => {
    const content = buildSectionContent("commercial_overview", sources)!;
    const conversion = content.kpis.find((kpi) => kpi.label === "Conversão");
    expect(conversion?.value).toBe("66,7%");
    expect(content.kpis.find((kpi) => kpi.label === "Ciclo médio de venda")?.value).toBe("9,5 dias");
  });

  it("volume por atendente ordena e usa o nome do membro", () => {
    const content = buildSectionContent("agent_volume", sources)!;
    expect(content.table?.rows.map((row) => row[0])).toEqual(["Bruno", "Ana"]);
  });

  it("seção sem fonte carregada fica indefinida (carregando), sem dados fica vazia", () => {
    expect(buildSectionContent("top_products", sources)).toBeUndefined();
    const closing = buildSectionContent("closing_reasons", sources)!;
    expect(closing.empty).toBe(true);
  });

  it("linhas para IA/CSV trazem rótulo e valor literal", () => {
    const lines = sectionLines(buildSectionContent("loss_reasons", sources)!);
    expect(lines).toEqual(["Motivo Preço — Perdas: 2"]);
    const kpiLines = sectionLines(buildSectionContent("attendance_overview", sources)!);
    expect(kpiLines).toContain("1ª resposta média: 2 min");
    expect(kpiLines).toContain("Tempo médio de atendimento: 2 h");
  });

  it("chaves conhecidas", () => {
    const keys: ReportSectionKey[] = ["commercial_overview", "csat"];
    expect(keys.every((key) => key in SECTION_SOURCE)).toBe(true);
  });
});
