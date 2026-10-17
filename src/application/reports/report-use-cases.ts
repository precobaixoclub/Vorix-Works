import { isReportSectionKey, REPORT_SECTIONS, SYSTEM_REPORT_TEMPLATES, type ReportSectionKey } from "../../domain/reports/report-catalog.js";
import type { TenantRole } from "../../domain/identity/identity.model.js";
import type { ReportAiPort, ReportAnalysis, ReportTemplate, ReportTemplateDraft, ReportTemplateRepositoryPort } from "../ports/report-template-repository.port.js";

/**
 * Relatórios — modelos fixos (código), modelos do cliente (banco) e IA (análise do relatório e
 * criação de modelo). Um modelo é sempre uma lista de seções do catálogo fechado: nunca consulta
 * livre, nunca dado de outro tenant.
 */
export type ReportUseCaseDeps = { reportTemplateRepository: ReportTemplateRepositoryPort; reportAi?: ReportAiPort };
export type ReportActor = { tenantId: string; userId: string; role: TenantRole };

const MAX_SECTIONS = 12;
/** Limite do relatório enviado à IA — o painel manda linhas curtas já formatadas. */
const MAX_ANALYSIS_LINES = 160;

function cleanSections(sections: readonly string[]): ReportSectionKey[] {
  const unique = [...new Set(sections)].filter(isReportSectionKey);
  if (unique.length === 0) throw new Error("REPORT_TEMPLATE_INVALID: escolha ao menos uma seção.");
  if (unique.length > MAX_SECTIONS) throw new Error(`REPORT_TEMPLATE_INVALID: no máximo ${MAX_SECTIONS} seções por relatório.`);
  return unique;
}

async function mustTemplate(deps: ReportUseCaseDeps, actor: ReportActor, workspaceId: string, id: string): Promise<ReportTemplate> {
  const template = await deps.reportTemplateRepository.getById(id);
  if (!template || template.tenantId !== actor.tenantId || template.workspaceId !== workspaceId) throw new Error(`REPORT_TEMPLATE_NOT_FOUND: modelo "${id}" não existe.`);
  return template;
}

const canEdit = (actor: ReportActor, template: ReportTemplate) => template.createdBy === actor.userId || actor.role === "owner" || actor.role === "admin";

export async function listReportTemplates(deps: ReportUseCaseDeps, actor: ReportActor, input: { workspaceId: string }) {
  const custom = await deps.reportTemplateRepository.list({ tenantId: actor.tenantId, workspaceId: input.workspaceId });
  return {
    catalog: REPORT_SECTIONS,
    system: SYSTEM_REPORT_TEMPLATES,
    custom: custom.map((template) => ({ ...template, canEdit: canEdit(actor, template) })),
    aiAvailable: Boolean(deps.reportAi),
  };
}

export async function createReportTemplate(deps: ReportUseCaseDeps, actor: ReportActor, input: { workspaceId: string; name: string; description?: string; sections: string[]; source?: "manual" | "ai"; aiRequest?: string }): Promise<ReportTemplate> {
  const name = input.name.trim();
  if (!name) throw new Error("REPORT_TEMPLATE_INVALID: dê um nome ao relatório.");
  return deps.reportTemplateRepository.create({
    tenantId: actor.tenantId, workspaceId: input.workspaceId, name: name.slice(0, 80), description: input.description?.trim().slice(0, 300) || undefined,
    sections: cleanSections(input.sections), source: input.source ?? "manual", aiRequest: input.aiRequest?.trim().slice(0, 1000) || undefined, createdBy: actor.userId,
  });
}

export async function updateReportTemplate(deps: ReportUseCaseDeps, actor: ReportActor, input: { workspaceId: string; id: string; name?: string; description?: string | null; sections?: string[] }): Promise<ReportTemplate> {
  const template = await mustTemplate(deps, actor, input.workspaceId, input.id);
  if (!canEdit(actor, template)) throw new Error("REPORT_TEMPLATE_FORBIDDEN: só quem criou o modelo ou a gestão pode alterá-lo.");
  if (input.name !== undefined && !input.name.trim()) throw new Error("REPORT_TEMPLATE_INVALID: dê um nome ao relatório.");
  return deps.reportTemplateRepository.update(template.id, {
    ...(input.name !== undefined ? { name: input.name.trim().slice(0, 80) } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim().slice(0, 300) || null } : {}),
    ...(input.sections ? { sections: cleanSections(input.sections) } : {}),
  });
}

export async function deleteReportTemplate(deps: ReportUseCaseDeps, actor: ReportActor, input: { workspaceId: string; id: string }): Promise<void> {
  const template = await mustTemplate(deps, actor, input.workspaceId, input.id);
  if (!canEdit(actor, template)) throw new Error("REPORT_TEMPLATE_FORBIDDEN: só quem criou o modelo ou a gestão pode excluí-lo.");
  await deps.reportTemplateRepository.delete(template.id);
}

/** Rascunho de modelo pela IA — NUNCA salvo sozinho: o cliente revisa e salva. */
export async function draftReportTemplateWithAi(deps: ReportUseCaseDeps, actor: ReportActor, input: { workspaceId: string; request: string }): Promise<ReportTemplateDraft> {
  if (!deps.reportAi) throw new Error("REPORT_AI_UNAVAILABLE: a IA de relatórios não está disponível.");
  const request = input.request.trim();
  if (request.length < 8) throw new Error("REPORT_TEMPLATE_INVALID: descreva o que você quer acompanhar no relatório.");
  const result = await deps.reportAi.buildTemplate({
    tenantId: actor.tenantId, workspaceId: input.workspaceId, request: request.slice(0, 1000),
    catalog: REPORT_SECTIONS.map((section) => ({ key: section.key, title: section.title, description: section.description })),
  });
  if (!result.ok) throw new Error(`REPORT_AI_FAILED(${result.category}): ${result.message}`);
  return { name: result.name, description: result.description, sections: cleanSections(result.sections), rationale: result.rationale, warnings: result.warnings };
}

export async function analyzeReportWithAi(deps: ReportUseCaseDeps, actor: ReportActor, input: { workspaceId: string; reportName: string; periodLabel: string; sections: { title: string; lines: string[] }[]; focus?: string }): Promise<ReportAnalysis & { generatedAt: string }> {
  if (!deps.reportAi) throw new Error("REPORT_AI_UNAVAILABLE: a IA de relatórios não está disponível.");
  const sections = input.sections
    .map((section) => ({ title: section.title.slice(0, 80), lines: section.lines.map((line) => line.slice(0, 200)) }))
    .filter((section) => section.title);
  const totalLines = sections.reduce((sum, section) => sum + section.lines.length, 0);
  if (totalLines === 0) throw new Error("REPORT_ANALYSIS_EMPTY: o relatório não tem dados no período para analisar.");
  if (totalLines > MAX_ANALYSIS_LINES) throw new Error("REPORT_TEMPLATE_INVALID: relatório grande demais para a análise — reduza as seções.");
  const result = await deps.reportAi.analyze({ tenantId: actor.tenantId, workspaceId: input.workspaceId, reportName: input.reportName.slice(0, 80), periodLabel: input.periodLabel.slice(0, 80), sections, focus: input.focus?.trim().slice(0, 300) || undefined });
  if (!result.ok) throw new Error(`REPORT_AI_FAILED(${result.category}): ${result.message}`);
  return { summary: result.summary, highlights: result.highlights, risks: result.risks, recommendations: result.recommendations, generatedAt: new Date().toISOString() };
}
