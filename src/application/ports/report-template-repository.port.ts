import type { ReportSectionKey } from "../../domain/reports/report-catalog.js";

export type ReportTemplate = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  description?: string;
  sections: ReportSectionKey[];
  source: "manual" | "ai";
  aiRequest?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportTemplateRepositoryPort = {
  list(input: { tenantId: string; workspaceId: string }): Promise<ReportTemplate[]>;
  getById(id: string): Promise<ReportTemplate | undefined>;
  create(input: Omit<ReportTemplate, "id" | "createdAt" | "updatedAt">): Promise<ReportTemplate>;
  update(id: string, patch: { name?: string; description?: string | null; sections?: ReportSectionKey[] }): Promise<ReportTemplate>;
  delete(id: string): Promise<void>;
};

/** IA de relatórios — porta pequena; o adapter traduz para o AI Gateway (créditos já cobrados lá). */
export type ReportAnalysisInput = { tenantId: string; workspaceId: string; reportName: string; periodLabel: string; sections: { title: string; lines: string[] }[]; focus?: string };
export type ReportAnalysis = {
  summary: string;
  highlights: { title: string; evidence: string }[];
  risks: { title: string; evidence: string }[];
  recommendations: { title: string; rationale: string; evidence: string }[];
};
export type ReportTemplateDraft = { name: string; description: string; sections: ReportSectionKey[]; rationale: string; warnings: string[] };
export type ReportAiFailure = { ok: false; category: string; message: string };

export type ReportAiPort = {
  analyze(input: ReportAnalysisInput): Promise<({ ok: true } & ReportAnalysis) | ReportAiFailure>;
  buildTemplate(input: { tenantId: string; workspaceId: string; request: string; catalog: { key: string; title: string; description: string }[] }): Promise<({ ok: true } & ReportTemplateDraft) | ReportAiFailure>;
};
