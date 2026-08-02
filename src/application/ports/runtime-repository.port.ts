import type {
  RuntimeArtifact,
  RuntimeBinding,
  RuntimePlan,
  RuntimeSourceContext,
  RuntimeState,
  RuntimeTask,
  RuntimeTaskInputPort,
  RuntimeTaskOutputPort,
  RuntimeValidationIssue,
  RuntimeValidationReport,
} from "../../domain/runtime/runtime.model.js";

export type CreateRuntimePlanInput = {
  id: string;
  sourceContext: RuntimeSourceContext;
  status: RuntimeState;
  runtimeSchemaVersion: number;
  translatorVersion: number;
  translatorStrategy: string;
  translationTemplate: string;
  sourceGraphFingerprint: string;
  runtimeFingerprint?: string;
  validationReport: RuntimeValidationReport;
};

export type CreateRuntimeTaskInput = Omit<RuntimeTask, "createdAt">;
export type CreateRuntimeTaskOutputPortInput = Omit<RuntimeTaskOutputPort, "createdAt">;
export type CreateRuntimeTaskInputPortInput = Omit<RuntimeTaskInputPort, "createdAt">;
export type CreateRuntimeBindingInput = Omit<RuntimeBinding, "createdAt">;
export type CreateRuntimeArtifactInput = Omit<RuntimeArtifact, "createdAt">;

export type PersistRuntimeTranslationInput = {
  plan: CreateRuntimePlanInput;
  tasks: readonly CreateRuntimeTaskInput[];
  outputs: readonly CreateRuntimeTaskOutputPortInput[];
  inputs: readonly CreateRuntimeTaskInputPortInput[];
  bindings: readonly CreateRuntimeBindingInput[];
  artifacts: readonly CreateRuntimeArtifactInput[];
  /** Registrado nos dois caminhos (validado ou não) — auditoria: mesmo um RuntimePlan "validated"
   * fica com o relatório completo (mesmo que vazio) de como chegou lá. */
  issues: readonly RuntimeValidationIssue[];
};

export type RuntimeDetails = {
  tasks: readonly RuntimeTask[];
  inputs: readonly RuntimeTaskInputPort[];
  outputs: readonly RuntimeTaskOutputPort[];
  bindings: readonly RuntimeBinding[];
  artifacts: readonly RuntimeArtifact[];
  issues: readonly RuntimeValidationIssue[];
};

export type ListRuntimeFilter = { tenantId: string; workspaceId: string; planningId?: string };

/**
 * Único Port para todo o agregado de Runtime (`runtime_plans` + 6 tabelas filhas) — Sprint 10.
 * `persist` é sempre transacional (decisão obrigatória 30): ou o `RuntimePlan` "validated" +
 * TODOS os filhos são gravados, ou só o `RuntimePlan` "validation_failed" + `issues` são gravados
 * — nunca uma mistura parcial (decisão 31/32). Mesmo padrão do `saveGraph` transacional do domínio
 * Planning (Sprint 09), escalado para o agregado inteiro.
 */
export type RuntimeRepositoryPort = {
  persist(input: PersistRuntimeTranslationInput): Promise<RuntimePlan>;
  getById(id: string): Promise<RuntimePlan | undefined>;
  /** Unicidade lógica (decisão obrigatória 7) — um `Planning` nunca produz mais de um RuntimePlan. */
  getByPlanningId(planningId: string): Promise<RuntimePlan | undefined>;
  getDetails(runtimePlanId: string): Promise<RuntimeDetails>;
  /** Só usada para a transição terminal validated|validation_failed -> superseded (decisão 9) — um
   * RuntimePlan validado nunca é reescrito por nenhum outro caminho (decisão obrigatória 13). */
  updateStatus(id: string, status: RuntimeState): Promise<RuntimePlan>;
  listByWorkspace(filter: ListRuntimeFilter): Promise<RuntimePlan[]>;
};
