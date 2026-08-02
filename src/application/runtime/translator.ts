import type { Planning, PlanningArtifact, ExecutionTask } from "../../domain/planning/planning.model.js";
import type { RuntimeArtifact, RuntimeTask, RuntimeTaskInputPort, RuntimeTaskOutputPort } from "../../domain/runtime/runtime.model.js";
import { getTranslationTemplate, type TranslationBindingSpec } from "./translation-template.js";

/**
 * `PlanningExecutionTranslator` — Sprint 10 (Fase 3). Recebe um `Planning` (sempre `status:
 * "ready"` — quem chama já garantiu isso) + suas `ExecutionTask[]`/`PlanningArtifact[]`, produz um
 * `RuntimeTranslationCandidate` — NUNCA executa nada, e o resultado ainda não é a verdade final:
 * só depois de `validateRuntimeTranslation` (`validation.ts`) aprovar é que vira um `RuntimePlan`
 * "validated" de verdade. `undefined` quando `planning.planningTemplate` não tem tradução
 * registrada — quem chama transforma isso no issue `no_translation_template_registered`.
 *
 * `RuntimeBindingCandidate` é deliberadamente mais permissivo que `RuntimeBinding` (o tipo final,
 * persistido): `fromRuntimeTaskId`/`toRuntimeTaskId` podem não resolver (o template referenciou um
 * `TaskType` que este Planning não produziu) — é papel da validação, não do tradutor, decidir se
 * isso é um erro (`unknown_source_task`/`unknown_target_task`).
 */
export type RuntimeBindingCandidate = {
  id: string;
  runtimePlanId: string;
  fromTaskType: TranslationBindingSpec["fromTaskType"];
  fromOutputPort: string;
  toTaskType: TranslationBindingSpec["toTaskType"];
  toInputPort: string;
  fromRuntimeTaskId: string | undefined;
  toRuntimeTaskId: string | undefined;
};

export type RuntimeTranslationCandidate = {
  translationTemplate: string;
  tasks: readonly RuntimeTask[];
  inputPorts: readonly RuntimeTaskInputPort[];
  outputPorts: readonly RuntimeTaskOutputPort[];
  bindings: readonly RuntimeBindingCandidate[];
  artifacts: readonly RuntimeArtifact[];
};

export type PlanningExecutionTranslatorDeps = {
  idGenerator: () => string;
  now?: () => Date;
};

export function translatePlanningToRuntime(
  planning: Planning,
  executionTasks: readonly ExecutionTask[],
  planningArtifacts: readonly PlanningArtifact[],
  runtimePlanId: string,
  deps: PlanningExecutionTranslatorDeps,
): RuntimeTranslationCandidate | undefined {
  const template = getTranslationTemplate(planning.planningTemplate);
  if (!template) return undefined;

  const now = deps.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const nextId = deps.idGenerator;

  const runtimeTaskIdByExecutionTaskId = new Map(executionTasks.map((task) => [task.id, nextId()]));
  const runtimeTaskIdByType = new Map(executionTasks.map((task) => [task.type, runtimeTaskIdByExecutionTaskId.get(task.id) as string]));

  const tasks: RuntimeTask[] = executionTasks.map((task) => ({
    id: runtimeTaskIdByExecutionTaskId.get(task.id) as string,
    runtimePlanId,
    executionTaskId: task.id,
    type: task.type,
    capability: task.capability,
    status: "prepared",
    createdAt,
  }));

  const outputPorts: RuntimeTaskOutputPort[] = executionTasks.flatMap((task) =>
    task.outputContract.ports.map((port) => ({
      id: nextId(),
      runtimePlanId,
      runtimeTaskId: runtimeTaskIdByExecutionTaskId.get(task.id) as string,
      portKey: port.portKey,
      artifactType: port.artifactType,
      description: port.description,
      createdAt,
    })),
  );

  const inputPorts: RuntimeTaskInputPort[] = executionTasks.flatMap((task) =>
    task.inputContract.ports.map((port) => ({
      id: nextId(),
      runtimePlanId,
      runtimeTaskId: runtimeTaskIdByExecutionTaskId.get(task.id) as string,
      portKey: port.portKey,
      acceptedArtifactTypes: port.acceptedArtifactTypes,
      required: port.required,
      description: port.description,
      createdAt,
    })),
  );

  const bindings: RuntimeBindingCandidate[] = template.map((spec) => ({
    id: nextId(),
    runtimePlanId,
    fromTaskType: spec.fromTaskType,
    fromOutputPort: spec.fromOutputPort,
    toTaskType: spec.toTaskType,
    toInputPort: spec.toInputPort,
    fromRuntimeTaskId: runtimeTaskIdByType.get(spec.fromTaskType),
    toRuntimeTaskId: runtimeTaskIdByType.get(spec.toTaskType),
  }));

  const artifacts: RuntimeArtifact[] = planningArtifacts.map((artifact) => ({
    id: nextId(),
    runtimePlanId,
    runtimeTaskId: runtimeTaskIdByExecutionTaskId.get(artifact.executionTaskId) as string,
    schema: { artifactType: artifact.contract.expectedType, description: artifact.contract.description, expectedFields: artifact.contract.expectedFields },
    status: "expected",
    createdAt,
  }));

  return { translationTemplate: planning.planningTemplate, tasks, inputPorts, outputPorts, bindings, artifacts };
}
