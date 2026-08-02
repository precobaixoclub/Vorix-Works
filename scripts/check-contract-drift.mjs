import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Guarda de contrato compartilhado — Sprint 07 (Fase 15). O backend (`src/`) e o frontend
 * (`web/`) NÃO compartilham um pacote de tipos (decisão explícita desta sprint: não transformar o
 * projeto num monorepo agora — ver relatório final, seção de estratégia de contratos). Isto
 * significa que `web/features/briefing/types.ts` e `web/features/conversation/types.ts` são
 * cópias manuais dos tipos de domínio do backend, e podem divergir silenciosamente a qualquer
 * edição futura. Este script é a rede de segurança até a migração para `packages/contracts`.
 *
 * Compara REPRESENTAÇÕES CANÔNICAS, não texto bruto: usa o compilador TypeScript (`ts.createSourceFile`)
 * para extrair, de cada lado, ou (a) os valores literais de um array `as const` (para tipos union
 * derivados de enum), ou (b) o conjunto ordenado de nomes de propriedade + flag de opcionalidade de
 * um `type` objeto — nunca um diff textual linha a linha, que quebraria com qualquer reformatação
 * inofensiva (quebra de linha, ordem de import, etc.).
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACTS = [
  { name: "BriefingType", backend: "src/domain/briefing/briefing.model.ts", frontend: "web/features/briefing/types.ts", symbol: "BRIEFING_TYPES", kind: "values" },
  { name: "BriefingStatus", backend: "src/domain/briefing/briefing.model.ts", frontend: "web/features/briefing/types.ts", symbol: "BRIEFING_STATUSES", kind: "values" },
  { name: "BriefingSource", backend: "src/domain/briefing/briefing.model.ts", frontend: "web/features/briefing/types.ts", symbol: "BRIEFING_SOURCES", kind: "values" },
  { name: "BriefingAnswerType", backend: "src/domain/briefing/briefing.model.ts", frontend: "web/features/briefing/types.ts", symbol: "BRIEFING_ANSWER_TYPES", kind: "values" },
  { name: "PreparedCommandStatus", backend: "src/domain/briefing/briefing.model.ts", frontend: "web/features/briefing/types.ts", symbol: "PREPARED_COMMAND_STATUSES", kind: "values" },
  { name: "ConversationState", backend: "src/domain/conversation/conversation.model.ts", frontend: "web/features/conversation/types.ts", symbol: "CONVERSATION_STATES", kind: "values" },
  { name: "BriefingReadiness", backend: "src/domain/briefing/briefing.model.ts", frontend: "web/features/briefing/types.ts", symbol: "BriefingReadiness", kind: "shape" },
  {
    name: "BriefingQuestionDto",
    backend: "src/application/briefing/dto.ts",
    frontend: "web/features/briefing/types.ts",
    symbol: "BriefingQuestionDto",
    kind: "shape",
  },
  {
    name: "BriefingSummaryDto",
    backend: "src/application/briefing/dto.ts",
    frontend: "web/features/briefing/types.ts",
    symbol: "BriefingSummaryDto",
    kind: "shape",
  },
  {
    name: "PreparedCommandSummaryDto",
    backend: "src/application/briefing/dto.ts",
    frontend: "web/features/briefing/types.ts",
    symbol: "PreparedCommandSummaryDto",
    kind: "shape",
  },
  // Sprint 09 — domínio Planning (`src/domain/planning/planning.model.ts` vs `web/features/planning/types.ts`).
  { name: "PlanningStatus", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "PLANNING_STATUSES", kind: "values" },
  { name: "GraphType", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "GRAPH_TYPES", kind: "values" },
  {
    name: "ValidationIssueSeverity",
    backend: "src/domain/planning/planning.model.ts",
    frontend: "web/features/planning/types.ts",
    symbol: "VALIDATION_ISSUE_SEVERITIES",
    kind: "values",
  },
  {
    name: "ExecutionCapability",
    backend: "src/domain/planning/planning.model.ts",
    frontend: "web/features/planning/types.ts",
    symbol: "EXECUTION_CAPABILITIES",
    kind: "values",
  },
  { name: "TaskType", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "TASK_TYPES", kind: "values" },
  { name: "TaskStatus", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "TASK_STATUSES", kind: "values" },
  {
    name: "PlanningEdgeKind",
    backend: "src/domain/planning/planning.model.ts",
    frontend: "web/features/planning/types.ts",
    symbol: "PLANNING_EDGE_KINDS",
    kind: "values",
  },
  {
    name: "PlanningArtifactType",
    backend: "src/domain/planning/planning.model.ts",
    frontend: "web/features/planning/types.ts",
    symbol: "PLANNING_ARTIFACT_TYPES",
    kind: "values",
  },
  {
    name: "PlanningArtifactStatus",
    backend: "src/domain/planning/planning.model.ts",
    frontend: "web/features/planning/types.ts",
    symbol: "PLANNING_ARTIFACT_STATUSES",
    kind: "values",
  },
  { name: "ValidationReport", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "ValidationReport", kind: "shape" },
  { name: "Planning", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "Planning", kind: "shape" },
  { name: "ExecutionTask", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "ExecutionTask", kind: "shape" },
  { name: "TaskOutputPort", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "TaskOutputPort", kind: "shape" },
  { name: "TaskOutputContract", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "TaskOutputContract", kind: "shape" },
  { name: "TaskInputPort", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "TaskInputPort", kind: "shape" },
  { name: "TaskInputContract", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "TaskInputContract", kind: "shape" },
  { name: "PlanningNode", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "PlanningNode", kind: "shape" },
  { name: "PlanningEdge", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "PlanningEdge", kind: "shape" },
  { name: "ExecutionGraph", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "ExecutionGraph", kind: "shape" },
  { name: "ArtifactContract", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "ArtifactContract", kind: "shape" },
  { name: "PlanningArtifact", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "PlanningArtifact", kind: "shape" },
  { name: "PlanningDecision", backend: "src/domain/planning/planning.model.ts", frontend: "web/features/planning/types.ts", symbol: "PlanningDecision", kind: "shape" },
  // Sprint 10 — domínio Runtime (`src/domain/runtime/runtime.model.ts` vs `web/features/runtime/types.ts`).
  { name: "RuntimeState", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RUNTIME_STATES", kind: "values" },
  {
    name: "RuntimeValidationIssueSeverity",
    backend: "src/domain/runtime/runtime.model.ts",
    frontend: "web/features/runtime/types.ts",
    symbol: "RUNTIME_VALIDATION_ISSUE_SEVERITIES",
    kind: "values",
  },
  { name: "RuntimeTaskStatus", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RUNTIME_TASK_STATUSES", kind: "values" },
  { name: "RuntimeArtifactStatus", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RUNTIME_ARTIFACT_STATUSES", kind: "values" },
  { name: "RuntimeSourceContext", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeSourceContext", kind: "shape" },
  { name: "RuntimeValidationIssue", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeValidationIssue", kind: "shape" },
  { name: "RuntimeValidationReport", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeValidationReport", kind: "shape" },
  { name: "RuntimePlan", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimePlan", kind: "shape" },
  { name: "RuntimeTask", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeTask", kind: "shape" },
  { name: "RuntimeTaskOutputPort", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeTaskOutputPort", kind: "shape" },
  { name: "RuntimeTaskInputPort", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeTaskInputPort", kind: "shape" },
  { name: "RuntimeBinding", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeBinding", kind: "shape" },
  { name: "ArtifactSchema", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "ArtifactSchema", kind: "shape" },
  { name: "RuntimeArtifact", backend: "src/domain/runtime/runtime.model.ts", frontend: "web/features/runtime/types.ts", symbol: "RuntimeArtifact", kind: "shape" },
  {
    name: "RuntimeContext",
    backend: "src/application/runtime/runtime-use-cases.ts",
    frontend: "web/features/runtime/types.ts",
    symbol: "RuntimeContext",
    kind: "shape",
  },
  {
    name: "RuntimeDetail",
    backend: "src/application/runtime/runtime-use-cases.ts",
    frontend: "web/features/runtime/types.ts",
    symbol: "RuntimeDetail",
    kind: "shape",
  },
  {
    name: "RuntimeBindingsView",
    backend: "src/application/runtime/runtime-use-cases.ts",
    frontend: "web/features/runtime/types.ts",
    symbol: "RuntimeBindingsView",
    kind: "shape",
  },
];

function parseSourceFile(relativePath) {
  const filePath = resolve(projectRoot, relativePath);
  const text = readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
}

/** Desembrulha `expr as const` / `expr satisfies X` para chegar no ArrayLiteralExpression real. */
function unwrapExpression(node) {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function extractValuesArray(sourceFile, symbolName) {
  let result;
  sourceFile.forEachChild((node) => {
    if (result || !ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== symbolName || !decl.initializer) continue;
      const expr = unwrapExpression(decl.initializer);
      if (!ts.isArrayLiteralExpression(expr)) continue;
      result = expr.elements
        .filter((el) => ts.isStringLiteralLike(el))
        .map((el) => el.text)
        .sort();
    }
  });
  return result;
}

function extractShape(sourceFile, symbolName) {
  let result;
  sourceFile.forEachChild((node) => {
    if (result || !ts.isTypeAliasDeclaration(node) || node.name.text !== symbolName) return;
    if (!ts.isTypeLiteralNode(node.type)) return;
    result = node.type.members
      .filter((member) => member.name && ts.isIdentifier(member.name))
      .map((member) => `${member.name.text}${member.questionToken ? "?" : ""}`)
      .sort();
  });
  return result;
}

function extractContract(relativePath, symbolName, kind) {
  const sourceFile = parseSourceFile(relativePath);
  return kind === "values" ? extractValuesArray(sourceFile, symbolName) : extractShape(sourceFile, symbolName);
}

function main() {
  const failures = [];

  for (const contract of CONTRACTS) {
    const backendData = extractContract(contract.backend, contract.symbol, contract.kind);
    const frontendData = extractContract(contract.frontend, contract.symbol, contract.kind);

    if (!backendData) {
      failures.push(`${contract.name}: não encontrado em ${contract.backend} (símbolo "${contract.symbol}") — script desatualizado ou símbolo renomeado.`);
      continue;
    }
    if (!frontendData) {
      failures.push(`${contract.name}: não encontrado em ${contract.frontend} (símbolo "${contract.symbol}") — script desatualizado ou símbolo renomeado.`);
      continue;
    }

    const backendJson = JSON.stringify(backendData);
    const frontendJson = JSON.stringify(frontendData);
    if (backendJson !== frontendJson) {
      failures.push(
        `${contract.name}: divergência entre backend (${contract.backend}) e frontend (${contract.frontend}).\n` +
          `    backend:  ${backendJson}\n` +
          `    frontend: ${frontendJson}`,
      );
      continue;
    }

    console.log(`[check-contract-drift] OK — ${contract.name} (${backendData.length} ${contract.kind === "values" ? "valor(es)" : "campo(s)"})`);
  }

  if (failures.length > 0) {
    console.error("\n[check-contract-drift] Divergências encontradas:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[check-contract-drift] ${CONTRACTS.length} contrato(s) verificados — backend e frontend consistentes.`);
}

main();
