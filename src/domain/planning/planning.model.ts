/**
 * Domínio de Planning — Sprint 09. Transforma um `PreparedCommand` (Sprint 07, nunca executado)
 * num plano operacional estruturado — ainda nunca executado. Totalmente independente do
 * `ExecutionPlan` legado (`src/application/orchestration/execution-plan.contract.ts`): nomes,
 * tipos e Ports próprios, zero import cruzado (`scripts/check-planning-isolation.mjs` garante
 * isso em `architecture:check`). Ver `src/application/planning/README.md` para o raciocínio
 * completo da separação.
 *
 * Este domínio NUNCA importa nada de `src/domain/skills`, `src/application/orchestration`,
 * `src/application/workflows` — inclusive `ExecutionCapability` abaixo é um enum PRÓPRIO,
 * deliberadamente parecido em espírito com `SkillCapability` mas nunca o mesmo tipo (decisão
 * obrigatória da Sprint 09: nunca depender de `SkillCapability` diretamente; a tradução
 * `ExecutionCapability → SkillCapability` fica para uma sprint futura, no dia em que execução
 * real for decidida). Por isso também nenhum nome de especialista (Maria, Sofia, Pedro...)
 * aparece em lugar nenhum deste domínio — só capabilities genéricas.
 *
 * Zero dependência de Fastify/Postgres/LLM — puro domínio.
 */

// -------------------------------------------------------------------------------------------
// Planning — o container
// -------------------------------------------------------------------------------------------

export const PLANNING_STATUSES = ["draft", "ready", "failed", "superseded"] as const;
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];

export const GRAPH_TYPES = ["dag"] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];

export const VALIDATION_ISSUE_SEVERITIES = ["error", "warning"] as const;
export type ValidationIssueSeverity = (typeof VALIDATION_ISSUE_SEVERITIES)[number];

export type ValidationIssue = {
  code: string;
  message: string;
  field?: string;
  severity: ValidationIssueSeverity;
};

/**
 * Produzido ANTES do Planning Engine tentar montar qualquer grafo (decisão obrigatória) — um
 * `PreparedCommand` que não passa aqui nunca gera nós/arestas/tarefas, só um `Planning` com
 * `status: "failed"` carregando o relatório. `valid` é `true` mesmo com `warning`s — só `error`
 * bloqueia.
 */
export type ValidationReport = {
  valid: boolean;
  issues: readonly ValidationIssue[];
  validatedAt: string;
};

export type Planning = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  briefingId: string;
  preparedCommandId: string;
  /** Cópia de `PreparedCommand.briefingRevision` no momento da criação — junto com
   * `preparedCommandId`, garante a unicidade lógica exigida (índice único no banco). */
  preparedCommandRevision: number;
  status: PlanningStatus;
  /** Versão da lógica de decisão do Arthur Planner (regras, não o template de tarefas em si). */
  plannerVersion: number;
  /** Código da estratégia usada — hoje sempre determinística; existe para o dia em que outra
   * estratégia (assistida por IA, por exemplo) for registrada. */
  plannerStrategy: string;
  /** Template nomeado e versionado que decompôs este `PreparedCommand.type` em tarefas — mesmo
   * espírito de `BriefingSchema.version` (Sprint 07). */
  planningTemplate: string;
  /** Versão do ESQUEMA do grafo (nós/arestas) — distinta de `plannerVersion`: pode mudar mesmo
   * sem nenhuma regra de planejamento mudar. */
  graphVersion: number;
  graphType: GraphType;
  validationReport: ValidationReport;
  createdAt: string;
  updatedAt: string;
  supersededAt?: string;
};

// -------------------------------------------------------------------------------------------
// ExecutionCapability — vocabulário PRÓPRIO do Planning, nunca SkillCapability
// -------------------------------------------------------------------------------------------

/** "content_brief" acrescentado nesta sprint (decisão aditiva, mesmo espírito documentado acima) —
 * empacota `PreparedCommand.validatedInputs` num artefato "structure" sem chamar nenhuma Skill,
 * usado só pelo template reduzido `content_request-visual-only-v1` (ver `arthur-planner.ts`), que
 * gera uma peça visual sem nenhuma etapa de pesquisa/estratégia/copy/publicação. */
export const EXECUTION_CAPABILITIES = ["editorial_research", "strategic_planning", "copywriting", "visual_design", "human_review", "distribution", "content_brief"] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

// -------------------------------------------------------------------------------------------
// ExecutionTask
// -------------------------------------------------------------------------------------------

export const TASK_TYPES = ["research", "campaign_structure", "copy_generation", "visual_generation", "approval", "publication", "content_brief"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** Único valor alcançável nesta sprint — nada é executado, então nenhuma tarefa nunca sai de
 * "planned". O enum existe fechado (em vez de um `boolean`) para a sprint que introduzir execução
 * real só precisar ACRESCENTAR valores, nunca redesenhar o campo. */
export const TASK_STATUSES = ["planned"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Contratos explícitos de entrada/saída — Sprint 10 (decisão obrigatória 16/17). Cada
 * `ExecutionTask` declara, por "porta" nomeada (`portKey`), o que produz e o que espera consumir.
 * Versionado (`version`) pelo mesmo motivo de `BriefingSchema.version`/`Planning.planningTemplate`:
 * o dia em que a forma de uma porta mudar, o número muda — nunca uma mudança silenciosa. Este é o
 * ÚNICO lugar que define a FORMA de uma porta; o `translationTemplate` do Runtime (Sprint 10) só
 * decide QUAIS portas se conectam, nunca redefine o que uma porta aceita ou produz (decisão 22).
 */
export type TaskOutputPort = {
  portKey: string;
  artifactType: PlanningArtifactType;
  description: string;
};

export type TaskOutputContract = {
  version: number;
  ports: readonly TaskOutputPort[];
};

export type TaskInputPort = {
  portKey: string;
  /** Uma porta pode aceitar mais de um tipo de artefato compatível (ex.: peça visual pode ser
   * imagem, vídeo ou carrossel) — a checagem de compatibilidade nunca é um único tipo fixo. */
  acceptedArtifactTypes: readonly PlanningArtifactType[];
  required: boolean;
  description: string;
};

export type TaskInputContract = {
  version: number;
  ports: readonly TaskInputPort[];
};

export type ExecutionTask = {
  id: string;
  planningId: string;
  type: TaskType;
  name: string;
  description: string;
  capability: ExecutionCapability;
  expectedArtifactType: PlanningArtifactType;
  status: TaskStatus;
  /** SÓ sugestão visual (decisão obrigatória) — a ordem lógica de verdade vem sempre do DAG
   * (`topologicalSort`, `graph-projection.ts`), nunca deste campo. Nenhuma regra de negócio pode
   * ler `sequenceHint` para decidir precedência. */
  sequenceHint: number;
  inputContract: TaskInputContract;
  outputContract: TaskOutputContract;
  createdAt: string;
};

// -------------------------------------------------------------------------------------------
// Grafo — PlanningNode/PlanningEdge são persistidos; ExecutionGraph é um tipo COMPOSTO,
// reconstruído por projeção, NUNCA um Aggregate Root nem uma tabela própria.
// -------------------------------------------------------------------------------------------

/** Nunca carrega dado de layout visual (posição, x/y, cor...) — isso é responsabilidade só do
 * frontend, calculado a partir da estrutura (`nodes`+`edges`), nunca persistido. */
export type PlanningNode = {
  id: string;
  planningId: string;
  executionTaskId: string;
  label: string;
  createdAt: string;
};

export const PLANNING_EDGE_KINDS = ["depends_on"] as const;
export type PlanningEdgeKind = (typeof PLANNING_EDGE_KINDS)[number];

export type PlanningEdge = {
  id: string;
  planningId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: PlanningEdgeKind;
  createdAt: string;
};

/** Tipo composto — nunca persistido como tal (nem tabela `execution_graphs`, nem Aggregate Root
 * próprio). Sempre reconstruído por projeção a partir de `PlanningNode[]`/`PlanningEdge[]` já
 * persistidos (`projectExecutionGraph`, `graph-projection.ts`). */
export type ExecutionGraph = {
  planningId: string;
  graphVersion: number;
  graphType: GraphType;
  nodes: readonly PlanningNode[];
  edges: readonly PlanningEdge[];
};

// -------------------------------------------------------------------------------------------
// PlanningArtifact / ArtifactContract
// -------------------------------------------------------------------------------------------

export const PLANNING_ARTIFACT_TYPES = ["text", "image", "video", "carousel", "document"] as const;
export type PlanningArtifactType = (typeof PLANNING_ARTIFACT_TYPES)[number];

/** Descreve a FORMA esperada de um artefato — nunca o artefato em si (nada é gerado nesta
 * sprint). `expectedFields` é descritivo (nomes de campo esperados), não um JSON Schema completo
 * — não há nada real para validar contra ainda. */
export type ArtifactContract = {
  expectedType: PlanningArtifactType;
  description: string;
  expectedFields: readonly string[];
};

export const PLANNING_ARTIFACT_STATUSES = ["expected"] as const;
export type PlanningArtifactStatus = (typeof PLANNING_ARTIFACT_STATUSES)[number];

export type PlanningArtifact = {
  id: string;
  planningId: string;
  executionTaskId: string;
  contract: ArtifactContract;
  status: PlanningArtifactStatus;
  createdAt: string;
};

// -------------------------------------------------------------------------------------------
// PlanningDecision — trilha de explicabilidade do Arthur Planner
// -------------------------------------------------------------------------------------------

export type PlanningDecision = {
  id: string;
  planningId: string;
  decisionCode: string;
  reason: string;
  relatedTaskIds: readonly string[];
  createdAt: string;
};
