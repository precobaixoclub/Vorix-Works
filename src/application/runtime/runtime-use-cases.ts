import type { Planning } from "../../domain/planning/planning.model.js";
import type {
  RuntimeArtifact,
  RuntimeBinding,
  RuntimePlan,
  RuntimeSourceContext,
  RuntimeState,
  RuntimeTask,
  RuntimeTaskInputPort,
  RuntimeTaskOutputPort,
  RuntimeValidationReport,
} from "../../domain/runtime/runtime.model.js";
import type { PlanningRepositoryPort } from "../ports/planning-repository.port.js";
import type { RuntimeRepositoryPort } from "../ports/runtime-repository.port.js";

/**
 * Casos de uso de Runtime — Sprint 10 (Fase 6). SÓ LEITURA (decisão obrigatória 36) — nenhum caso
 * de uso aqui cria, atualiza ou executa nada (a única escrita, `ensureRuntimeForPlanning`, vive em
 * `runtime-engine.ts` e só é chamada internamente pelo hook do Planning). Mesmo padrão de
 * `planning-use-cases.ts`: `tenantId`/`workspaceId` sempre vêm de fora.
 */
export type RuntimeUseCaseDeps = {
  runtimeRepository: RuntimeRepositoryPort;
  planningRepository: PlanningRepositoryPort;
};

async function mustBelongToTenantAndWorkspace(repository: RuntimeRepositoryPort, id: string, tenantId: string, workspaceId: string): Promise<RuntimePlan> {
  const runtimePlan = await repository.getById(id);
  if (!runtimePlan || runtimePlan.sourceContext.tenantId !== tenantId || runtimePlan.sourceContext.workspaceId !== workspaceId) {
    throw new Error(`RUNTIME_NOT_FOUND: runtime "${id}" não existe.`);
  }
  return runtimePlan;
}

export type ListRuntimeInput = { tenantId: string; workspaceId: string; planningId?: string };

export async function listRuntime(deps: RuntimeUseCaseDeps, input: ListRuntimeInput): Promise<RuntimePlan[]> {
  return deps.runtimeRepository.listByWorkspace(input);
}

export type GetRuntimeInput = { tenantId: string; workspaceId: string; id: string };

/**
 * `RuntimeContext` — o composto CHEIO pedido pela Fase 5, distinto de `RuntimeSourceContext`
 * (decisão obrigatória 14): resolve o `Planning` de origem por inteiro (o Runtime já depende do
 * Planning para traduzir, então resolvê-lo de novo aqui não introduz nenhum acoplamento novo).
 * Nunca persistido — projetado a cada leitura, mesmo espírito de `ExecutionGraph` (Sprint 09).
 *
 * Deliberadamente NÃO resolve `Conversation`/`Briefing`/`PreparedCommand` por inteiro nem inclui
 * um campo de usuário: Runtime não tem (e não precisa ganhar nesta sprint) Ports para os
 * repositórios de Conversation/Briefing/PreparedCommand, e nenhum identificador de usuário existe
 * em NENHUM ponto da cadeia (`Conversation`/`Briefing`/`PreparedCommand`/`Planning` — nenhum deles
 * guarda quem iniciou a conversa). `sourceContext` já carrega os IDs de todos esses; inventar
 * objetos completos ou um `userId` fantasma violaria o mesmo princípio da decisão 29 (nunca
 * inventar o que não existe).
 */
export type RuntimeContext = {
  sourceContext: RuntimeSourceContext;
  planning: Planning;
  runtimePlanId: string;
  runtimeStatus: RuntimeState;
};

export type RuntimeDetail = {
  runtimePlan: RuntimePlan;
  sourceContext: RuntimeSourceContext;
  validationReport: RuntimeValidationReport;
  tasks: readonly RuntimeTask[];
  artifacts: readonly RuntimeArtifact[];
  context: RuntimeContext;
};

export async function getRuntimeDetail(deps: RuntimeUseCaseDeps, input: GetRuntimeInput): Promise<RuntimeDetail> {
  const runtimePlan = await mustBelongToTenantAndWorkspace(deps.runtimeRepository, input.id, input.tenantId, input.workspaceId);
  const details = await deps.runtimeRepository.getDetails(runtimePlan.id);
  const planning = await deps.planningRepository.getById(runtimePlan.sourceContext.planningId);
  if (!planning) throw new Error(`RUNTIME_SOURCE_PLANNING_NOT_FOUND: planning "${runtimePlan.sourceContext.planningId}" não existe mais.`);

  return {
    runtimePlan,
    sourceContext: runtimePlan.sourceContext,
    validationReport: runtimePlan.validationReport,
    tasks: details.tasks,
    artifacts: details.artifacts,
    context: {
      sourceContext: runtimePlan.sourceContext,
      planning,
      runtimePlanId: runtimePlan.id,
      runtimeStatus: runtimePlan.status,
    },
  };
}

export type RuntimeBindingsView = {
  bindings: readonly RuntimeBinding[];
  inputs: readonly RuntimeTaskInputPort[];
  outputs: readonly RuntimeTaskOutputPort[];
};

export async function getRuntimeBindings(deps: RuntimeUseCaseDeps, input: GetRuntimeInput): Promise<RuntimeBindingsView> {
  const runtimePlan = await mustBelongToTenantAndWorkspace(deps.runtimeRepository, input.id, input.tenantId, input.workspaceId);
  const details = await deps.runtimeRepository.getDetails(runtimePlan.id);
  return { bindings: details.bindings, inputs: details.inputs, outputs: details.outputs };
}
