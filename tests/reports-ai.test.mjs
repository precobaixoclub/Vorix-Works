import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresReportTemplateRepository } from "../dist/infrastructure/storage/postgres/postgres-report-template-repository.js";
import {
  analyzeReportWithAi,
  createReportTemplate,
  deleteReportTemplate,
  draftReportTemplateWithAi,
  listReportTemplates,
  updateReportTemplate,
} from "../dist/application/reports/report-use-cases.js";
import { applyReportAnalysisSemanticValidation, validateReportAnalysisStructure } from "../dist/application/ai-gateway/schemas/report-analysis-result.v1.js";
import { applyReportTemplateSemanticValidation } from "../dist/application/ai-gateway/schemas/report-template-result.v1.js";
import { reportAnalysisPromptV1 } from "../dist/application/ai-gateway/prompts/report-ai.v1.js";
import { getPromptTemplateRegistration } from "../dist/application/ai-gateway/prompt-template-registry.js";
import { OPERATION_REQUIRED_CAPABILITY } from "../dist/application/ai-gateway/model-registry.js";
import { REPORT_SECTION_KEYS, SYSTEM_REPORT_TEMPLATES } from "../dist/domain/reports/report-catalog.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Relatórios: modelos fixos + do cliente (só seções do catálogo), permissões de edição, rascunho
 * com IA nunca salvo sozinho e análise com IA ancorada em números literais do relatório. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

function setup(reportAi) {
  counter += 1;
  const tenantId = `tenant-reports-${counter}`;
  const workspaceId = `ws-reports-${counter}`;
  return {
    d: { reportTemplateRepository: new PostgresReportTemplateRepository(db.pool), reportAi },
    workspaceId,
    seller: { tenantId, userId: `seller-${counter}`, role: "editor" },
    other: { tenantId, userId: `other-${counter}`, role: "editor" },
    manager: { tenantId, userId: `manager-${counter}`, role: "admin" },
    stranger: { tenantId: `tenant-x-${counter}`, userId: "x", role: "owner" },
  };
}

test("CATÁLOGO: modelos fixos só usam seções do catálogo e as operações de IA estão registradas", async () => {
  for (const template of SYSTEM_REPORT_TEMPLATES) for (const key of template.sections) assert.ok(REPORT_SECTION_KEYS.includes(key), key);
  assert.equal(OPERATION_REQUIRED_CAPABILITY.report_ai_analysis, "structured_text");
  assert.ok(getPromptTemplateRegistration("report_ai_analysis"));
  assert.ok(getPromptTemplateRegistration("report_template_builder"));
  const rows = await db.pool.query("select code, credits_cost from ai_operation_types where code in ('report_ai_analysis','report_template_builder') order by code");
  assert.deepEqual(rows.rows.map((row) => [row.code, Number(row.credits_cost)]), [["report_ai_analysis", 2], ["report_template_builder", 1]]);
});

test("MODELOS: cliente cria só com seções válidas; quem criou ou a gestão edita; outro tenant não vê", async () => {
  const { d, workspaceId, seller, other, manager, stranger } = setup();
  await assert.rejects(createReportTemplate(d, seller, { workspaceId, name: "Vazio", sections: ["nao_existe"] }), /REPORT_TEMPLATE_INVALID/);
  const template = await createReportTemplate(d, seller, { workspaceId, name: "Semanal", sections: ["loss_reasons", "commercial_overview", "loss_reasons", "x"] });
  assert.deepEqual(template.sections, ["loss_reasons", "commercial_overview"], "remove duplicadas e desconhecidas, mantém a ordem");

  const listed = await listReportTemplates(d, other, { workspaceId });
  assert.equal(listed.system.length, SYSTEM_REPORT_TEMPLATES.length);
  assert.equal(listed.custom[0].canEdit, false);
  await assert.rejects(updateReportTemplate(d, other, { workspaceId, id: template.id, name: "Meu" }), /REPORT_TEMPLATE_FORBIDDEN/);
  const renamed = await updateReportTemplate(d, manager, { workspaceId, id: template.id, name: "Fechamento semanal", sections: ["csat"] });
  assert.deepEqual([renamed.name, renamed.sections], ["Fechamento semanal", ["csat"]]);
  await assert.rejects(deleteReportTemplate(d, stranger, { workspaceId, id: template.id }), /REPORT_TEMPLATE_NOT_FOUND/);
  await deleteReportTemplate(d, seller, { workspaceId, id: template.id });
  assert.equal((await listReportTemplates(d, seller, { workspaceId })).custom.length, 0);
});

test("IA: rascunho de modelo usa o catálogo e não salva nada; análise exige dados e repassa o relatório", async () => {
  const calls = [];
  const reportAi = {
    buildTemplate: async (input) => { calls.push(["template", input]); return { ok: true, name: "Fechamento", description: "Semana", sections: ["commercial_overview", "seller_conversion"], rationale: "Vendas e vendedores.", warnings: [] }; },
    analyze: async (input) => { calls.push(["analysis", input]); return { ok: true, summary: "Boa semana.", highlights: [{ title: "Conversão alta", evidence: "Conversão: 40%" }], risks: [], recommendations: [] }; },
  };
  const { d, workspaceId, seller } = setup(reportAi);
  const draft = await draftReportTemplateWithAi(d, seller, { workspaceId, request: "Quero ver as vendas da semana por vendedor" });
  assert.deepEqual(draft.sections, ["commercial_overview", "seller_conversion"]);
  assert.equal(calls[0][1].catalog.length, REPORT_SECTION_KEYS.length);
  assert.equal((await listReportTemplates(d, seller, { workspaceId })).custom.length, 0, "rascunho nunca é salvo sozinho");

  await assert.rejects(analyzeReportWithAi(d, seller, { workspaceId, reportName: "R", periodLabel: "Semana", sections: [{ title: "Visão", lines: [] }] }), /REPORT_ANALYSIS_EMPTY/);
  const analysis = await analyzeReportWithAi(d, seller, { workspaceId, reportName: "R", periodLabel: "Semana", sections: [{ title: "Visão comercial", lines: ["Conversão: 40%"] }] });
  assert.equal(analysis.highlights[0].evidence, "Conversão: 40%");
  assert.ok(analysis.generatedAt);

  const failing = setup({ analyze: async () => ({ ok: false, category: "quota_exceeded", message: "sem créditos" }), buildTemplate: async () => ({ ok: false, category: "quota_exceeded", message: "x" }) });
  await assert.rejects(analyzeReportWithAi(failing.d, failing.seller, { workspaceId, reportName: "R", periodLabel: "S", sections: [{ title: "A", lines: ["B: 1"] }] }), /REPORT_AI_FAILED\(quota_exceeded\)/);
  const noAi = setup();
  await assert.rejects(draftReportTemplateWithAi(noAi.d, noAi.seller, { workspaceId, request: "qualquer coisa útil" }), /REPORT_AI_UNAVAILABLE/);
});

test("ANTI-ALUCINAÇÃO: só sobrevive item com evidência literal do relatório; seção fora do catálogo cai", () => {
  const sourceText = reportAnalysisPromptV1.buildUserInput({ reportName: "Resumo", periodLabel: "Mês", sections: [{ title: "Visão comercial", lines: ["Conversão: 32,5%", "Ticket médio: R$ 1.200,00"] }] });
  const structural = validateReportAnalysisStructure({
    schemaVersion: 1,
    summary: "Conversão de 32,5% no mês.",
    highlights: [{ title: "Ticket bom", evidence: "Ticket médio: R$ 1.200,00" }, { title: "Inventado", evidence: "Receita cresceu 50%" }],
    risks: [{ title: "Conversão", evidence: "conversão:   32,5%" }],
    recommendations: [{ title: "Ligar para leads", rationale: "x", evidence: "Leads parados: 12" }],
    warnings: [],
  });
  assert.equal(structural.valid, true);
  const result = applyReportAnalysisSemanticValidation({ structural: structural.data, sourceText });
  assert.deepEqual(result.data.highlights.map((item) => item.title), ["Ticket bom"]);
  assert.equal(result.data.risks.length, 1, "compara sem depender de espaços/maiúsculas");
  assert.equal(result.data.recommendations.length, 0);
  assert.ok(result.warnings.some((warning) => warning.startsWith("highlight_not_grounded")));

  const template = applyReportTemplateSemanticValidation({ schemaVersion: 1, name: "X", description: "", sections: ["csat", "inventada", "csat"], rationale: "", warnings: [] });
  assert.deepEqual(template.data.sections, ["csat"]);
  assert.equal(applyReportTemplateSemanticValidation({ schemaVersion: 1, name: "X", description: "", sections: ["inventada"], rationale: "", warnings: [] }).valid, false);
});
