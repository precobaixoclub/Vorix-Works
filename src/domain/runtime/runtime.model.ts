import type { ExecutionCapability, PlanningArtifactType, TaskType } from "../planning/planning.model.js";

/**
 * Domínio de Runtime — Sprint 10. Traduz um `Planning` (Sprint 09, `status: "ready"`) num
 * `RuntimePlan` validado — ainda nunca executado. Totalmente independente do pipeline legado
 * (`ExecutionPlan`/Caio/Helena — `src/application/orchestration`, `src/application/workflows`,
 * `src/application/skills`, `src/domain/skills`): nomes, tipos e Ports próprios, zero import
 * cruzado (`scripts/check-runtime-isolation.mjs` garante isso em `architecture:check`). Nunca
 * importa `SkillCapability` — usa sempre `ExecutionCapability`, o vocabulário próprio já
 * introduzido pelo domínio Planning (Sprint 09, decisão 14) e nunca traduzido para o legado nesta
 * sprint (decisão 15 da Sprint 09 segue adiada).
 *
 * Zero dependência de Fastify/Postgres/LLM — puro domínio.
 */

// -------------------------------------------------------------------------------------------
// RuntimePlan — o container
// -------------------------------------------------------------------------------------------

/** Fechado nesta sprint (decisão obrigatória 10/11) — nenhum estado de EXECUÇÃO existe aqui
 * (nada de "running"/"completed"/"failed" de execução real). `draft` é só o instante inicial
 * antes da validação rodar; na prática a tradução é síncrona, então um RuntimePlan persistido
 * nunca fica parado em `draft`/`validating` — só existe para o dia em que a tradução se tornar
 * assíncrona, sem precisar redesenhar o campo. */
export const RUNTIME_STATES = ["draft", "validating", "validated", "validation_failed", "superseded"] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

/**
 * Só os IDENTIFICADORES da origem — nunca as entidades completas (decisão obrigatória 15). É o
 * que de fato é persistido junto do `RuntimePlan` (colunas da própria tabela `runtime_plans`,
 * nunca uma tabela própria — é um value object 1:1, imutável, dono único é o RuntimePlan).
 * Deliberadamente NÃO inclui um identificador de usuário: nem `Conversation`, nem `Briefing`, nem
 * `PreparedCommand`, nem `Planning` guardam quem iniciou a conversa em nenhum campo — inventar um
 * `userId` aqui seria fabricar um dado que não existe em nenhum lugar da cadeia (ver relatório,
 * seção RuntimeContext).
 */
export type RuntimeSourceContext = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  briefingId: string;
  preparedCommandId: string;
  planningId: string;
};

export type RuntimePlan = {
  id: string;
  sourceContext: RuntimeSourceContext;
  status: RuntimeState;
  /** Versão do ESQUEMA do RuntimePlan em si (tabelas/campos) — muda só se a FORMA do runtime
   * mudar, independente de `translatorVersion`. */
  runtimeSchemaVersion: number;
  /** Versão da lógica de tradução (regras do `PlanningExecutionTranslator`). */
  translatorVersion: number;
  /** Estratégia usada — hoje sempre determinística; existe para o dia em que outra estratégia for
   * registrada (mesmo espírito de `Planning.plannerStrategy`). */
  translatorStrategy: string;
  /** Template nomeado e versionado que decidiu QUAIS portas se conectam — nunca a fonte de
   * verdade de QUAIS TIPOS uma porta aceita/produz (decisão obrigatória 22 — isso vem sempre de
   * `TaskInputContract`/`TaskOutputContract`, no próprio `ExecutionTask`). */
  translationTemplate: string;
  /** Fingerprint (sha256, serialização canônica, sem IDs aleatórios/timestamps) da estrutura do
   * `ExecutionGraph` de origem no momento da tradução — permite detectar, no futuro, se o mesmo
   * `planningId` alguma vez produziu grafos diferentes (não deveria, mas fica registrado). */
  sourceGraphFingerprint: string;
  /** Fingerprint da estrutura traduzida (tasks + portas + bindings). Ausente quando a validação
   * falhou — nunca chegou a existir uma tradução válida para ter fingerprint. */
  runtimeFingerprint?: string;
  validationReport: RuntimeValidationReport;
  createdAt: string;
  updatedAt: string;
  supersededAt?: string;
};

// -------------------------------------------------------------------------------------------
// RuntimeTask
// -------------------------------------------------------------------------------------------

/** Único valor alcançável nesta sprint (decisão obrigatória 12) — mesmo padrão de
 * `TaskStatus = ["planned"]` no domínio Planning: enum fechado para a sprint que introduzir
 * execução real só precisar ACRESCENTAR valores. */
export const RUNTIME_TASK_STATUSES = ["prepared"] as const;
export type RuntimeTaskStatus = (typeof RUNTIME_TASK_STATUSES)[number];

export type RuntimeTask = {
  id: string;
  runtimePlanId: string;
  /** FK para o `ExecutionTask` de origem — o Runtime nunca duplica nome/descrição/sequenceHint,
   * só referencia (mesmo princípio de `BriefingFieldValue.aiExecutionId` na Sprint 08: nunca
   * duplicar o que já está registrado em outro agregado). */
  executionTaskId: string;
  type: TaskType;
  capability: ExecutionCapability;
  status: RuntimeTaskStatus;
  createdAt: string;
};

// -------------------------------------------------------------------------------------------
// Portas — RuntimeTaskOutputPort / RuntimeTaskInputPort (projeção 1:1 dos contratos do Planning)
// -------------------------------------------------------------------------------------------

export type RuntimeTaskOutputPort = {
  id: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  portKey: string;
  artifactType: PlanningArtifactType;
  description: string;
  createdAt: string;
};

export type RuntimeTaskInputPort = {
  id: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  portKey: string;
  acceptedArtifactTypes: readonly PlanningArtifactType[];
  required: boolean;
  description: string;
  createdAt: string;
};

// -------------------------------------------------------------------------------------------
// RuntimeBinding — fromOutputPort -> toInputPort (decisão obrigatória 19)
// -------------------------------------------------------------------------------------------

export type RuntimeBinding = {
  id: string;
  runtimePlanId: string;
  fromRuntimeTaskId: string;
  fromOutputPort: string;
  toRuntimeTaskId: string;
  toInputPort: string;
  createdAt: string;
};

// -------------------------------------------------------------------------------------------
// ArtifactSchema / RuntimeArtifact — separados (decisão obrigatória 23)
// -------------------------------------------------------------------------------------------

/** A FORMA esperada de um artefato no nível do Runtime — separado de `ArtifactContract`
 * (Planning, Sprint 09) de propósito: são domínios independentes, e o Runtime nunca deveria
 * precisar importar um tipo do Planning para descrever sua própria expectativa (mesmo que, nesta
 * sprint, o `PlanningExecutionTranslator` só copie os valores 1:1). */
export type ArtifactSchema = {
  artifactType: PlanningArtifactType;
  description: string;
  expectedFields: readonly string[];
};

/** Único valor alcançável nesta sprint (decisão obrigatória 24) — nada é gerado. */
export const RUNTIME_ARTIFACT_STATUSES = ["expected"] as const;
export type RuntimeArtifactStatus = (typeof RUNTIME_ARTIFACT_STATUSES)[number];

export type RuntimeArtifact = {
  id: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  schema: ArtifactSchema;
  status: RuntimeArtifactStatus;
  createdAt: string;
};

// -------------------------------------------------------------------------------------------
// RuntimeValidationReport — próprio, códigos fechados (decisões obrigatórias 25/26/27)
// -------------------------------------------------------------------------------------------

export const RUNTIME_VALIDATION_ISSUE_CODES = [
  /** `Planning.planningTemplate` não tem nenhum `translationTemplate` fechado registrado — mesmo
   * espírito de `no_planning_template_for_type` no domínio Planning (Sprint 09). */
  "no_translation_template_registered",
  /** `fromRuntimeTaskId`/`toRuntimeTaskId` de um binding candidato não corresponde a nenhuma
   * tarefa traduzida. */
  "unknown_source_task",
  "unknown_target_task",
  /** `fromOutputPort`/`toInputPort` não existe no contrato (`outputContract`/`inputContract`) da
   * tarefa referenciada. */
  "unknown_output_port",
  "unknown_input_port",
  /** O tipo de artefato produzido pela porta de saída não está entre os tipos aceitos pela porta
   * de entrada (`TaskInputPort.acceptedArtifactTypes`). */
  "incompatible_artifact_type",
  /** Uma porta de entrada marcada `required: true` não tem nenhum binding que a satisfaça. */
  "missing_required_input",
  /** Mais de um binding aponta para a MESMA porta de entrada — cardinalidade 1:1 nesta sprint. */
  "duplicate_binding",
  /** O template de tradução propôs conectar duas tarefas cujo grafo de origem (`PlanningEdge`)
   * nunca declarou essa dependência — nenhuma dependência pode ser inventada pelo Runtime
   * (decisão obrigatória 28/29). */
  "binding_not_backed_by_planning_edge",
  /** O grafo de bindings resultante contém um ciclo. */
  "cycle_detected",
] as const;
export type RuntimeValidationIssueCode = (typeof RUNTIME_VALIDATION_ISSUE_CODES)[number];

export const RUNTIME_VALIDATION_ISSUE_SEVERITIES = ["error", "warning"] as const;
export type RuntimeValidationIssueSeverity = (typeof RUNTIME_VALIDATION_ISSUE_SEVERITIES)[number];

export type RuntimeValidationIssue = {
  code: RuntimeValidationIssueCode;
  message: string;
  /** Referência textual e estável (nunca um ID gerado) para localizar o problema — ex.:
   * "approval.copy" (taskType.portKey) ou "research->campaign_structure" (par de tarefas). */
  field?: string;
  severity: RuntimeValidationIssueSeverity;
};

/** Roda ANTES de qualquer coisa ser persistida além do próprio `RuntimePlan` (mesmo espírito do
 * `ValidationReport` do Planning, Sprint 09) — só `error` bloqueia (`valid: false`); nesta sprint,
 * todo código de issue listado acima é sempre `error` (o template fechado de `campaign_creation`
 * não tem nenhum caso de aviso não-bloqueante ainda — o campo existe fechado para quando houver). */
export type RuntimeValidationReport = {
  valid: boolean;
  issues: readonly RuntimeValidationIssue[];
  validatedAt: string;
};
