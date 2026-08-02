import type { Pool } from "pg";
import type { ListRuntimeFilter, PersistRuntimeTranslationInput, RuntimeDetails, RuntimeRepositoryPort } from "../../../application/ports/runtime-repository.port.js";
import type {
  ExecutionCapability,
  PlanningArtifactType,
  TaskType,
} from "../../../domain/planning/planning.model.js";
import type {
  RuntimeArtifact,
  RuntimeArtifactStatus,
  RuntimeBinding,
  RuntimePlan,
  RuntimeState,
  RuntimeTask,
  RuntimeTaskInputPort,
  RuntimeTaskOutputPort,
  RuntimeTaskStatus,
  RuntimeValidationIssue,
  RuntimeValidationIssueCode,
  RuntimeValidationIssueSeverity,
  RuntimeValidationReport,
} from "../../../domain/runtime/runtime.model.js";

type RuntimePlanRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  briefing_id: string;
  prepared_command_id: string;
  planning_id: string;
  status: string;
  runtime_schema_version: number;
  translator_version: number;
  translator_strategy: string;
  translation_template: string;
  source_graph_fingerprint: string;
  runtime_fingerprint: string | null;
  validation_report: RuntimeValidationReport;
  created_at: Date;
  updated_at: Date;
  superseded_at: Date | null;
};

type RuntimeTaskRow = { id: string; runtime_plan_id: string; execution_task_id: string; type: string; capability: string; status: string; created_at: Date };
type RuntimeTaskInputRow = { id: string; runtime_plan_id: string; runtime_task_id: string; port_key: string; accepted_artifact_types: string[]; required: boolean; description: string; created_at: Date };
type RuntimeTaskOutputRow = { id: string; runtime_plan_id: string; runtime_task_id: string; port_key: string; artifact_type: string; description: string; created_at: Date };
type RuntimeBindingRow = { id: string; runtime_plan_id: string; from_runtime_task_id: string; from_output_port: string; to_runtime_task_id: string; to_input_port: string; created_at: Date };
type RuntimeArtifactRow = { id: string; runtime_plan_id: string; runtime_task_id: string; artifact_type: string; description: string; expected_fields: string[]; status: string; created_at: Date };
type RuntimeValidationIssueRow = { code: string; message: string; field: string | null; severity: string };

/** `persist` grava o RuntimePlan + todos os filhos na MESMA transação (decisão obrigatória 30) —
 * o agregado nunca fica visível parcialmente montado, mesmo padrão do `saveGraph` transacional do
 * domínio Planning (Sprint 09), escalado para 7 tabelas. */
export class PostgresRuntimeRepository implements RuntimeRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async persist(input: PersistRuntimeTranslationInput): Promise<RuntimePlan> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const planResult = await client.query<RuntimePlanRow>(
        `insert into runtime_plans (
           id, tenant_id, workspace_id, conversation_id, briefing_id, prepared_command_id, planning_id,
           status, runtime_schema_version, translator_version, translator_strategy, translation_template,
           source_graph_fingerprint, runtime_fingerprint, validation_report, created_at, updated_at
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now())
         returning *`,
        [
          input.plan.id,
          input.plan.sourceContext.tenantId,
          input.plan.sourceContext.workspaceId,
          input.plan.sourceContext.conversationId,
          input.plan.sourceContext.briefingId,
          input.plan.sourceContext.preparedCommandId,
          input.plan.sourceContext.planningId,
          input.plan.status,
          input.plan.runtimeSchemaVersion,
          input.plan.translatorVersion,
          input.plan.translatorStrategy,
          input.plan.translationTemplate,
          input.plan.sourceGraphFingerprint,
          input.plan.runtimeFingerprint ?? null,
          JSON.stringify(input.plan.validationReport),
        ],
      );

      for (const task of input.tasks) {
        await client.query(
          `insert into runtime_tasks (id, runtime_plan_id, execution_task_id, type, capability, status, created_at) values ($1,$2,$3,$4,$5,$6, now())`,
          [task.id, task.runtimePlanId, task.executionTaskId, task.type, task.capability, task.status],
        );
      }
      for (const port of input.inputs) {
        await client.query(
          `insert into runtime_task_inputs (id, runtime_plan_id, runtime_task_id, port_key, accepted_artifact_types, required, description, created_at) values ($1,$2,$3,$4,$5,$6,$7, now())`,
          [port.id, port.runtimePlanId, port.runtimeTaskId, port.portKey, [...port.acceptedArtifactTypes], port.required, port.description],
        );
      }
      for (const port of input.outputs) {
        await client.query(
          `insert into runtime_task_outputs (id, runtime_plan_id, runtime_task_id, port_key, artifact_type, description, created_at) values ($1,$2,$3,$4,$5,$6, now())`,
          [port.id, port.runtimePlanId, port.runtimeTaskId, port.portKey, port.artifactType, port.description],
        );
      }
      for (const binding of input.bindings) {
        await client.query(
          `insert into runtime_bindings (id, runtime_plan_id, from_runtime_task_id, from_output_port, to_runtime_task_id, to_input_port, created_at) values ($1,$2,$3,$4,$5,$6, now())`,
          [binding.id, binding.runtimePlanId, binding.fromRuntimeTaskId, binding.fromOutputPort, binding.toRuntimeTaskId, binding.toInputPort],
        );
      }
      for (const artifact of input.artifacts) {
        await client.query(
          `insert into runtime_artifacts (id, runtime_plan_id, runtime_task_id, artifact_type, description, expected_fields, status, created_at) values ($1,$2,$3,$4,$5,$6,$7, now())`,
          [artifact.id, artifact.runtimePlanId, artifact.runtimeTaskId, artifact.schema.artifactType, artifact.schema.description, [...artifact.schema.expectedFields], artifact.status],
        );
      }
      for (const issue of input.issues) {
        await client.query(
          `insert into runtime_validation_issues (runtime_plan_id, code, message, field, severity, created_at) values ($1,$2,$3,$4,$5, now())`,
          [input.plan.id, issue.code, issue.message, issue.field ?? null, issue.severity],
        );
      }

      await client.query("commit");
      return this.toDomainPlan(planResult.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<RuntimePlan | undefined> {
    const result = await this.pool.query<RuntimePlanRow>("select * from runtime_plans where id = $1", [id]);
    return result.rows[0] ? this.toDomainPlan(result.rows[0]) : undefined;
  }

  async getByPlanningId(planningId: string): Promise<RuntimePlan | undefined> {
    const result = await this.pool.query<RuntimePlanRow>("select * from runtime_plans where planning_id = $1", [planningId]);
    return result.rows[0] ? this.toDomainPlan(result.rows[0]) : undefined;
  }

  async getDetails(runtimePlanId: string): Promise<RuntimeDetails> {
    const tasksResult = await this.pool.query<RuntimeTaskRow>("select * from runtime_tasks where runtime_plan_id = $1", [runtimePlanId]);
    const inputsResult = await this.pool.query<RuntimeTaskInputRow>("select * from runtime_task_inputs where runtime_plan_id = $1", [runtimePlanId]);
    const outputsResult = await this.pool.query<RuntimeTaskOutputRow>("select * from runtime_task_outputs where runtime_plan_id = $1", [runtimePlanId]);
    const bindingsResult = await this.pool.query<RuntimeBindingRow>("select * from runtime_bindings where runtime_plan_id = $1", [runtimePlanId]);
    const artifactsResult = await this.pool.query<RuntimeArtifactRow>("select * from runtime_artifacts where runtime_plan_id = $1", [runtimePlanId]);
    const issuesResult = await this.pool.query<RuntimeValidationIssueRow>("select code, message, field, severity from runtime_validation_issues where runtime_plan_id = $1", [runtimePlanId]);

    return {
      tasks: tasksResult.rows.map((row) => this.toDomainTask(row)),
      inputs: inputsResult.rows.map((row) => this.toDomainInputPort(row)),
      outputs: outputsResult.rows.map((row) => this.toDomainOutputPort(row)),
      bindings: bindingsResult.rows.map((row) => this.toDomainBinding(row)),
      artifacts: artifactsResult.rows.map((row) => this.toDomainArtifact(row)),
      issues: issuesResult.rows.map((row) => this.toDomainIssue(row)),
    };
  }

  async updateStatus(id: string, status: RuntimeState): Promise<RuntimePlan> {
    const result = await this.pool.query<RuntimePlanRow>(
      `update runtime_plans
       set status = $2, updated_at = now(), superseded_at = case when $2 = 'superseded' then now() else superseded_at end
       where id = $1
       returning *`,
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`RUNTIME_NOT_FOUND: runtime "${id}" não existe.`);
    return this.toDomainPlan(row);
  }

  async listByWorkspace(filter: ListRuntimeFilter): Promise<RuntimePlan[]> {
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    if (filter.planningId) {
      params.push(filter.planningId);
      conditions.push(`planning_id = $${params.length}`);
    }
    const result = await this.pool.query<RuntimePlanRow>(`select * from runtime_plans where ${conditions.join(" and ")} order by created_at desc`, params);
    return result.rows.map((row) => this.toDomainPlan(row));
  }

  private toDomainPlan(row: RuntimePlanRow): RuntimePlan {
    return {
      id: row.id,
      sourceContext: {
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        conversationId: row.conversation_id,
        briefingId: row.briefing_id,
        preparedCommandId: row.prepared_command_id,
        planningId: row.planning_id,
      },
      status: row.status as RuntimeState,
      runtimeSchemaVersion: row.runtime_schema_version,
      translatorVersion: row.translator_version,
      translatorStrategy: row.translator_strategy,
      translationTemplate: row.translation_template,
      sourceGraphFingerprint: row.source_graph_fingerprint,
      runtimeFingerprint: row.runtime_fingerprint ?? undefined,
      validationReport: row.validation_report,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      supersededAt: row.superseded_at?.toISOString(),
    };
  }

  private toDomainTask(row: RuntimeTaskRow): RuntimeTask {
    return {
      id: row.id,
      runtimePlanId: row.runtime_plan_id,
      executionTaskId: row.execution_task_id,
      type: row.type as TaskType,
      capability: row.capability as ExecutionCapability,
      status: row.status as RuntimeTaskStatus,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toDomainInputPort(row: RuntimeTaskInputRow): RuntimeTaskInputPort {
    return {
      id: row.id,
      runtimePlanId: row.runtime_plan_id,
      runtimeTaskId: row.runtime_task_id,
      portKey: row.port_key,
      acceptedArtifactTypes: row.accepted_artifact_types as PlanningArtifactType[],
      required: row.required,
      description: row.description,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toDomainOutputPort(row: RuntimeTaskOutputRow): RuntimeTaskOutputPort {
    return {
      id: row.id,
      runtimePlanId: row.runtime_plan_id,
      runtimeTaskId: row.runtime_task_id,
      portKey: row.port_key,
      artifactType: row.artifact_type as PlanningArtifactType,
      description: row.description,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toDomainBinding(row: RuntimeBindingRow): RuntimeBinding {
    return {
      id: row.id,
      runtimePlanId: row.runtime_plan_id,
      fromRuntimeTaskId: row.from_runtime_task_id,
      fromOutputPort: row.from_output_port,
      toRuntimeTaskId: row.to_runtime_task_id,
      toInputPort: row.to_input_port,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toDomainArtifact(row: RuntimeArtifactRow): RuntimeArtifact {
    return {
      id: row.id,
      runtimePlanId: row.runtime_plan_id,
      runtimeTaskId: row.runtime_task_id,
      schema: { artifactType: row.artifact_type as PlanningArtifactType, description: row.description, expectedFields: row.expected_fields },
      status: row.status as RuntimeArtifactStatus,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toDomainIssue(row: RuntimeValidationIssueRow): RuntimeValidationIssue {
    return {
      code: row.code as RuntimeValidationIssueCode,
      message: row.message,
      field: row.field ?? undefined,
      severity: row.severity as RuntimeValidationIssueSeverity,
    };
  }
}
