import type { Planning, PlanningStatus, ValidationReport } from "../../domain/planning/planning.model.js";

export type CreatePlanningInput = {
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
  graphType: Planning["graphType"];
  validationReport: ValidationReport;
};

export type ListPlanningFilter = {
  tenantId: string;
  workspaceId: string;
  conversationId?: string;
};

/**
 * `id` é sempre fornecido por quem chama (o Planning Engine gera o id ANTES de rodar o Arthur
 * Planner, para que tasks/nós/artefatos/decisões já nasçam com o `planningId` correto — evita um
 * "id gerado pelo banco" que ninguém mais conseguiria referenciar até a criação terminar).
 */
export type PlanningRepositoryPort = {
  create(input: CreatePlanningInput): Promise<Planning>;
  getById(id: string): Promise<Planning | undefined>;
  /** Unicidade lógica (decisão obrigatória) — confirmação repetida do mesmo Briefing/revisão
   * nunca cria um segundo Planning. */
  getByPreparedCommand(preparedCommandId: string, preparedCommandRevision: number): Promise<Planning | undefined>;
  /** Qualquer Planning não-`superseded` ligado a este `preparedCommandId` — usado só para saber o
   * que superar quando o `PreparedCommand` de origem for superado por uma correção. */
  getActiveByPreparedCommandId(preparedCommandId: string): Promise<Planning | undefined>;
  updateStatus(id: string, status: PlanningStatus): Promise<Planning>;
  listByWorkspace(filter: ListPlanningFilter): Promise<Planning[]>;
};
