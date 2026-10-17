import { randomUUID } from "node:crypto";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import type { ReportAiPort, ReportAnalysisInput } from "../../application/ports/report-template-repository.port.js";
import { REPORT_AI_ANALYSIS_POLICY, REPORT_TEMPLATE_BUILDER_POLICY } from "../../application/ai-gateway/policies.js";
import type { ReportAnalysisResult } from "../../application/ai-gateway/schemas/report-analysis-result.v1.js";
import type { ReportTemplateResult } from "../../application/ai-gateway/schemas/report-template-result.v1.js";
import type { ReportSectionKey } from "../../domain/reports/report-catalog.js";

/** Único adapter de `ReportAiPort` — `report_ai_analysis` e `report_template_builder` via AI
 * Gateway (créditos e limites já aplicados pelo gateway). Falha do provider nunca lança. */
export class AiGatewayReportAi implements ReportAiPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async analyze(input: ReportAnalysisInput) {
    const result = await this.aiGateway.execute({
      operation: "report_ai_analysis",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      input: { reportName: input.reportName, periodLabel: input.periodLabel, sections: input.sections, ...(input.focus ? { focus: input.focus } : {}) },
      outputSchema: { id: "report-analysis-result", version: 1 },
      policy: REPORT_AI_ANALYSIS_POLICY,
    });
    if (!result.ok) return { ok: false as const, category: result.error.category, message: result.error.message };
    const output = result.data.output as ReportAnalysisResult;
    return { ok: true as const, summary: output.summary, highlights: output.highlights, risks: output.risks, recommendations: output.recommendations };
  }

  async buildTemplate(input: { tenantId: string; workspaceId: string; request: string; catalog: { key: string; title: string; description: string }[] }) {
    const result = await this.aiGateway.execute({
      operation: "report_template_builder",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      input: { request: input.request, catalog: input.catalog },
      outputSchema: { id: "report-template-result", version: 1 },
      policy: REPORT_TEMPLATE_BUILDER_POLICY,
    });
    if (!result.ok) return { ok: false as const, category: result.error.category, message: result.error.message };
    const output = result.data.output as ReportTemplateResult;
    return { ok: true as const, name: output.name, description: output.description, sections: output.sections as ReportSectionKey[], rationale: output.rationale, warnings: output.warnings };
  }
}
