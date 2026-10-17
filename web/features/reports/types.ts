/** Relatórios — espelha `src/domain/reports/report-catalog.ts` e `report-use-cases.ts`. */

export type ReportSectionKey =
  | "commercial_overview"
  | "revenue_by_origin"
  | "stage_aging"
  | "loss_reasons"
  | "sales_funnel"
  | "seller_conversion"
  | "top_products"
  | "proposals_performance"
  | "discounts_approvals"
  | "margin"
  | "attendance_overview"
  | "agent_volume"
  | "csat"
  | "closing_reasons";

export type ReportSectionInfo = { key: ReportSectionKey; title: string; description: string };

export type ReportTemplateItem = {
  id: string;
  name: string;
  description?: string;
  sections: ReportSectionKey[];
  /** Modelos do cliente. */
  source?: "manual" | "ai";
  canEdit?: boolean;
  createdAt?: string;
};

export type ReportTemplatesResponse = {
  catalog: ReportSectionInfo[];
  system: ReportTemplateItem[];
  custom: ReportTemplateItem[];
  aiAvailable: boolean;
};

export type ReportTemplateDraft = { name: string; description: string; sections: ReportSectionKey[]; rationale: string; warnings: string[] };

export type ReportAnalysis = {
  generatedAt: string;
  summary: string;
  highlights: { title: string; evidence: string }[];
  risks: { title: string; evidence: string }[];
  recommendations: { title: string; rationale: string; evidence: string }[];
};

/** Conteúdo calculado de uma seção — o mesmo alimenta a tela, o CSV e a análise com IA. */
export type ReportSectionContent = {
  kpis: { label: string; value: string }[];
  table?: { columns: string[]; rows: string[][] };
  empty?: boolean;
  /** Seção sem permissão/dado aplicável (ex.: margem sem acesso a custo). */
  unavailableReason?: string;
};
