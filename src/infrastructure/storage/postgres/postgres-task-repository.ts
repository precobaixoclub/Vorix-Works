import type { Pool } from "pg";
import type { CreateTaskInput, ListTasksFilter, TaskRepositoryPort, UpdateTaskInput } from "../../../application/ports/task-repository.port.js";
import type { Task, TaskStatus } from "../../../domain/crm/crm.model.js";

const taskId = () => `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type TaskRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  contact_id: string | null;
  deal_id: string | null;
  type: string;
  title: string;
  description: string | null;
  due_at: Date | null;
  status: string;
  owner_user_id: string | null;
  team_id: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: TaskRow): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    contactId: row.contact_id ?? undefined,
    dealId: row.deal_id ?? undefined,
    type: row.type as Task["type"],
    title: row.title,
    description: row.description ?? undefined,
    dueAt: row.due_at?.toISOString(),
    status: row.status as TaskStatus,
    ownerUserId: row.owner_user_id ?? undefined,
    teamId: row.team_id ?? undefined,
    completedAt: row.completed_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresTaskRepository implements TaskRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const result = await this.pool.query<TaskRow>(
      `insert into tasks (id, tenant_id, workspace_id, contact_id, deal_id, type, title, description, due_at, owner_user_id, team_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning *`,
      [
        taskId(), input.tenantId, input.workspaceId, input.contactId ?? null, input.dealId ?? null,
        input.type, input.title, input.description ?? null, input.dueAt ?? null, input.ownerUserId ?? null, input.teamId ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Task | undefined> {
    const result = await this.pool.query<TaskRow>("select * from tasks where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(filter: ListTasksFilter): Promise<Task[]> {
    const limit = filter.limit ?? 200;
    const conditions: string[] = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    if (filter.contactId) {
      params.push(filter.contactId);
      conditions.push(`contact_id = $${params.length}`);
    }
    if (filter.dealId) {
      params.push(filter.dealId);
      conditions.push(`deal_id = $${params.length}`);
    }
    if (filter.ownerUserId) {
      params.push(filter.ownerUserId);
      conditions.push(`owner_user_id = $${params.length}`);
    }
    if (filter.teamId) {
      params.push(filter.teamId);
      conditions.push(`team_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.cursor) {
      params.push(filter.cursor);
      conditions.push(`created_at < (select created_at from tasks where id = $${params.length})`);
    }
    params.push(limit);
    const result = await this.pool.query<TaskRow>(
      `select * from tasks where ${conditions.join(" and ")} order by due_at asc nulls last, created_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toDomain);
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`TASK_NOT_FOUND: tarefa "${id}" não existe.`);
    const result = await this.pool.query<TaskRow>(
      `update tasks set
         contact_id = $2, deal_id = $3, type = $4, title = $5, description = $6, due_at = $7,
         owner_user_id = $8, team_id = $9, updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.contactId !== undefined ? input.contactId : existing.contactId ?? null,
        input.dealId !== undefined ? input.dealId : existing.dealId ?? null,
        input.type ?? existing.type,
        input.title ?? existing.title,
        input.description !== undefined ? input.description : existing.description ?? null,
        input.dueAt !== undefined ? input.dueAt : existing.dueAt ?? null,
        input.ownerUserId !== undefined ? input.ownerUserId : existing.ownerUserId ?? null,
        input.teamId !== undefined ? input.teamId : existing.teamId ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async setStatus(id: string, status: TaskStatus, completedAt: string | null): Promise<Task> {
    const result = await this.pool.query<TaskRow>(
      "update tasks set status = $2, completed_at = $3, updated_at = now() where id = $1 returning *",
      [id, status, completedAt],
    );
    if (!result.rows[0]) throw new Error(`TASK_NOT_FOUND: tarefa "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }
}
