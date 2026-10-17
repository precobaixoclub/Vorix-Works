import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import type { ReportAnalysis, ReportSectionKey, ReportTemplateDraft, ReportTemplateItem, ReportTemplatesResponse } from "./types";

const q = encodeURIComponent;

export const listReportTemplates = (workspaceId: string) => apiClient.get<ReportTemplatesResponse>(`/v1/report-templates?workspaceId=${q(workspaceId)}`);
export const createReportTemplate = (input: { workspaceId: string; name: string; description?: string; sections: ReportSectionKey[]; source?: "manual" | "ai"; aiRequest?: string }) =>
  apiClient.post<ReportTemplateItem>("/v1/report-templates", input);
export const updateReportTemplate = (id: string, input: { workspaceId: string; name?: string; description?: string | null; sections?: ReportSectionKey[] }) =>
  apiClient.patch<ReportTemplateItem>(`/v1/report-templates/${q(id)}`, input);
export const deleteReportTemplate = (id: string, workspaceId: string) => apiClient.delete<null>(`/v1/report-templates/${q(id)}?workspaceId=${q(workspaceId)}`);
/** Rascunho com IA — nunca salvo sozinho; o cliente revisa e salva. Consome créditos. */
export const draftReportTemplateWithAi = (workspaceId: string, request: string) => apiClient.post<ReportTemplateDraft>("/v1/report-templates/ai-draft", { workspaceId, request });
/** Análise com IA do relatório calculado na tela. Consome créditos. */
export const analyzeReport = (input: { workspaceId: string; reportName: string; periodLabel: string; sections: { title: string; lines: string[] }[]; focus?: string }) =>
  apiClient.post<ReportAnalysis>("/v1/reports/ai-analysis", input);

export function useReportTemplates(workspaceId: string) {
  return useSWR(["report-templates", workspaceId], () => listReportTemplates(workspaceId));
}
