/** Espelha `src/domain/planning/planning.model.ts` e `src/application/planning/planning-use-cases.ts`
 * (backend, Sprint 09). Só leitura — este domínio não tem nenhum verbo de escrita no frontend, só
 * os três GETs de `features/planning/api.ts`. */

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
  preparedCommandRevision: number;
  status: PlanningStatus;
  plannerVersion: number;
  plannerStrategy: string;
  planningTemplate: string;
  graphVersion: number;
  graphType: GraphType;
  validationReport: ValidationReport;
  createdAt: string;
  updatedAt: string;
  supersededAt?: string;
};

export const EXECUTION_CAPABILITIES = ["editorial_research", "strategic_planning", "copywriting", "visual_design", "human_review", "distribution", "content_brief"] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

export const TASK_TYPES = ["research", "campaign_structure", "copy_generation", "visual_generation", "approval", "publication", "content_brief"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["planned"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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
  /** Só sugestão visual — nunca usado para decidir ordem. A ordem de verdade vem do DAG
   * (`computeLayeredLayout`, derivado das arestas de `ExecutionGraph`). */
  sequenceHint: number;
  inputContract: TaskInputContract;
  outputContract: TaskOutputContract;
  createdAt: string;
};

/** Nunca carrega posição/x/y — layout é sempre calculado no cliente (`layout.ts`), nunca
 * persistido no backend (decisão obrigatória da Sprint 09). */
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

export type ExecutionGraph = {
  planningId: string;
  graphVersion: number;
  graphType: GraphType;
  nodes: readonly PlanningNode[];
  edges: readonly PlanningEdge[];
};

export const PLANNING_ARTIFACT_TYPES = ["text", "image", "video", "carousel", "document"] as const;
export type PlanningArtifactType = (typeof PLANNING_ARTIFACT_TYPES)[number];

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

export type PlanningDecision = {
  id: string;
  planningId: string;
  decisionCode: string;
  reason: string;
  relatedTaskIds: readonly string[];
  createdAt: string;
};

export type PlanningWithGraph = { planning: Planning; graph: ExecutionGraph; decisions: readonly PlanningDecision[] };
export type PlanningTasks = { tasks: readonly ExecutionTask[]; artifacts: readonly PlanningArtifact[] };
